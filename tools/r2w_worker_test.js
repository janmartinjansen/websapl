// Toets voor COMPILE_WASM in websapl/engine/worker.js (retag2wasm in de browser,
// docs/2026-11-24_retag2wasm_in_websapl_plan.md), in Node zonder browser: de 13
// kernbenchmarks via het worker-bericht, `res:` tegen ./runfast (via RUN in dezelfde
// worker, de JMVM-wasm), plus een float-literal en een try (de generator stopt met een
// melding).
//
//   node websapl/tools/r2w_worker_test.js               standaard stack (~1 MB, zoals een
//                                                        browser): diepe programma's moeten
//                                                        de stackmelding geven
//   node websapl/tools/r2w_worker_test.js --grote-stack alles via wasm (stack 2 GB)
//
// Vanuit de repo-root.
const { Worker, isMainThread } = require("worker_threads");
const groot = process.argv.includes("--grote-stack");
if (isMainThread) {
  process.chdir(require("path").join(__dirname, "..", "engine"));   // worker_harness.js wil daar staan
  const w = new Worker(__filename, { argv: process.argv.slice(2), resourceLimits: groot ? { stackSizeMb: 2048 } : {} });
  w.on("exit", (c) => (process.exitCode = c));
  return;
}
const fs = require("fs");
const path = require("path");
const { call, init, repo } = require("./worker_harness.js");
const namen = ["fib", "primes", "queens", "sort", "knights", "hamming", "match", "twice",
  "eval", "sprimes", "parsetest", "prolog", "eval2"];

(async () => {
  await init();
  let fail = 0;
  const regel = (ok, tekst) => { if (!ok) fail = 1; console.log(`${ok ? "ok  " : "FOUT"}  ${tekst}`); };
  for (const n of namen) {
    const pad = `benchmarks_sapl/${n}.cfp`;
    const bron = fs.readFileSync(path.join(repo, "websapl", pad), "utf8");
    const j = await call({ type: "COMPILE", source: bron, path: "/" + pad, stages: ["jmvm"] });
    const r = await call({ type: "RUN", contentOrPath: j.files[0].content, isPath: false }, "RUN_COMPLETE");
    const w = await call({ type: "COMPILE_WASM", source: bron, path: "/" + pad }, "WASM_COMPLETE");
    const jm = String(r.metrics.res);
    const tijden = `gen1 ${w.ms.gen1} ms, generator ${w.ms.generator} ms, run ${w.ms.run} ms (JMVM ${r.durationMs} ms), ${w.wasmSize} bytes`;
    if (w.success) regel(w.res === jm, `${n.padEnd(10)} res ${w.res} (JMVM ${jm}); ${tijden}`);
    else if (w.stackOverflow && !groot) console.log(`ok    ${n.padEnd(10)} stackmelding (${w.foutSoort}: ${w.message}) na ${w.ms.run} ms; JMVM res ${jm}`);
    else regel(false, `${n.padEnd(10)} ${w.stage}: ${w.message} [${w.foutSoort}]`);
  }
  // de voortzettingsvorm (eigen stack): alle 13 moeten nu ook met de standaard stack lopen
  for (const n of namen) {
    const pad = `benchmarks_sapl/${n}.cfp`;
    const bron = fs.readFileSync(path.join(repo, "websapl", pad), "utf8");
    const j = await call({ type: "COMPILE", source: bron, path: "/" + pad, stages: ["jmvm"] });
    const r = await call({ type: "RUN", contentOrPath: j.files[0].content, isPath: false }, "RUN_COMPLETE");
    const w = await call({ type: "COMPILE_WASM", source: bron, path: "/" + pad, cps: true }, "WASM_COMPLETE");
    const jm = String(r.metrics.res);
    regel(w.success && w.res === jm, `${n.padEnd(10)} eigen stack: res ${w.res} (JMVM ${jm}); generator ${w.ms.generator} ms, run ${w.ms.run} ms, ${w.wasmSize} bytes${w.success ? "" : " " + w.stage + ": " + w.message}`);
  }
  {
    const w = await call({ type: "COMPILE_WASM", source: "start = f 50000000\n\nf n = if (n == 0) 0 (1 + f (n - 1))\n", path: "/tmp/diep.cfp", cps: true }, "WASM_COMPLETE");
    regel(!w.success && w.ownStackFull, `diep (eigen stack) ${w.stage}: ${w.message}`);
  }
  // wat de generator niet kent: een nette melding, geen crash
  for (const [naam, bron] of [["float-literal", "start = 1.5 * 2.0\n"],
                              ["try", "start = try (1 / 0) 7\n"]]) {
    const w = await call({ type: "COMPILE_WASM", source: bron, path: "/tmp/x.cfp" }, "WASM_COMPLETE");
    regel(!w.success && w.stage === "generator" && !!w.message, `${naam.padEnd(13)} ${w.stage}: ${String(w.message).split("\n")[0]}`);
  }
  process.exit(fail);
})();
