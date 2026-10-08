// De notebookmodus van de REPL in Sapl (`:nb`, stap 2 van
// docs/2026-10-08_notebook_in_sapl_plan.md) in de WebSapl-worker:
//  1. de voorbeeldnotebooks: per expressiecel dezelfde uitvoer als de
//     huidige notebookrun (NOTEBOOK_RUN), en de tijden van de scenario's
//     van notebook_timing.js;
//  2. het gedrag uit §6 van het plan op kleine notebooks: fouten per cel,
//     de volgorde, wederzijds recursieve cellen, CAF's die blijven, een
//     verwijderde cel.
//
//   node websapl/tools/notebook_nb_test.js        (vanuit de repo-root)
const fs = require("fs");
const path = require("path");
const { call, init, repo } = require("./worker_harness.js");
const NB = require(path.join(__dirname, "..", "js", "notebook_core.js"));

const NB_PATH = "repl_sapl/gen/notebook_in.txt";
let fail = 0;
const now = () => performance.now();

async function nbRun(cells, only, mode) {
  const g = NB.generateNbInput(cells, only, mode);
  const r = await call({ type: "RSAPL_EVAL", line: ":nb " + NB_PATH, files: { [NB_PATH]: g.input } });
  if (!r.success) throw new Error(r.error);
  const p = NB.parseNbOutput(r.output);
  if (!p.done) throw new Error("geen @@nbdone:\n" + r.output);
  const byCell = {};
  for (const e of g.exprCells) {
    const c = p.cells[e.n];
    byCell[e.cell] = !c ? { notRun: true } : c.error ? { error: c.error } : { blocks: c.blocks };
  }
  return { byCell, defErrors: p.defErrors, error: p.error, raw: r.output };
}

function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FOUT"}  ${label}`);
  if (!ok) { fail = 1; if (detail) console.log("      " + detail); }
}

const cellsOf = (...srcs) => srcs.map((source) => ({ kind: "code", source }));

