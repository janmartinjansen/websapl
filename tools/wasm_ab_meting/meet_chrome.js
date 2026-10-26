// Warme A/B-meting van twee VM-wasms in headless Chrome, waar WebSapl echt
// draait (README.md hier).
//   node websapl/tools/wasm_ab_meting/meet_chrome.js <werkmap> [-n rondes] [--var a,b] [--los] [benchmark...]
// Vanuit de repo-root. Zet meet.html, meet_kern.js, worker.js (voor de
// opwarmrun) en een link naar benchmarks/ in de werkmap, serveert die op
// HTTP_PORT en stuurt Chrome erheen via CDP. Een verse Chrome per aanroep.
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HTTP_PORT = 8767, CDP_PORT = 9335;
const { zorgVoorJvb } = require("./jvb.js");
const { BENCHMARKS } = require("./meet_kern.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const werkmap = path.resolve(args.shift() || "");
const q = new URLSearchParams();
const bench = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-n") q.set("rondes", args[++i]);
  else if (args[i] === "--var") q.set("var", args[++i]);
  else if (args[i] === "--los") q.set("los", "1");
  else bench.push(args[i]);
}
if (bench.length) q.set("bench", bench.join(","));
zorgVoorJvb(bench.length ? bench : BENCHMARKS);
if (!fs.existsSync(werkmap)) { console.error("gebruik: meet_chrome.js <werkmap> [-n rondes] [--var a,b] [--los] [benchmark...]"); process.exit(2); }
for (const f of ["meet.html", "meet_kern.js"]) fs.copyFileSync(path.join(__dirname, f), path.join(werkmap, f));
fs.copyFileSync("websapl/engine/worker.js", path.join(werkmap, "worker.js"));
const bl = path.join(werkmap, "benchmarks");
try { fs.unlinkSync(bl); } catch (_) {}
fs.symlinkSync(path.resolve("benchmarks"), bl);

(async () => {
  const srv = spawn("python3", ["-m", "http.server", String(HTTP_PORT)], { cwd: werkmap, stdio: "ignore" });
  const profiel = fs.mkdtempSync(path.join(os.tmpdir(), "wasm-ab-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profiel}`, "about:blank"], { stdio: "ignore" });
  const stop = (code) => { chrome.kill(); srv.kill(); process.exit(code); };
  try {
    let targets = [];
    for (let i = 0; i < 50 && !targets.length; i++) { try { targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter((t) => t.type === "page"); } catch (_) {} await sleep(200); }
    for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${HTTP_PORT}/meet.html`); break; } catch (_) { await sleep(200); } }
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    let id = 0; const wachtend = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wachtend.has(d.id)) { wachtend.get(d.id)(d); wachtend.delete(d.id); } };
    await new Promise((r) => (ws.onopen = r));
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; wachtend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
    await send("Page.navigate", { url: `http://localhost:${HTTP_PORT}/meet.html?${q}` });
    while (!(await ev("window.__klaar === true"))) await sleep(2000);
    const uit = await ev("window.__uit");
    console.log(`${await ev("navigator.userAgent.match(/Chrome\\/[0-9.]+/)[0]")}${q.get("los") ? ", --los" : ""}\n${uit}`);
    stop(/^FOUT/.test(uit) ? 1 : 0);
  } catch (e) { console.log("FOUT " + e.stack); stop(1); }
})();
