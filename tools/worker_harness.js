// Gedeelde Node-omgeving voor websapl/engine/worker.js (zonder browser):
// laadt de worker met minimale importScripts/fetch/postMessage-shims en
// geeft `call(msg)` (stuurt een bericht, wacht op het antwoord met hetzelfde
// id) en `init()`. Gebruikt door repl_test.js en modules_test.js. Uit
// repl_test.js gehaald op 5 oktober 2026.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repo = path.resolve(__dirname, "..", "..");
const engineDir = path.join(repo, "websapl", "engine");
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

const init = () => new Promise((r) => { initResolve = r; self.onmessage({ data: { type: "INIT" } }); });

module.exports = { call, init, repo };