(async () => {
  await init();

  // == 1. De voorbeeldnotebooks ==============================================
  for (const file of ["notebooks/kennismaking.spp", "notebooks/data_verkennen.spp"]) {
    const cells = NB.parseNotebook(fs.readFileSync(path.join(repo, file), "utf8"));
    const kinds = cells.map((c) => (c.kind === "code" ? NB.classifyCell(c.source).kind : c.kind));
    const exprIdx = kinds.map((k, i) => (k === "expr" ? i : -1)).filter((i) => i >= 0);
    const defIdx = kinds.map((k, i) => (k === "def" ? i : -1)).filter((i) => i >= 0);

    const gen = NB.generateProgram(cells, undefined, undefined);
    const ref = await call({ type: "NOTEBOOK_RUN", source: gen.source, noImage: true }, "NOTEBOOK_RESULT");
    const refCells = NB.parseOutput(ref.output).cells;

    await call({ type: "RSAPL_RESET" });
    let t = now();
    const r1 = await nbRun(cells);
    const firstMs = now() - t;
    let same = 0;
    for (const e of gen.exprCells) {
      const want = refCells[e.n].error ? { error: refCells[e.n].error } : { blocks: refCells[e.n].blocks };
      if (JSON.stringify(want) === JSON.stringify(r1.byCell[e.cell])) same++;
      else console.log(`      cel [${e.cell + 1}]: nu ${JSON.stringify(want).slice(0, 200)}\n               :nb ${JSON.stringify(r1.byCell[e.cell]).slice(0, 200)}`);
    }
    check(`${file}: ${same}/${gen.exprCells.length} cellen gelijk aan de huidige run, geen fouten`,
      same === gen.exprCells.length && !Object.keys(r1.defErrors).length && !r1.error, JSON.stringify(r1.defErrors) + r1.error);

    t = now(); await nbRun(cells); const againMs = now() - t;
    const e = exprIdx[exprIdx.length - 1];
    cells[e].source = `(${cells[e].source})`;
    t = now(); const r3 = await nbRun(cells, NB.dependents(cells, e)); const exprMs = now() - t;
    const d = defIdx[defIdx.length - 1];
    cells[d].source += "\n__meetDef = 1";
    const deps = NB.dependents(cells, d);
    t = now(); const r4 = await nbRun(cells, deps); const defMs = now() - t;
    const nDeps = [...deps].filter((i) => kinds[i] === "expr").length;
    check(`${file}: na wijzigingen nog steeds zonder fouten`, !r3.error && !r4.error && Object.values(r4.byCell).every((c) => c.blocks));
    console.log(`      tijden: eerste run ${firstMs.toFixed(0)} ms, alles opnieuw zonder wijziging ${againMs.toFixed(0)} ms, ` +
      `expressiecel [${e + 1}] ${exprMs.toFixed(0)} ms, definitiecel [${d + 1}] met ${nDeps} expressiecellen ${defMs.toFixed(0)} ms`);
  }

  // == 2. Gedrag ===============================================================
  await call({ type: "RSAPL_RESET" });
  // Fouten per cel: een compileerfout in een definitiecel; wie ervan
  // afhangt wordt niet uitgevoerd, de rest wel.
  let cells = cellsOf("kapot x = onbekend x + 1", "hangtAf y = kapot y * 2", "los = 7", "hangtAf 3", "los + 1", "error \"au\"", "los * 3");
  let r = await nbRun(cells);
  check("compileerfout blijft bij zijn cel", /onbekend/.test(r.defErrors[0] || ""), JSON.stringify(r.defErrors));
  check("afhankelijke definitiecel niet uitgevoerd", /niet uitgevoerd: gebruikt kapot/.test(r.defErrors[1] || ""), JSON.stringify(r.defErrors));
  check("afhankelijke expressiecel niet uitgevoerd", /niet uitgevoerd/.test((r.byCell[3] || {}).error || ""), JSON.stringify(r.byCell[3]));
  check("onafhankelijke cellen lopen door, ook na een error", r.byCell[4].blocks && r.byCell[4].blocks[0].content === "8" &&
    /au/.test(r.byCell[5].error || "") && r.byCell[6].blocks && r.byCell[6].blocks[0].content === "21", JSON.stringify(r.byCell));
  // De cel gerepareerd: de afhankelijke cellen komen terug.
  cells[0].source = "kapot x = x + 1";
  r = await nbRun(cells);
  check("na reparatie: afhankelijke cellen weer goed", !Object.keys(r.defErrors).length && r.byCell[3].blocks && r.byCell[3].blocks[0].content === "8", JSON.stringify(r));

  // Volgorde: een latere cel gebruiken mag in "any", niet in "top".
  await call({ type: "RSAPL_RESET" });
  cells = cellsOf("eerst = later + 1", "later = 41", "eerst");
  r = await nbRun(cells, undefined, "any");
  check("in elke volgorde: latere cel gebruiken", r.byCell[2].blocks && r.byCell[2].blocks[0].content === "42", JSON.stringify(r));
  await call({ type: "RSAPL_RESET" });
  r = await nbRun(cells, undefined, "top");
  check("van boven naar beneden: latere cel is een fout", /latere cel \[2\]/.test(r.defErrors[0] || "") && /niet uitgevoerd/.test(r.byCell[2].error || ""), JSON.stringify(r));

  // Wederzijds recursief over twee cellen heen.
  await call({ type: "RSAPL_RESET" });
  cells = cellsOf("even n = if (n == 0) True (oneven (n - 1))", "oneven n = if (n == 0) False (even (n - 1))", "even 10", "oneven 7");
  r = await nbRun(cells);
  check("wederzijds recursieve cellen (en Bool als True/False)", r.byCell[2].blocks && r.byCell[2].blocks[0].content === "True" &&
    r.byCell[3].blocks[0].content === "True", JSON.stringify(r));

  // CAF's blijven als hun cel (en wat hij gebruikt) niet verandert.
  await call({ type: "RSAPL_RESET" });
  cells = cellsOf("big =: printString \"REKEN\" <#> 42", "ander = 1", "big + ander");
  const reken = (x) => (x.raw.match(/REKEN/g) || []).length;
  r = await nbRun(cells);
  const r2 = await nbRun(cells);
  cells[1].source = "ander = 2";
  const r3 = await nbRun(cells);
  cells[0].source = "big =: printString \"REKEN\" <#> 43";
  const r4 = await nbRun(cells);
  check("CAF één keer uitgerekend, ook als een andere cel verandert", reken(r) === 1 && reken(r2) === 0 && reken(r3) === 0 &&
    r3.byCell[2].blocks[0].content === "44", `${reken(r)} ${reken(r2)} ${reken(r3)} ${JSON.stringify(r3.byCell[2])}`);
  // De CAF rekent tijdens de cel, dus zijn "REKEN" staat in de uitvoer van de cel.
  check("gewijzigde CAF opnieuw uitgerekend", reken(r4) === 1 && /45$/.test(r4.byCell[2].blocks.map((b) => b.content).join("\n")), JSON.stringify(r4.byCell[2]));

  // Een cel weg: wie hem gebruikte, geeft een fout.
  await call({ type: "RSAPL_RESET" });
  cells = cellsOf("weg = 5", "blijft = weg + 1", "blijft");
  await nbRun(cells);
  cells.shift();
  r = await nbRun(cells);
  check("verwijderde cel: gebruiker geeft een fout", /weg/.test(r.defErrors[0] || "") && /niet uitgevoerd/.test(r.byCell[1].error || ""), JSON.stringify(r));

  process.exit(fail);
})();
