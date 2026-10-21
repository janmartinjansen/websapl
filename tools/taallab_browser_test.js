// taallab.html in headless Chrome (19 oktober 2026): de pagina zelf, met de
// worker, via het DevTools-protocol (zoals notebook_browser_test.js). Een
// statische server op websapl/ en Chrome (macOS-pad, of CHROME=...).
// Scenario's: tiny met queens; een ander programma zonder opnieuw te
// compileren; de JIT-route en beide routes naast elkaar; de REPL-tab; een programmafout; een fout in de taal zelf; calc; en de
// bewaarde wijziging na herladen. Met --screenshot=<pad.png> ook een plaatje.
//
//   node websapl/tools/taallab_browser_test.js   (vanuit de repo-root)
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repo = path.resolve(__dirname, "..", "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HTTP_PORT = 8766, CDP_PORT = 9334;
const PAGE = `http://localhost:${HTTP_PORT}/taallab.html`;
const SHOT = (process.argv.find((a) => a.startsWith("--screenshot=")) || "").slice(13);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FOUT"}  ${label}`);
  if (!ok) { fail = 1; if (detail) console.log("      " + String(detail).replace(/\n/g, "\n      ")); }
}

const STATE = `({ status: document.getElementById("status-text").textContent,
  out: document.getElementById("out").innerText, metrics: document.getElementById("metrics").textContent,
  fout: !!document.querySelector("#out .fout") })`;

