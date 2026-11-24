// De pagina sapl2wasm.html (retag2wasm in de browser, 24 november 2026) in headless Chrome:
// alle 13 kernbenchmarks via de knop Run. Per benchmark moet de kolom "direct" dezelfde uitvoer
// geven als de JMVM, of (voor de programma's die te diep gaan voor de stack van de browser) de
// stackmelding; de kolom "eigen stack" moet voor alle 13 dezelfde uitvoer geven. Plan:
// docs/2026-11-24_retag2wasm_in_websapl_plan.md.
//
//   node websapl/tools/sapl2wasm_browser_test.js            (vanuit de repo-root)
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repo = path.resolve(__dirname, "..", "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HTTP_PORT = 8767, CDP_PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMEN = ["fib", "primes", "queens", "sort", "knights", "hamming", "match", "twice", "eval", "sprimes", "parsetest", "prolog", "eval2"];
// lopen in Chrome (pagina, standaard stack) via wasm door (24 nov 2026: 9 van de 13); de rest mag
// de stackmelding geven. Een regressie die er een van deze laat vastlopen, faalt dus.
const MOET_DOOR = ["fib", "primes", "queens", "knights", "hamming", "match", "sprimes", "parsetest", "eval2"];

// Draait in de pagina: een voorbeeld kiezen, Run, wachten, de kolommen uitlezen.
const SCRIPT = (n) => `(async () => {
  const $ = (id) => document.getElementById(id);
  for (let i = 0; i < 200 && $("run").disabled; i++) await new Promise((r) => setTimeout(r, 200));
  const s = $("example"); s.value = ${JSON.stringify(n)}; s.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 500));
  $("run").click();
  await new Promise((r) => setTimeout(r, 300));
  for (let i = 0; i < 600 && $("run").disabled; i++) await new Promise((r) => setTimeout(r, 200));
  return { ...window.sapl2wasmLaatste, verdict: $("verdict").innerText };
})()`;

(async () => {
  let fail = 0;
  const check = (label, ok, detail) => { console.log(`${ok ? "ok  " : "FOUT"}  ${label}`); if (!ok) { fail = 1; if (detail) console.log("      " + detail); } };
  const server = spawn("python3", ["-m", "http.server", String(HTTP_PORT)], { cwd: path.join(repo, "websapl"), stdio: "ignore" });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sapl2wasm-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let targets = [];
    for (let i = 0; i < 50 && !targets.length; i++) { try { targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter((t) => t.type === "page"); } catch (_) {} await sleep(200); }
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    let id = 0; const waiting = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
    await new Promise((r) => (ws.onopen = r));
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const page = `http://localhost:${HTTP_PORT}/sapl2wasm.html`;
    for (let i = 0; i < 50; i++) { try { await fetch(page); break; } catch (_) { await sleep(200); } }
    await send("Page.navigate", { url: page });
    await sleep(1500);
    let door = 0;
    for (const n of NAMEN) {
      const r = await send("Runtime.evaluate", { expression: SCRIPT(n), returnByValue: true, awaitPromise: true, timeout: 180000 });
      const v = r.result && r.result.result && r.result.result.value;
      if (!v) { check(n, false, JSON.stringify(r).slice(0, 300)); continue; }
      // de hele uitvoer gelijk aan die van de JMVM, niet alleen res:
      const d = v.direct, e = v.eigen;
      if (d.ok && d.same) door++;
      const okD = (d.ok && d.same) || (d.stack && !MOET_DOOR.includes(n));
      const okE = e.ok && e.same;
      const f = (x) => (x.ok ? `${x.ms} ms${x.same ? "" : " ANDERE UITVOER"}` : x.stack ? "stack" : `fout (${x.stage})`);
      check(`${n.padEnd(10)} JMVM ${v.jmvm} ms · direct ${f(d)} · eigen stack ${f(e)}`, okD && okE, v.verdict);
    }
    console.log(`${door} van ${NAMEN.length} via wasm (zelfde uitvoer als de JMVM), de rest met de stackmelding`);
  } finally {
    chrome.kill(); server.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
  process.exit(fail);
})();
