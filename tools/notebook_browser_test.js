// notebook.html in headless Chrome (8 oktober 2026, stap 3 van
// docs/2026-10-08_notebook_in_sapl_plan.md): de pagina zelf, met de worker,
// via het DevTools-protocol. Start een statische server op websapl/ en
// Chrome (macOS-pad, of CHROME=...). Scenario's: kennismaking.spp helemaal;
// een wasm-trap na een `error`-cel; een cel wijzigen met Shift+Enter en dan
// alles; de volgorde "van boven naar beneden" (ook in het bestand); de oude
// engine (beeld) via de keuze.
//
//   node websapl/tools/notebook_browser_test.js        (vanuit de repo-root)
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repo = path.resolve(__dirname, "..", "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HTTP_PORT = 8765, CDP_PORT = 9333;
const TEST_NB = path.join(repo, "websapl", "notebooks", "_browser_test.spp");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FOUT"}  ${label}`);
  if (!ok) { fail = 1; if (detail) console.log("      " + String(detail).replace(/\n/g, "\n      ")); }
}

const STATE = `[document.getElementById("status").textContent,
  document.getElementById("banner").hidden ? "" : document.getElementById("banner").textContent,
  ...[...document.querySelectorAll(".cell")].map((c) => ((c.querySelector(".out") ? c.querySelector(".out").innerText.replace(/\\s+/g, " ") : "") + (c.querySelector("canvas") ? " [canvas]" : "")).trim())]`;
const DONE = `document.getElementById("status").textContent.startsWith("klaar (") && document.getElementById("status").textContent !== window.__mark`;
const mark = `window.__mark = document.getElementById("status").textContent;`;

(async () => {
  const server = spawn("python3", ["-m", "http.server", String(HTTP_PORT)], { cwd: path.join(repo, "websapl"), stdio: "ignore" });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nbtest-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const cleanup = () => { chrome.kill(); server.kill(); try { fs.unlinkSync(TEST_NB); } catch (_) {} };
  try {
    let targets = [];
    for (let i = 0; i < 50 && !targets.length; i++) { try { targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter((t) => t.type === "page"); } catch (_) {} await sleep(200); }
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    let id = 0; const waiting = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
    await new Promise((r) => (ws.onopen = r));
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.result.value;
    const waitDone = async () => { const t = Date.now(); while (Date.now() - t < 90000) { await sleep(200); try { if (await ev(DONE)) return ev(STATE); } catch (_) {} } return ["tijdslimiet", "", ...(await ev(STATE))]; };
    const open = async (nb) => { await send("Page.navigate", { url: `http://localhost:${HTTP_PORT}/notebook.html?nb=${nb}&run=1` }); await sleep(500); await ev("window.__mark = ''"); return waitDone(); };
    const act = async (js) => { await ev(`(() => { ${mark} ${js} })()`); return waitDone(); };
    const writeNb = (...cells) => fs.writeFileSync(TEST_NB, cells.map((c) => "//%%\n" + c).join("\n") + "\n");

    // Een schone start met de nieuwe engine (standaard).
    await send("Page.navigate", { url: `http://localhost:${HTTP_PORT}/notebook.html` });
    await sleep(300);
    await ev(`localStorage.clear()`);

    let st = await open("notebooks/kennismaking.spp");
    const [status, banner, ...outs] = st;
    check("kennismaking.spp: alles uitgevoerd, geen melding", status.startsWith("klaar (") && !banner, st.join("\n"));
    check("kennismaking.spp: priemen, tabel, grafieken, render-haak, type- en λ-cellen",
      outs[2].startsWith("[2, 3, 5, 7") && /n-de priemgetal/.test(outs[5]) && outs[6] === "[canvas]" && outs[7] === "[canvas]" &&
      outs[10] === "🌡 21 °C" && /zeef ::/.test(outs[16]) && /^lc>/.test(outs[17]) && outs[22] === "[canvas]", st.join("\n"));

    writeNb("x = 6", "x * 7", "error \"au\"", "1 / 0", "x + 1");
    st = await open("notebooks/_browser_test.spp");
    check("wasm-trap: bij de goede cel, de cel met error houdt haar melding",
      st[3] === "42" && st[4] === "au" && /engine stopte in deze cel/.test(st[5]) && /niet uitgevoerd/.test(st[6]), st.join("\n"));
    st = await act(`const ta = document.querySelectorAll(".cell textarea")[3]; ta.value = "7 / 1"; ta.dispatchEvent(new Event("input"));
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));`);
    check("Shift+Enter na de trap: alleen die cel, opnieuw opgebouwd", /1 cel\)/.test(st[0]) && st[5] === "7", st.join("\n"));
    st = await act(`document.getElementById("btn-run").click();`);
    check("daarna alles", st[3] === "42" && st[5] === "7" && st[6] === "7", st.join("\n"));

    writeNb("eerst = later + 1", "later = 41", "eerst");
    st = await open("notebooks/_browser_test.spp");
    check("in elke volgorde: een latere cel gebruiken", st[4] === "42", st.join("\n"));
    st = await act(`const s = document.getElementById("sel-order"); s.value = "top"; s.dispatchEvent(new Event("change")); document.getElementById("btn-run").click();`);
    const saved = await ev(`JSON.parse(localStorage.getItem("websapl_notebook")).text.split("\\n")[0]`);
    check("van boven naar beneden: fout bij de cel, en in het bestand", /latere cel \[2\]/.test(st[2]) && /niet uitgevoerd/.test(st[4]) &&
      saved === "//%% [instellingen] volgorde=boven-naar-beneden", st.join("\n") + "\n" + saved);
    st = await act(`const s = document.getElementById("sel-engine"); s.value = "beeld"; s.dispatchEvent(new Event("change"));
      const o = document.getElementById("sel-order"); o.value = "any"; o.dispatchEvent(new Event("change")); document.getElementById("btn-run").click();`);
    check("de oude engine (beeld) via de keuze", st[4] === "42", st.join("\n"));
    await ev(`localStorage.clear()`);
    ws.close();
  } catch (e) {
    console.log("FOUT  " + e.stack);
    fail = 1;
  }
  cleanup();
  process.exit(fail);
})();
