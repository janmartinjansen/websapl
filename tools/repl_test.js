// REPL-regressietests voor de WebSapl-REPL (27 september 2026): draait
// websapl/engine/worker.js in Node (zonder browser) en voert elke
// repl/tests/<naam>.in er regel voor regel doorheen, zoals websapl/js/app.js
// dat doet. Vergelijkt per invoerregel de eerste uitvoerregel met
// repl/tests/<naam>.expected -- dezelfde bestanden als
// repl/tests/run_repl_tests.sh voor de Python- en C++-REPL.
//
//   node websapl/tools/repl_test.js            (vanuit de repo-root)
const fs = require("fs");
const path = require("path");
const { call, init, repo } = require("./worker_harness.js");
const testDir = path.join(repo, "repl", "tests");

// Eén invoerregel -> de eerste uitvoerregel, zoals de terminal-REPL's die tonen.
async function runLine(line) {
  let r;
  if (line.startsWith(":def")) {
    r = await call({ type: "REPL_EVAL", cmd: "def", text: line.slice(4).trim() });
    return r.success ? `gedefinieerd: ${r.name}` : `fout: ${r.error}`;
  }
  if (line.startsWith(":import")) {
    r = await call({ type: "REPL_EVAL", cmd: "def", text: "import " + line.slice(7).trim() });
    return r.success ? `geïmporteerd: ${r.name.slice(7)}` : `fout: ${r.error}`;
  }
  if (line === ":undo" || line === ":reset") {
    r = await call({ type: "REPL_EVAL", cmd: line.slice(1) });
    return r.success ? (line === ":undo" ? "ongedaan gemaakt" : "sessie geleegd") : `fout: ${r.error}`;
  }
  r = await call({ type: "REPL_EVAL", cmd: "eval", line });
  return r.success ? String(r.output).split("\n")[0] : `fout: ${r.error}`;
}

(async () => {
  await init();
  let fail = 0;
  for (const name of fs.readdirSync(testDir).filter((f) => f.endsWith(".in")).sort()) {
    const init = await call({ type: "REPL_INIT" });
    if (!init.success) { console.log("REPL_INIT mislukt:", init.error); process.exit(1); }
    // REPL_INIT doet niets als er al een sessie is (replInit), dus per bestand
    // ook :reset -- anders liepen alle bestanden door in één sessie, en zag
    // `res1` in it.in de res1 van een vorig bestand (6 oktober 2026). De
    // andere twee REPL's starten per bestand een vers proces.
    const reset = await call({ type: "REPL_EVAL", cmd: "reset" });
    if (!reset.success) { console.log(":reset mislukt:", reset.error); process.exit(1); }
    const lines = fs.readFileSync(path.join(testDir, name), "utf8").split("\n").filter((l) => l.trim());
    const expected = fs.readFileSync(path.join(testDir, name.replace(/\.in$/, ".expected")), "utf8").split("\n").filter((l) => l.trim());
    const got = [];
    for (const line of lines) got.push((await runLine(line)).split("\n")[0]);
    const bad = got.map((g, i) => [g, expected[i], lines[i]]).filter(([g, e]) => g !== e);
    if (bad.length === 0 && got.length === expected.length) console.log(`ok    websapl ${name}`);
    else {
      fail = 1;
      console.log(`FOUT  websapl ${name}`);
      for (const [g, e, l] of bad) console.log(`  ${l}\n    kreeg:    ${g}\n    verwacht: ${e}`);
    }
  }
  process.exit(fail);
})();
