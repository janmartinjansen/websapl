// De REPL in Sapl in de WebSapl-worker (stap 6, 7 oktober 2026): voert elke
// repl/tests/<naam>.in en repl_sapl/tests/<naam>.in regel voor regel door
// RSAPL_EVAL (een eigen wasm-exemplaar dat bij readLine pauzeert) en
// vergelijkt de eerste uitvoerregel per invoerregel met <naam>.expected --
// dezelfde bestanden als repl/tests/run_repl_tests.sh en
// repl_sapl/run_tests.sh.
//
//   node websapl/tools/rs_repl_test.js        (vanuit de repo-root)
const fs = require("fs");
const path = require("path");
const { call, init, repo } = require("./worker_harness.js");

(async () => {
  await init();
  let fail = 0;
  const files = [];
  for (const dir of ["repl/tests", "repl_sapl/tests"])
    for (const f of fs.readdirSync(path.join(repo, dir)).filter((f) => f.endsWith(".in")).sort()) files.push(path.join(repo, dir, f));
  for (const file of files) {
    await call({ type: "RSAPL_RESET" });
    const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.length);
    const got = [];
    const t = Date.now();
    for (const line of lines) {
      const r = await call({ type: "RSAPL_EVAL", line });
      got.push(r.success ? String(r.output).split("\n")[0] : `fout: ${r.error}`);
    }
    const want = fs.readFileSync(file.replace(/\.in$/, ".expected"), "utf8").trimEnd();
    const ok = got.length > 0 && got.join("\n") === want;
    console.log(`${ok ? "ok  " : "FOUT"}  rs ${path.basename(file)} (${Date.now() - t} ms)`);
    if (!ok) { fail = 1; console.log(got.join("\n")); }
  }
  // Een wasm-trap (1 / 0) laat het exemplaar sterven; de worker bouwt de
  // sessie opnieuw op uit de eerder verwerkte regels (8 oktober 2026).
  await call({ type: "RSAPL_RESET" });
  const seq = [":def f x = x + 1", ":def big =: f 41", "big", "it + 1", ":import \"lib/list.spp\" as L",
    "1 / 0", "res1", "big", "L.sum [1, 2, 3]", "f 9", ":undo", "res1"];
  const out = [];
  for (const line of seq) {
    const r = await call({ type: "RSAPL_EVAL", line });
    out.push(r.success ? String(r.output).split("\n")[0] : `fout: ${r.error}`);
  }
  const want = ["gedefinieerd: f", "gedefinieerd: big", "42", "43", "geïmporteerd: L",
    "fout: de REPL-engine stopte (bv. 1 / 0); de sessie is opnieuw opgebouwd (5 eerdere regels opnieuw uitgevoerd, resN opnieuw berekend)",
    "43", "42", "6", "10", "ongedaan gemaakt", "43"];
  const okTrap = JSON.stringify(out) === JSON.stringify(want);
  console.log(`${okTrap ? "ok  " : "FOUT"}  rs sessie overleeft een wasm-trap`);
  if (!okTrap) { fail = 1; console.log(out.join("\n")); }
  process.exit(fail);
})();
