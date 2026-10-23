// notebook.html in headless Chrome (8 oktober 2026, stap 3 van
// docs/2026-10-08_notebook_in_sapl_plan.md): de pagina zelf, met de worker,
// via het DevTools-protocol. Start een statische server op websapl/ en
// Chrome (macOS-pad, of CHROME=...). Scenario's: kennismaking.spp helemaal;
// een wasm-trap na een `error`-cel; een cel wijzigen met Shift+Enter en dan
// alles; de volgorde "van boven naar beneden" (ook in het bestand);
// formulieren; interactieve cellen (fase E: klikken, een toets, de klok en
// het aantal beelden per seconde, opnieuw uitvoeren, een ander notebook).
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
// Vóór een actie de status op een vaste tekst: twee runs na elkaar kunnen
// precies dezelfde "klaar (36 ms, alles)" geven (15 oktober 2026).
const mark = `document.getElementById("status").textContent = "(wacht)"; window.__mark = "(wacht)";`;

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
    // Cel 0 is niet opnieuw gecompileerd: de REPL stuurt @@defsame, het
    // paneel blijft staan (11 oktober 2026).
    check("definitiepaneel blijft bij een ongewijzigde cel", /✓ x :: Num/.test(st[2]), st.join("\n"));

    writeNb("eerst = later + 1", "later = 41", "eerst");
    st = await open("notebooks/_browser_test.spp");
    check("in elke volgorde: een latere cel gebruiken", st[4] === "42", st.join("\n"));
    st = await act(`const s = document.getElementById("sel-order"); s.value = "top"; s.dispatchEvent(new Event("change")); document.getElementById("btn-run").click();`);
    const saved = await ev(`JSON.parse(localStorage.getItem("${STORE_KEY}")).text.split("\\n")[0]`);
    check("van boven naar beneden: fout bij de cel, en in het bestand", /latere cel \[2\]/.test(st[2]) && /niet uitgevoerd/.test(st[4]) &&
      saved === "//%% [instellingen] volgorde=boven-naar-beneden", st.join("\n") + "\n" + saved);
    // Formulieren (fase C van docs/2026-10-15_notebook_integraal_plan.md):
    // een wijziging komt in de definitie terecht, en wat ervan afhangt draait.
    writeNb("::Opties = { !aantal : Int, !aan : Bool }\n\nopties = Opties 3 False\nk = 5", "D.form opties",
      "aantal opties * 10 + (if (aan opties) 1 0)", "D.slider 0 10 k", "k * 2");
    st = await open("notebooks/_browser_test.spp");
    const formIn = (sel) => `document.querySelectorAll(".cell")[1].querySelector("${sel}")`;
    const src0 = `document.querySelectorAll(".cell")[0].querySelector("textarea").value`;
    check("formulier: getoond, afhankelijke cellen goed", st[4] === "30" && st[6] === "10" && await ev(`!!${formIn("input[type=number]")}`), st.join("\n"));
    st = await act(`const i = ${formIn("input[type=number]")}; i.value = "7"; i.dispatchEvent(new Event("change"));`);
    check("formulier: getal gewijzigd, in de bron en in de afhankelijke cel", st[4] === "70" && /opties = Opties 7 False/.test(await ev(src0)), st.join("\n") + "\n" + await ev(src0));
    st = await act(`${formIn("input[type=checkbox]")}.click();`);
    check("formulier: vinkje", st[4] === "71" && /opties = Opties 7 True/.test(await ev(src0)), st.join("\n"));
    st = await act(`const r = document.querySelectorAll(".cell")[3].querySelector("input[type=range]"); r.value = "8"; r.dispatchEvent(new Event("input"));`);
    check("schuifbalk: k = 8 in de bron, k * 2 = 16", st[6] === "16" && /\bk = 8\b/.test(await ev(src0)), st.join("\n") + "\n" + await ev(src0));

    writeNb("::Kaart = { !titel : String }\n\nkaart = Kaart \"x\"", "D.form kaart", "strlen (titel kaart)");
    st = await open("notebooks/_browser_test.spp");
    st = await act(`const i = ${formIn("input[type=text]")}; i.value = 'a "b"\\\\c'; i.dispatchEvent(new Event("change"));`);
    check("formulier: tekst met \" en \\ terug in de bron, lengte 7", st[4] === "7" && (await ev(src0)).includes('kaart = Kaart "a \\"b\\"\\\\c"'), st.join("\n") + "\n" + await ev(src0));

    // Interactieve cellen (fase E): notebooks/interactief.spp, de zeef (cel 3)
    // en de bal (cel 6). Getoetst op de widgets en het protocol, niet op
    // pixels (een plaatje blijft in headless Chrome leeg).
    st = await open("notebooks/interactief.spp");
    const W = `[...window.__nbWidgets.values()]`;
    const zeef = `${W}.find((w) => w.ms === 0)`, bal = `${W}.find((w) => w.ms > 0)`;
    const groen = `((${zeef}).c.output.blocks[1].content.match(/GraphDisc 10 /g) || []).length`;
    const waitFor = async (js, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(js)) return true; await sleep(50); } return false; };
    check("interactief.spp: twee interactieve cellen, met een canvas", (await ev(`window.__nbWidgets.size`)) === 2 && st[5] === "[canvas]" && /\[canvas\]$/.test(st[8]), st.join("\n"));
    const clickZeef = `(() => { const cv = (${zeef}).root.querySelector("canvas"); const r = cv.getBoundingClientRect();
      cv.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); })()`;
    for (let k = 1; k <= 3; k++) { await ev(clickZeef); await waitFor(`${groen} === ${k}`); }
    check("zeef: drie klikken, drie priemgetallen groen", (await ev(groen)) === 3, await ev(`(${zeef}).c.output.blocks[1].content.slice(0, 200)`));
    await ev(`(() => { const r = (${zeef}).root; r.focus(); r.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })); })()`);
    check("zeef: een toets (met de focus op de uitvoer) zet ook een stap", await waitFor(`${groen} === 4`), await ev(groen));
    check("zeef: de rondgang staat onder de uitvoer", /ms per gebeurtenis/.test(await ev(`(${zeef}).foot.textContent`)), await ev(`(${zeef}).foot.textContent`));
    const f0 = await ev(`(${bal}).frames`);
    await sleep(2000);
    const fps = ((await ev(`(${bal}).frames`)) - f0) / 2;
    const rt = await ev(`(${bal}).times.reduce((a, b) => a + b, 0) / (${bal}).times.length`);
    console.log(`      bal: ${fps} beelden per seconde (D.animated 40), rondgang ${rt.toFixed(1)} ms`);
    check("bal: minstens 20 beelden per seconde", fps >= 20, `${fps}`);
    const tok0 = await ev(`(${zeef}).tok`);
    st = await act(`document.getElementById("btn-run").click();`);
    check("opnieuw uitvoeren: nieuwe widgets, de zeef weer leeg", (await ev(`window.__nbWidgets.size`)) === 2 && (await ev(`(${zeef}).tok`)) !== tok0 && (await ev(groen)) === 0, st.join("\n"));
    await ev(clickZeef);
    check("en daarna weer een stap", await waitFor(`${groen} === 1`), await ev(groen));
    if (WB) {
      // Een vers proces begint de sleutels opnieuw: na een herstart mag geen
      // oud widget meer gebeurtenissen sturen (anders kon een klik op de zeef
      // bij het model van een andere cel uitkomen).
      spawnSync("pkill", ["-TERM", "-P", String(server.pid), "rs-driver"]);
      await sleep(300);
      st = await act(`const ta = document.querySelectorAll(".cell textarea")[3];
        ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));`);
      check("na een gestopt proces, alleen de bal opnieuw: de zeef is gestopt, de bal loopt",
        (await ev(`window.__nbWidgets.size`)) === 1 && (await ev(`!!(${bal})`)) && !(await ev(`!!(${zeef})`)), st.join("\n"));
    }
    st = await open("notebooks/_browser_test.spp");
    check("een ander notebook: alle interactieve cellen gestopt", (await ev(`window.__nbWidgets.size`)) === 0, "");

    await ev(`localStorage.clear()`);
    ws.close();
  } catch (e) {
    console.log("FOUT  " + e.stack);
    fail = 1;
  }
  cleanup();
  process.exit(fail);
})();
