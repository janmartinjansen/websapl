// Waar een notebookrun zijn tijd aan kwijt is (8 oktober 2026), als
// nulmeting voor het notebook op de manier van de REPL in Sapl. Volgt wat
// notebook.html doet (eerst typeren voor de weergave op type, dan
// generateProgram, dan NOTEBOOK_RUN) en telt per stap de tijd en het aantal
// aanroepen, door de functies van de worker in te pakken. Tijden zijn
// inclusief (een stap die een andere aanroept telt die mee).
//
//   node websapl/tools/notebook_timing.js [notebook.spp ...]   (vanuit de repo-root)
const fs = require("fs");
const path = require("path");
const { call, init, repo } = require("./worker_harness.js");
const NB = require(path.join(__dirname, "..", "js", "notebook_core.js"));

const WRAP = ["typecheckSource", "notebookLibUnit", "preprocessSpp", "runCompilerStage", "runSaplcompModuleStage",
  "runRetagLinkStage", "runRetagCompStage", "runOnImage", "runJmvmCapture", "collectSppImports", "collectDataFiles"];
let stats = {};
function wrap(name) {
  const orig = globalThis[name];
  if (typeof orig !== "function") return;
  globalThis[name] = async function (...args) {
    const t = performance.now();
    try { return await orig.apply(this, args); }
    finally { const s = stats[name] || (stats[name] = { n: 0, ms: 0 }); s.n++; s.ms += performance.now() - t; }
  };
}

(async () => {
  await init();
  WRAP.forEach(wrap);
  // Elk vers wasm-exemplaar (een compilerstap start er een).
  const origCreate = globalThis.createJMVMModule;
  globalThis.createJMVMModule = async function (...a) {
    const t = performance.now();
    try { return await origCreate.apply(this, a); }
    finally { const s = stats["(nieuw wasm-exemplaar)"] || (stats["(nieuw wasm-exemplaar)"] = { n: 0, ms: 0 }); s.n++; s.ms += performance.now() - t; }
  };

  const files = process.argv.slice(2).length ? process.argv.slice(2) : ["notebooks/kennismaking.spp", "notebooks/data_verkennen.spp"];
  for (const file of files) {
    const cells = NB.parseNotebook(fs.readFileSync(path.join(repo, file), "utf8"));
    const kinds = cells.map((c) => (c.kind === "code" ? NB.classifyCell(c.source).kind : c.kind));
    const exprIdx = kinds.map((k, i) => (k === "expr" ? i : -1)).filter((i) => i >= 0);
    const defIdx = kinds.map((k, i) => (k === "def" ? i : -1)).filter((i) => i >= 0);
    console.log(`\n== ${file}: ${cells.length} cellen (${defIdx.length} definitie, ${exprIdx.length} expressie)`);
    const typeCache = new Map();

    // Eén uitvoering zoals notebook.html's runProgram.
    async function runCells(only) {
      stats = {};
      const t0 = performance.now();
      let types = {};
      const tp = NB.generateExprTypeProgram(cells, only);
      const tt = performance.now();
      if (typeCache.has(tp.source)) types = typeCache.get(tp.source);
      else {
        const t = await call({ type: "TYPECHECK", source: tp.source, path: "/workspace/notebook_exprtypes.spp" }, "COMPILE_COMPLETE");
        types = NB.parseExprTypes(t.report, tp.typeLines);
        typeCache.clear(); typeCache.set(tp.source, types);
      }
      const typeMs = performance.now() - tt;
      const gen = NB.generateProgram(cells, only, types);
      const tr = performance.now();
      const r = await call({ type: "NOTEBOOK_RUN", source: gen.source }, "NOTEBOOK_RESULT");
      const runMs = performance.now() - tr;
      if (!r.success) throw new Error(`${file}: ${r.stage}: ${r.error}`);
      const parsed = NB.parseOutput(r.output);
      const okCells = gen.exprCells.filter((e) => parsed.cells[e.n] && !parsed.cells[e.n].error).length;
      return { total: performance.now() - t0, typeMs, runMs, okCells, n: gen.exprCells.length, image: r.image, cached: !!r.cached, stats };
    }

    function report(label, r) {
      const img = r.image ? `beeld: ${r.image.chunk ? "los stuk" : "volledig"}${r.image.event ? ", " + r.image.event.trim() : ""}, ${r.image.calls} aanroepen` : "zonder beeld";
      console.log(`\n${label}: ${r.total.toFixed(0)} ms (typeren ${r.typeMs.toFixed(0)}, uitvoeren ${r.runMs.toFixed(0)}${r.cached ? ", programma uit de cache" : ""}); ${r.okCells}/${r.n} cellen; ${img}`);
      for (const [k, v] of Object.entries(r.stats).sort((a, b) => b[1].ms - a[1].ms))
        console.log(`  ${k.padEnd(26)} ${String(v.n).padStart(3)}x  ${v.ms.toFixed(0).padStart(6)} ms`);
    }

    report("1. eerste run, alle cellen", await runCells(undefined));
    report("2. nog eens, niets gewijzigd", await runCells(undefined));
    // Eén expressiecel gewijzigd: alleen die cel (en wie ervan afhangt).
    const e = exprIdx[exprIdx.length - 1];
    cells[e].source = `(${cells[e].source})`;
    report(`3. expressiecel [${e + 1}] gewijzigd`, await runCells(NB.dependents(cells, e)));
    // Eén definitiecel gewijzigd (een extra definitie): die cel en wie ervan afhangt.
    if (defIdx.length) {
      const d = defIdx[defIdx.length - 1];
      cells[d].source = cells[d].source + "\n__meetDef = 1";
      const deps = NB.dependents(cells, d);
      report(`4. definitiecel [${d + 1}] gewijzigd (${[...deps].length} afhankelijke cellen)`, await runCells(deps));
    }
  }
  process.exit(0);
})();
