// Dezelfde worker in een echte browser (headless Chrome): Compile + Run (gen1
// schrijft .jvb, de tekst komt uit de tool-wasm jvbtool.js), en een losse
// .jmvm-tekst die via jmvm2jvb draait. Aanvulling op jvb_paths_test.js (Node),
// voor importScripts/wasm in een echte Worker. 11 oktober 2026.
//
//   node websapl/tools/jvb_browser_test.js            (vanuit de repo-root)
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repo = path.resolve(__dirname, "..", "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HTTP_PORT = 8766, CDP_PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Draait in de pagina: een eigen worker, INIT, en de berichten na elkaar.
const SCRIPT = (src, text, url = "engine/worker.js") => `(async () => {
  const w = new Worker(${JSON.stringify(url)});
  const wait = (type) => new Promise((r) => { const h = (e) => { if (e.data.type === type) { w.removeEventListener("message", h); r(e.data); } }; w.addEventListener("message", h); });
  const initDone = wait("INIT_DONE"); w.postMessage({ type: "INIT" }); await initDone;
  const out = {};
  let p = wait("COMPILE_COMPLETE");
  w.postMessage({ type: "COMPILE", id: 1, source: ${JSON.stringify(src)}, path: "/workspace/queens.cfp", stages: ["jmvm"], strictness: true });
  const c = await p;
  const f = c.success && c.files.find((x) => x.stage === "jmvm");
  out.compiled = !!f; out.text = f ? f.content : (c.stderr || c.error || "");
  p = wait("RUN_COMPLETE"); w.postMessage({ type: "RUN", id: 2, contentOrPath: out.text, isPath: false, stdin: "" });
  out.res1 = (await p).metrics.res;
  p = wait("RUN_COMPLETE"); w.postMessage({ type: "RUN", id: 3, contentOrPath: ${JSON.stringify(text)}, isPath: false, stdin: "" });
  const m2 = (await p).metrics;
  out.res2 = m2.res; out.instr = m2.instr_executed; out.calls = m2.calls;
  w.terminate();
  return out;
})()`;

(async () => {
  let fail = 0;
  const check = (label, ok, detail) => { console.log(`${ok ? "ok  " : "FOUT"}  ${label}`); if (!ok) { fail = 1; if (detail) console.log("      " + detail); } };
  const server = spawn("python3", ["-m", "http.server", String(HTTP_PORT)], { cwd: path.join(repo, "websapl"), stdio: "ignore" });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "jvbbrowser-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let targets = [];
    for (let i = 0; i < 50 && !targets.length; i++) { try { targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter((t) => t.type === "page"); } catch (_) {} await sleep(200); }
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    let id = 0; const waiting = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
    await new Promise((r) => (ws.onopen = r));
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const page = `http://localhost:${HTTP_PORT}/index.html`;
    for (let i = 0; i < 50; i++) { try { await fetch(page); break; } catch (_) { await sleep(200); } }
    await send("Page.navigate", { url: page });
    await sleep(1500);
    const src = fs.readFileSync(path.join(repo, "benchmarks/queens.cfp"), "utf8");
    const text = fs.readFileSync(path.join(repo, "benchmarks/primes.jmvm"), "utf8") + "\n";
    const r = await send("Runtime.evaluate", { expression: SCRIPT(src, text), returnByValue: true, awaitPromise: true, timeout: 120000 });
    const v = r.result && r.result.result && r.result.result.value;
    if (!v) { check("worker in de browser", false, JSON.stringify(r).slice(0, 400)); }
    else {
      check("compile (gen1 -> .jvb, tekst uit jvb2jmvm)", v.compiled && v.text.startsWith("start"), v.text.slice(0, 200));
      check("run na compile (queens, res 2680)", v.res1 === "2680", v.res1);
      check("losse .jmvm-tekst via jmvm2jvb (primes, res 48619)", v.res2 === "48619", v.res2);
      // jmvm.wasm telt alleen calls en creates (variant websapl); met
      // ?tellen=1 laadt de worker jmvm_tel.wasm, die ook instructies telt.
      check("jmvm.wasm: calls geteld, geen instructies", v.calls > 0 && v.instr === null, `calls ${v.calls}, instr ${v.instr}`);
    }
    const r2 = await send("Runtime.evaluate", { expression: SCRIPT(src, text, "engine/worker.js?tellen=1"), returnByValue: true, awaitPromise: true, timeout: 120000 });
    const v2 = r2.result && r2.result.result && r2.result.result.value;
    check("?tellen=1: jmvm_tel.wasm telt ook instructies (zelfde uitkomsten)", !!v2 && v2.res1 === "2680" && v2.res2 === "48619" && v2.instr > 0 && v2.calls === v.calls, v2 && `res ${v2.res1}/${v2.res2}, instr ${v2.instr}, calls ${v2.calls}`);
  } finally { chrome.kill(); server.kill(); }
  console.log(fail ? "fout(en)" : "alles in orde");
  process.exit(fail);
})();
