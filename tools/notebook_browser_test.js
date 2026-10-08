// notebook.html in headless Chrome (8 oktober 2026, stap 3 van
// docs/2026-10-08_notebook_in_sapl_plan.md): de pagina zelf, met de worker,
// via het DevTools-protocol. Start een statische server op websapl/ en
// Chrome (macOS-pad, of CHROME=...). Scenario's: kennismaking.spp helemaal;
// een wasm-trap na een `error`-cel; een cel wijzigen met Shift+Enter en dan
// alles; de volgorde "van boven naar beneden" (ook in het bestand).
//
// Met --workbench dezelfde pagina in de Workbench (workbench/server.js,
// `?engine=server`): de engine is daar een eigen ./rs-driver-proces
// (/api/notebook/nb). Een trap is daar een crash van dat proces (diepe
// recursie zonder allocatie; native geeft 1 / 0 geen trap).
//
//   node websapl/tools/notebook_browser_test.js [--workbench]   (vanuit de repo-root)
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repo = path.resolve(__dirname, "..", "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HTTP_PORT = 8765, CDP_PORT = 9333;
const WB = process.argv.includes("--workbench");
const TEST_NB = path.join(repo, ...(WB ? [] : ["websapl"]), "notebooks", "_browser_test.spp");
const PAGE = WB ? `http://localhost:${HTTP_PORT}/websapl/notebook.html?engine=server&` : `http://localhost:${HTTP_PORT}/notebook.html?`;
const STORE_KEY = WB ? "workbench_notebook" : "websapl_notebook";
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
  const server = WB ? spawn("node", ["workbench/server.js", String(HTTP_PORT)], { cwd: repo, stdio: "ignore" })
    : spawn("python3", ["-m", "http.server", String(HTTP_PORT)], { cwd: path.join(repo, "websapl"), stdio: "ignore" });
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
    const open = async (nb) => { await send("Page.navigate", { url: `${PAGE}nb=${nb}&run=1` }); await sleep(500); await ev("window.__mark = ''"); return waitDone(); };
    const act = async (js) => { await ev(`(() => { ${mark} ${js} })()`); return waitDone(); };
    const writeNb = (...cells) => fs.writeFileSync(TEST_NB, cells.map((c) => "//%%\n" + c).join("\n") + "\n");

    // Een schone start met de nieuwe engine (standaard).
    for (let i = 0; i < 50; i++) { try { await fetch(PAGE); break; } catch (_) { await sleep(200); } }
    await send("Page.navigate", { url: PAGE });
    await sleep(300);
    await ev(`localStorage.clear()`);

    let st = await open("notebooks/kennismaking.spp");
    const [status, banner, ...outs] = st;
    check("kennismaking.spp: alles uitgevoerd, geen melding", status.startsWith("klaar (") && !banner, st.join("\n"));
    check("kennismaking.spp: priemen, tabel, grafieken, render-haak, type- en λ-cellen",
      outs[2].startsWith("[2, 3, 5, 7") && /n-de priemgetal/.test(outs[5]) && outs[6] === "[canvas]" && outs[7] === "[canvas]" &&
      outs[10] === "🌡 21 °C" && /zeef ::/.test(outs[16]) && /^lc>/.test(outs[17]) && outs[22] === "[canvas]", st.join("\n"));

    writeNb(WB ? "x = 6\n\ndiep n = 1 + diep (n + 1)" : "x = 6", "x * 7", "error \"au\"", WB ? "diep 0" : "1 / 0", "x + 1");
    st = await open("notebooks/_browser_test.spp");
    if (WB) {
      // Native vangt de VM de diepe recursie zelf ("out of memory"): alleen
      // die cel, de rest loopt door. Een gestopt proces: de volgende run
      // begint met een vers proces.
      check("diepe recursie: melding bij die cel, de rest loopt door",
        st[3] === "42" && st[4] === "au" && /out of memory|stack/.test(st[5]) && st[6] === "7", st.join("\n"));
      spawnSync("pkill", ["-TERM", "-P", String(server.pid), "rs-driver"]);
      await sleep(300);
      st = await act(`document.getElementById("btn-run").click();`);
      check("na een gestopt proces: de volgende run bouwt het notebook opnieuw op", st[3] === "42" && st[4] === "au" && st[6] === "7", st.join("\n"));
    } else
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
    const saved = await ev(`JSON.parse(localStorage.getItem("${STORE_KEY}")).text.split("\\n")[0]`);
    check("van boven naar beneden: fout bij de cel, en in het bestand", /latere cel \[2\]/.test(st[2]) && /niet uitgevoerd/.test(st[4]) &&
      saved === "//%% [instellingen] volgorde=boven-naar-beneden", st.join("\n") + "\n" + saved);
    await ev(`localStorage.clear()`);
    ws.close();
  } catch (e) {
    console.log("FOUT  " + e.stack);
    fail = 1;
  }
  cleanup();
  process.exit(fail);
})();