(async () => {
  const server = spawn("python3", ["-m", "http.server", String(HTTP_PORT)], { cwd: path.join(repo, "websapl"), stdio: "ignore" });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tltest-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "--window-size=1400,900", "about:blank"], { stdio: "ignore" });
  const cleanup = () => { chrome.kill(); server.kill(); };
  try {
    let targets = [];
    for (let i = 0; i < 50 && !targets.length; i++) { try { targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter((t) => t.type === "page"); } catch (_) {} await sleep(200); }
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    let id = 0; const waiting = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
    await new Promise((r) => (ws.onopen = r));
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.result.value;
    const waitFor = async (cond, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { await sleep(150); try { if (await ev(cond)) return true; } catch (_) {} } return false; };
    // een run: de knop, dan wachten tot hij weer aan staat
    const run = async () => {
      await ev(`document.getElementById("metrics").textContent = "(wacht)"; document.getElementById("btn-run").click()`);
      await waitFor(`!document.getElementById("btn-run").disabled && document.getElementById("metrics").textContent !== "(wacht)" || document.querySelector("#out .fout") !== null && !document.getElementById("btn-run").disabled`);
      return ev(STATE);
    };
    const editors = `document.querySelectorAll(".CodeMirror")`;
    const setProg = (t) => ev(`${editors}[1].CodeMirror.setValue(${JSON.stringify(t)})`);
    const setLang = (t) => ev(`${editors}[0].CodeMirror.setValue(${JSON.stringify(t)})`);
    const getLang = () => ev(`${editors}[0].CodeMirror.getValue()`);

    for (let i = 0; i < 50; i++) { try { await fetch(PAGE); break; } catch (_) { await sleep(200); } }
    await send("Page.navigate", { url: PAGE });
    await sleep(300);
    await ev(`localStorage.clear()`);
    await send("Page.navigate", { url: PAGE });
    check("engine laadt", await waitFor(`document.getElementById("status-text").textContent === "Klaar" && ${editors}.length === 2 && ${editors}[0].CodeMirror.getValue().length > 0`), await ev(STATE).then(JSON.stringify));

    let st = await run();
    check("tiny queens.tiny: 92, taal gecompileerd", st.out === "92" && /taal gecompileerd in/.test(st.metrics), JSON.stringify(st));

    await ev(`(() => { const s = document.getElementById("sel-prog"); s.value = "primes.tiny"; s.onchange({ target: s }); })()`);
    await sleep(400);
    st = await run();
    check("ander programma zonder opnieuw compileren: 669", st.out === "669" && /taal al gecompileerd/.test(st.metrics), JSON.stringify(st));

    // de JIT-route: uitschrijven als Sapl+, gen1 in de browser, draaien
    const setRoute = (r) => ev(`(() => { const s = document.getElementById("sel-route"); s.value = "${r}"; s.onchange(); })()`);
    await setRoute("jit");
    st = await run();
    const sapl = await ev(`document.getElementById("sapl").textContent`);
    check("JIT-route: 669, met de uitgeschreven Sapl+", st.out === "669" && /JIT: .*compileren \(gen1\)/.test(st.metrics) && /f_main/.test(sapl) &&
      !(await ev(`document.getElementById("tab-sapl").disabled`)), JSON.stringify(st));
    st = await run();
    check("JIT-route opnieuw: al gecompileerd", st.out === "669" && /JIT: .*al gecompileerd/.test(st.metrics), JSON.stringify(st));
    await setRoute("beide");
    await setProg("fun main() = [1, 2 < 3];\n");
    st = await run();
    check("beide: hybride en JIT gelijk", /hybride: \(Cons 1 \(Cons 1 Nil\)\)/.test(st.out) && /JIT: +\(Cons 1 \(Cons 1 Nil\)\)/.test(st.out) && /gelijk$/.test(st.out), JSON.stringify(st));
    await setRoute("hybride");

    await setProg("fun main() = sq(2);\n");
    st = await run();
    check("programmafout: onbekende naam", st.fout && st.out === "onbekende naam sq", JSON.stringify(st));

    // een uitbreiding van de taal: ** als machtsverheffen, naar de kerntaal als een functie
    const lang = await getLang();
    await setLang(lang.replace(`Op "*" 6 0 (TBin "*")`, `Op "*" 6 0 (TBin "*"), Op "**" 7 1 (TBin "**")`)
      .replace(`  | otherwise = bin op (tiE a) (tiE b)`, `  | strEqual op "**" = apps (EVar "pow") [tiE a, tiE b]\n  | otherwise = bin op (tiE a) (tiE b)`));
    await setProg("fun pow(a, b) = if b == 0 then 1 else a * pow(a, b - 1);\nfun main() = 2 ** 3 ** 2;\n");
    st = await run();
    check("taal uitgebreid met **: 512, opnieuw gecompileerd", st.out === "512" && /taal gecompileerd in/.test(st.metrics), JSON.stringify(st));

    await setLang(lang.replace("tiE (TNum n) = ENum n", "tiE (TNum n) = ENum n +"));
    st = await run();
    check("fout in de taal: een melding, geen crash", st.fout && /taal/.test(st.out), JSON.stringify(st));
    await setLang(lang);

    await ev(`(() => { const s = document.getElementById("sel-lang"); s.value = "calc"; s.onchange({ target: s }); })()`);
    await waitFor(`${editors}[0].CodeMirror.getValue().indexOf("calcLang") >= 0`);
    st = await run();
    check("calc voorbeeld.calc: 24", st.out === "24", JSON.stringify(st));

    // bewaard na herladen: het gewijzigde calc-programma
    await setProg("1 + 2 * 3\n");
    await sleep(900);
    await send("Page.navigate", { url: PAGE });
    await waitFor(`document.getElementById("status-text").textContent === "Klaar" && ${editors}.length === 2 && ${editors}[1].CodeMirror.getValue().length > 0`);
    const prog = await ev(`${editors}[1].CodeMirror.getValue()`);
    check("na herladen: weer calc, met het gewijzigde programma", prog === "1 + 2 * 3\n" && (await ev(`document.getElementById("sel-lang").value`)) === "calc", prog);
    st = await run();
    check("en dat draait: 7", st.out === "7", JSON.stringify(st));

    // terug naar tiny: de taal is weer het origineel (gewijzigd en teruggezet),
    // het programma het gewijzigde
    await ev(`(() => { const s = document.getElementById("sel-lang"); s.value = "tiny"; s.onchange({ target: s }); })()`);
    await waitFor(`${editors}[0].CodeMirror.getValue().indexOf("tinyLang") >= 0`);
    await sleep(300);
    check("terug naar tiny: de taal ongewijzigd", (await getLang()) === lang && !/gewijzigd/.test(await ev(`document.getElementById("lang-note").textContent`)));

    // de REPL-tab: de taal in de REPL in Sapl (:lang), definities en
    // expressies via de JIT-route
    const replIn = async (line) => {
      await ev(`(() => { const i = document.getElementById("repl-in"); i.value = ${JSON.stringify(line)};
        i.onkeydown(new KeyboardEvent("keydown", { key: "Enter" })); })()`);
      await sleep(100);
      await waitFor(`!document.getElementById("repl-in").disabled`, 120000);
      return ev(`document.getElementById("repl-log").textContent.trim().split(String.fromCharCode(10)).pop()`);
    };
    await ev(`document.getElementById("tab-repl").click()`);
    const tReplStart = Date.now();
    let rl = await replIn("fun sq(x) = x * x;");
    const tLang = Date.now() - tReplStart;
    check(`REPL: definitie (taal geladen in ${tLang} ms)`, rl === "gedefinieerd", rl);
    const tExpr = Date.now();
    rl = await replIn("sq(7) + 1");
    check(`REPL: expressie met de definitie: 50 (${Date.now() - tExpr} ms)`, rl === "50", rl);
    rl = await replIn("[sq(2), 1 < 0]");
    check("REPL: een lijst", rl === "(Cons 4 (Cons 0 Nil))", rl);
    rl = await replIn("sq(y)");
    check("REPL: een fout in de taal", rl === "fout: onbekende naam y", rl);
    rl = await replIn(":undo");
    rl = await replIn("sq(2)");
    check("REPL: :undo haalt de definitie weg", rl === "fout: onbekende naam sq", rl);
    await ev(`document.getElementById("tab-out").click()`);

    if (SHOT) {
      await ev(`(() => { const s = document.getElementById("sel-lang"); s.value = "tiny"; s.onchange({ target: s }); })()`);
      await waitFor(`${editors}[0].CodeMirror.getValue().indexOf("tinyLang") >= 0`);
      await sleep(300);
      await run();
      const shot = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(SHOT, Buffer.from(shot.result.data, "base64"));
      console.log("      plaatje: " + SHOT);
      await ev(`document.getElementById("tab-repl").click()`);
      await sleep(200);
      const shotR = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(SHOT.replace(/\.png$/, "_repl.png"), Buffer.from(shotR.result.data, "base64"));
      console.log("      plaatje: " + SHOT.replace(/\.png$/, "_repl.png"));
      await ev(`document.getElementById("tab-out").click()`);
      // smal (telefoon): geen horizontale scroll
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await sleep(500);
      check("telefoonbreedte: geen horizontale scroll", await ev(`document.documentElement.scrollWidth <= 390`), await ev(`document.documentElement.scrollWidth`));
      const shot2 = await send("Page.captureScreenshot", { format: "png" });
      const smal = SHOT.replace(/\.png$/, "_smal.png");
      fs.writeFileSync(smal, Buffer.from(shot2.result.data, "base64"));
      console.log("      plaatje: " + smal);
    }
  } catch (err) {
    fail = 1; console.log("FOUT  " + err.stack);
  } finally {
    cleanup();
  }
  process.exit(fail);
})();
