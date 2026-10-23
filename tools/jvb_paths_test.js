// De paden van de worker sinds de VM-wasm geen .jmvm-tekst meer leest (11
// oktober 2026): gen1 en retagcomp schrijven .jvb, de tekst voor het
// jmvm-tabblad komt uit jvb2jmvm (moet gelijk zijn aan de native tekst), en
// tekst die alleen als tekst bestaat gaat door jmvm2jvb (tool-wasm). In Node,
// zonder browser; vergelijkt met de native compilers.
//
//   node websapl/tools/jvb_paths_test.js            (vanuit de repo-root; eerst make runfast)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { call, init, repo } = require("./worker_harness.js");

const read = (p) => fs.readFileSync(path.join(repo, p), "utf8");
const native = (args, input) => execFileSync(path.join(repo, args[0]), args.slice(1), { cwd: repo, input, encoding: "utf8" });
const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "jvbpaths-"));
const banner = (t) => t.split("\n").filter((r) => r && !/^(VM |Reading file|\d+ instr read|execution|Elapsed|nr gc|instr executed|calls:|creates:|\[VM\])/.test(r));

let fails = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "FOUT"}  ${name}${ok || !detail ? "" : "\n      " + detail}`);
  if (!ok) fails++;
}

(async () => {
  await init();

  // 1. Compile + Run: één gen1-run naar .jvb (in wasm32: `long` van 4 bytes,
  // jaAssemble rekent 2^31/2^32 zelf uit), de tekst gelijk aan native gen1 en
  // de uitvoer gelijk aan native runfast. Alle 12 kernbenchmarks, een paar
  // ook zonder inferentie, plus floats en CAF's.
  const progs = fs.readdirSync(path.join(repo, "benchmarks")).filter((n) => n.endsWith(".cfp"))
    .map((n) => [`benchmarks/${n}`, true])
    .concat([["benchmarks/fib.cfp", false], ["benchmarks/knights.cfp", false], ["benchmarks/queens.cfp", false],
      ["examples/float_constanten.cfp", true], ["tests/caf/keten.cfp", true], ["tests/caf/gc.cfp", true],
      ["tests/dynamics/sprint.cfp", true], ["tests/dynamics/unpack.cfp", true]]);
  for (const [rel, strict] of progs) {
    const name = `${rel}${strict ? "" : " --nostrict"}`;
    const b = path.basename(rel, ".cfp");
    const src = read(rel);
    const c = await call({ type: "COMPILE", source: src, path: `/workspace/${b}.cfp`, stages: ["jmvm"], strictness: strict });
    const f = c.success && c.files.find((x) => x.stage === "jmvm");
    fs.writeFileSync(path.join(tmp, `${b}.cfp`), src);
    native(["compile", path.join(tmp, `${b}.cfp`), "--notypecheck"].concat(strict ? [] : ["--nostrict"]));
    const ref = fs.readFileSync(path.join(tmp, `${b}.jmvm`), "utf8");
    check(`${name}: tekst gelijk aan native gen1`, !!f && f.content === ref, f ? `lengte ${f.content.length} tegen ${ref.length}` : c.stderr || c.error);
    if (!f) continue;
    const r = await call({ type: "RUN", contentOrPath: f.content, isPath: false, stdin: "" });
    const want = banner(native(["runfast", path.join(tmp, `${b}.jmvm`)], ""));
    // De worker geeft de bytes van stdout als losse tekens terug
    // (String.fromCharCode per byte); native is UTF-8 (⟨ in tests/dynamics).
    const got = banner(Buffer.from(r.output, "latin1").toString("utf8"));
    check(`${name}: uitvoer gelijk aan native (${r.metrics.res})`, JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(got).slice(0, 200)} tegen ${JSON.stringify(want).slice(0, 200)}`);
  }

  // 3. Tekst die alleen als tekst bestaat (een bewerkt .jmvm-tabblad): jmvm2jvb.
  {
    const text = read("benchmarks/primes.jmvm") + "\n";   // net anders dan wat de worker kent
    const r = await call({ type: "RUN", contentOrPath: text, isPath: false, stdin: "" });
    check("losse .jmvm-tekst draait via jmvm2jvb (primes)", r.metrics.res === "48619", `res ${r.metrics.res}: ${r.output.slice(0, 300)}`);
  }

  // 4. Kapotte tekst: een foutmelding, geen hang of stille uitkomst.
  {
    const r = await call({ type: "RUN", contentOrPath: "start #\n0  bestaatniet 1 2\n", isPath: false, stdin: "" });
    check("kapotte .jmvm-tekst geeft een fout", r.metrics.res === "Error" && /unknown instruction|parse error|mislukt/.test(r.output), r.output.slice(0, 300));
  }

  // 5. Compile Retag: retagcomp schrijft .jvb, de tekst gelijk aan native retagcomp.
  {
    fs.copyFileSync(path.join(repo, "benchmarks/hamming.cfp"), path.join(tmp, "h.cfp"));
    native(["compile", path.join(tmp, "h.cfp"), "--emit=retag"]);
    const retagFile = fs.readdirSync(tmp).find((n) => n.startsWith("h.") && /retag/.test(n));
    const retag = fs.readFileSync(path.join(tmp, retagFile), "utf8");
    native(["runfast", "sapl_compiler/retagcomp.jmvm"], `${path.join(tmp, retagFile)}\n${path.join(tmp, "h_ref.jmvm")}\n`);
    const ref = fs.readFileSync(path.join(tmp, "h_ref.jmvm"), "utf8");
    const c = await call({ type: "COMPILE_RETAG", source: retag, path: "/workspace/h.cfp_retag" });
    const f = c.success && c.files[0];
    check("compile retag: tekst gelijk aan native retagcomp", !!f && f.content === ref, f ? `lengte ${f.content.length} tegen ${ref.length}` : c.stderr);
    const r = f && await call({ type: "RUN", contentOrPath: f.content, isPath: false, stdin: "" });
    check("compile retag: run (res 3564000)", !!r && r.metrics.res === "3564000", r ? r.metrics.res : "");
  }

  // 6. LC_RUN: lc_repl.jmvm (tekst) via jmvm2jvb, zelfde uitvoer als native.
  {
    const stdin = "id = \\x.x\nid y\n";
    const r = await call({ type: "LC_RUN", stdin });
    const want = banner(native(["runfast", "lc_repl/lc_repl.jmvm"], stdin));
    const got = r.success ? banner(r.output) : [];
    check("lc_run: zelfde uitvoer als native", r.success && JSON.stringify(got) === JSON.stringify(want), r.error || `${JSON.stringify(got).slice(0, 200)} tegen ${JSON.stringify(want).slice(0, 200)}`);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? `${fails} fout(en)` : "alles in orde");
  process.exit(fails ? 1 : 0);
})();
