// Stap 1 van docs/2026-10-08_notebook_in_sapl_plan.md (8 oktober 2026): de
// notebooks als regels door de REPL in Sapl zoals die nu is (RSAPL_EVAL in
// de WebSapl-worker), zonder iets aan de REPL te veranderen. Vergelijkt de
// uitvoer per expressiecel met de huidige notebookrun (NOTEBOOK_RUN) en meet
// dezelfde scenario's als notebook_timing.js.
//
// Hoe een notebook regels wordt:
//  - eerst de uitvoerlaag: `:import` van D en G, en lib/notebook_glue.cfp
//    als module NBG;
//  - de definities van alle definitiecellen, elk als `:def` (imports als
//    `:import`), in afhankelijkheidsvolgorde: een notebook is één letrec
//    (`priemen` gebruikt `zeef`, dat er pas na staat);
//  - elke expressiecel als de regel `NBG.nbCell N (<cel>)`.
// Niet meegenomen: [lc]- en [type]-cellen, en de weergave op type (geen van
// beide notebooks heeft een Bool-cel).
//
//   node websapl/tools/notebook_rs_proef.js [notebook.spp ...]   (vanuit de repo-root)
const fs = require("fs");
const path = require("path");
const { call, init, repo } = require("./worker_harness.js");
const NB = require(path.join(__dirname, "..", "js", "notebook_core.js"));

const now = () => performance.now();

async function rs(line, files) {
  const r = await call({ type: "RSAPL_EVAL", line, files });
  if (!r.success) throw new Error(`${line}: ${r.error}`);
  if (/^fout: /m.test(r.output) && !line.startsWith("NBG.nbCell")) throw new Error(`${line}: ${r.output.trim()}`);
  return r.output;
}

// De top-level definities van een definitiecel (een ingesprongen regel hoort
// bij de vorige; commentaar valt weg).
function splitDefs(source) {
  const defs = [];
  for (const l of source.split("\n")) {
    if (l.trim() === "" || l.trim().startsWith("//")) continue;
    if (/^\s/.test(l) && defs.length) defs[defs.length - 1] += "\n" + l;
    else defs.push(l);
  }
  return defs;
}

