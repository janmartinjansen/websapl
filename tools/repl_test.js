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
const vm = require("vm");

const repo = path.resolve(__dirname, "..", "..");
const engineDir = path.join(repo, "websapl", "engine");
const testDir = path.join(repo, "repl", "tests");
process.chdir(engineDir);

// == Een minimale worker-omgeving ============================================
const pending = new Map();
let initResolve;
global.self = global;
global.postMessage = (m) => {
  if (m.type === "INIT_DONE") return initResolve && initResolve();
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
global.importScripts = (p) => {
  const file = path.join(engineDir, p.split("?")[0]);
  const code = fs.readFileSync(file, "utf8") + "\n;globalThis.createJMVMModule = createJMVMModule;";
  // Cache-buster (`?v=...`) strippen: in de browser een URL, hier een pad.
  const strip = (f) => (typeof f === "string" ? f.split("?")[0] : f);
  const fsShim = { ...fs, readFileSync: (f, ...rest) => fs.readFileSync(strip(f), ...rest) };
  const req = (m) => (m === "node:fs" || m === "fs" ? fsShim : require(m));
  new Function("require", "__dirname", "__filename", code)(req, engineDir, file);
};
// Eerst zoals in de browser (relatief aan engine/); daarna de repo-root,
// voor testmodules die niet in websapl/ staan (bv. preprocess/tests/).
global.fetch = async (url) => {
  let file = path.resolve(engineDir, url.split("?")[0]);
  if (!fs.existsSync(file) && url.startsWith("../")) file = path.resolve(repo, url.slice(3).split("?")[0]);
  if (!fs.existsSync(file)) return { ok: false };
  const buf = fs.readFileSync(file);
  return {
    ok: true,
    text: async () => buf.toString("utf8"),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};
vm.runInThisContext(fs.readFileSync(path.join(engineDir, "worker.js"), "utf8"), { filename: "worker.js" });

let seq = 0;
function call(msg) {
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    self.onmessage({ data: { ...msg, id } });
  });
}

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
  await new Promise((r) => { initResolve = r; self.onmessage({ data: { type: "INIT" } }); });
  let fail = 0;
  for (const name of fs.readdirSync(testDir).filter((f) => f.endsWith(".in")).sort()) {
    const init = await call({ type: "REPL_INIT" });
    if (!init.success) { console.log("REPL_INIT mislukt:", init.error); process.exit(1); }
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