const identsOf = (text) => new Set(text.match(/[A-Za-z_][A-Za-z0-9_']*/g) || []);

function defName(d) {
  const adt = d.match(/^::\s*([A-Za-z_][A-Za-z0-9_]*)/);
  if (adt) return "::" + adt[1];
  return NB.definedNames(d)[0];
}

// Namen die een definitie aan anderen geeft: een ADT geeft zijn constructors.
function givenNames(d) {
  const adt = d.match(/^::\s*[A-Za-z_]\w*\s*=(.*)$/s);
  if (adt) return adt[1].split("|").map((c) => c.trim().split(/\s+/)[0]);
  return [defName(d)];
}

// Afhankelijkheidsvolgorde (diepte eerst); een cyclus over definities heen
// zou samen één eenheid moeten zijn -- komt in deze notebooks niet voor.
function topoOrder(defs) {
  const byName = new Map();
  defs.forEach((d) => givenNames(d).forEach((n) => byName.set(n, d)));
  const done = new Set(), busy = new Set(), out = [];
  function visit(d) {
    if (done.has(d)) return;
    if (busy.has(d)) throw new Error("cyclus tussen definities: " + defName(d));
    busy.add(d);
    for (const id of identsOf(d)) {
      const dep = byName.get(id);
      if (dep && dep !== d) visit(dep);
    }
    busy.delete(d); done.add(d); out.push(d);
  }
  defs.forEach(visit);
  return out;
}

const asLine = (d) => (d.startsWith("import ") ? ":import " + d.slice(7) : ":def " + d.replace(/\n\s*/g, " "));

function cellBlocks(output, n) {
  const c = NB.parseOutput(output).cells[n];
  if (!c) return { error: "geen uitvoer: " + output.trim().slice(0, 200) };
  return c.error ? { error: c.error } : { blocks: c.blocks };
}

(async () => {
  await init();
  let fail = 0;
  const files = process.argv.slice(2).length ? process.argv.slice(2) : ["notebooks/kennismaking.spp", "notebooks/data_verkennen.spp"];
  for (const file of files) {
    const cells = NB.parseNotebook(fs.readFileSync(path.join(repo, file), "utf8"));
    const kinds = cells.map((c) => (c.kind === "code" ? NB.classifyCell(c.source).kind : c.kind));
    console.log(`\n== ${file}`);

    // De huidige notebookrun als referentie.
    const gen = NB.generateProgram(cells, undefined, undefined);
    const ref = await call({ type: "NOTEBOOK_RUN", source: gen.source, noImage: true }, "NOTEBOOK_RESULT");
    if (!ref.success) throw new Error(`referentie: ${ref.stage}: ${ref.error}`);
    const refCells = NB.parseOutput(ref.output).cells;
    const refOf = {};
    for (const e of gen.exprCells) refOf[e.cell] = refCells[e.n];

    // 1. Eerste run.
    await call({ type: "RSAPL_RESET" });
    let t = now();
    await rs(':import "lib/display.spp" as D');
    await rs(':import "grafisch/graphics.cfp" as G');
    // De uitvoerlaag als module (hij is wederzijds recursief, en `:def` per
    // definitie kan dat niet): met zijn eigen imports ervoor.
    const glue = 'import "repl_sapl/build/prelude/prelude.cfp" as Pre (..)\nimport "lib/display.spp" as D\nimport "grafisch/graphics.cfp" as G\n' +
      fs.readFileSync(path.join(repo, "lib/notebook_glue.cfp"), "utf8")
        .replace(/\bTYPE_FUNC\b/g, "4").replace(/\bTYPE_STRING\b/g, "3");   // hoofdletternamen ziet een open import niet
    await rs(':import "repl_sapl/gen/nb_glue.cfp" as NBG', { "repl_sapl/gen/nb_glue.cfp": glue });
    const glueMs = now() - t;
    t = now();
    const allDefs = [];
    cells.forEach((c, i) => { if (kinds[i] === "def") allDefs.push(...splitDefs(c.source)); });
    const imports = allDefs.filter((d) => d.startsWith("import "));
    const ordered = [...new Set(imports), ...topoOrder(allDefs.filter((d) => !d.startsWith("import ")))];
    const defTimes = [];
    for (const d of ordered) { const t1 = now(); await rs(asLine(d)); defTimes.push([defName(d) || d, now() - t1]); }
    const defsMs = now() - t;
    t = now();
    const exprIdx = kinds.map((k, i) => (k === "expr" ? i : -1)).filter((i) => i >= 0);
    let n = 0, same = 0;
    const exprTimes = [];
    async function runExpr(i) {
      n++;
      const t1 = now();
      const out = await rs(`NBG.nbCell ${n} (${cells[i].source.replace(/\n\s*/g, " ")})`);
      exprTimes.push([i + 1, now() - t1]);
      return cellBlocks(out, n);
    }
    for (const i of exprIdx) {
      const got = await runExpr(i);
      const want = refOf[i] && (refOf[i].error ? { error: refOf[i].error } : { blocks: refOf[i].blocks });
      if (JSON.stringify(got) === JSON.stringify(want)) same++;
      else { fail = 1; console.log(`  VERSCHIL cel [${i + 1}]:\n    nu:    ${JSON.stringify(want).slice(0, 300)}\n    proef: ${JSON.stringify(got).slice(0, 300)}`); }
    }
    const exprMs = now() - t;
    console.log(`1. eerste run: ${(glueMs + defsMs + exprMs).toFixed(0)} ms (uitvoerlaag ${glueMs.toFixed(0)}, ` +
      `${ordered.length} definities ${defsMs.toFixed(0)}, ${exprIdx.length} expressiecellen ${exprMs.toFixed(0)}); ` +
      `${same}/${exprIdx.length} cellen gelijk aan de huidige run`);
    console.log("   definities: " + defTimes.map(([d, ms]) => `${d} ${ms.toFixed(0)}`).join(", "));
    console.log("   expressiecellen: " + exprTimes.map(([c, ms]) => `[${c}] ${ms.toFixed(0)}`).join(", "));

    // 3. Eén expressiecel gewijzigd.
    const e = exprIdx[exprIdx.length - 1];
    cells[e].source = `(${cells[e].source})`;
    t = now();
    await runExpr(e);
    console.log(`3. expressiecel [${e + 1}] gewijzigd: ${(now() - t).toFixed(0)} ms`);

    // 4. Een bestaande definitie opnieuw (zelfde betekenis), met de
    // afhankelijke expressiecellen. Per definitie (`:def`): een gedeelde
    // afhankelijke kan zo twee keer gecompileerd worden; een eenheid per
    // cel (stap 2) voorkomt dat.
    const target = file.includes("kennismaking") ? "zeef" : "kilo";
    const d = ordered.find((x) => defName(x) === target);
    const cellOf = cells.findIndex((c, i) => kinds[i] === "def" && c.source.includes(d));
    const deps = [...NB.dependents(cells, cellOf)].filter((i) => kinds[i] === "expr");
    t = now();
    const outDef = await rs(asLine(d));
    const defMs = now() - t;
    for (const i of deps) await runExpr(i);
    console.log(`4. definitie ${target} opnieuw (${outDef.trim()}): ${(now() - t).toFixed(0)} ms ` +
      `(definitie met afhankelijke definities ${defMs.toFixed(0)}, ${deps.length} expressiecellen ${(now() - t - defMs).toFixed(0)})`);
    // 4b. Hetzelfde, maar de afhankelijke expressiecellen samen in één
    // eenheid (één keer compileren, zoals het huidige notebook).
    t = now();
    await rs(asLine(d));
    const firstN = n + 1;
    const batch = deps.map((i) => `NBG.nbCell ${++n} (${cells[i].source.replace(/\n\s*/g, " ")})`).join(" <#> ");
    const outB = await rs(batch);
    const okB = deps.every((i, k) => !cellBlocks(outB, firstN + k).error);
    const batchMs = now() - t;
    console.log(`4b. idem, de ${deps.length} expressiecellen als één eenheid: ${batchMs.toFixed(0)} ms (${okB ? "alle cellen uitvoer" : "FOUT in een cel"})`);
  }

  // Wat staat er in de plaats van een CAF na een fout (plan §6)?
  await call({ type: "RSAPL_RESET" });
  const caf = [":def boem =: error \"boem\"", "boem", "boem", ":def deels =: 1 + (if (2 > 1) (error \"diep\") 3)", "deels", "deels",
    ":def f x = if (x > 3) (error \"te groot\") x", ":def lijst =: [f 1, f 5, f 2]", "lijst", "lijst"];
  console.log("\nCAF na een fout:");
  for (const l of caf) console.log(`  ${l}  ->  ${(await call({ type: "RSAPL_EVAL", line: l })).output.trim().split("\n").join(" | ")}`);
  process.exit(fail);
})();
