// De meetlat van fase 1 (docs/2026-10-25_client_server_ontwerp.md) in de
// browser: twee tabbladen in headless Chrome met
// notebooks/incidenten_gedeeld.spp, tegen de echte gastheer en server. A
// voegt een incident toe, B ziet het; B schrijft op een oude versie (de
// update van A even vastgehouden) en krijgt een conflict; opnieuw uitvoeren
// sluit de oude verbinding (geen lek van sessies).
//
// Met --workbench: A in de Workbench (`?engine=server`, de engine is een
// eigen ./rs-driver-proces), B als WebSapl (de wasm-worker) van dezelfde
// server. Twee tabbladen met `engine=server` delen in de Workbench één
// notebooksessie (één globaal proces), zodat de run van de tweede de
// sleutels van de eerste ongeldig maakt; dat geldt voor elke interactieve
// cel en is hier dus niet te toetsen.
//
//   node websapl/tools/notebook_connected_browser_test.js [--workbench]   (vanuit de repo-root)
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repo = path.resolve(__dirname, "..", "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HTTP_PORT = 8766, CDP_PORT = 9334;
const HOST_PORT = 21000 + Math.floor(Math.random() * 1000);
const WB = process.argv.includes("--workbench");
const NB_REL = "notebooks/_verbonden_test.spp";
const NB_FILES = WB ? [path.join(repo, NB_REL), path.join(repo, "websapl", NB_REL)] : [path.join(repo, "websapl", NB_REL)];
const PAGE_A = WB ? `http://localhost:${HTTP_PORT}/websapl/notebook.html?engine=server&` : `http://localhost:${HTTP_PORT}/notebook.html?`;
const PAGE_B = WB ? `http://localhost:${HTTP_PORT}/websapl/notebook.html?` : PAGE_A;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FOUT"}  ${label}`);
  if (!ok) { fail = 1; if (detail) console.log("      " + String(detail).replace(/\n/g, "\n      ")); }
}

const W = `[...window.__nbWidgets.values()][0]`;
const BEELD = `(${W} ? ${W}.root.innerText.replace(/\\s+/g, " ") : "(geen widget)")`;

async function pagina(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
  const waitFor = async (js, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(js)) return true; } catch (_) {} await sleep(100); } return false; };
  return { ws, send, ev, waitFor, beeld: () => ev(BEELD) };
}

(async () => {
  const host = spawn("node", ["server/gastheer/host.js", "--port", String(HOST_PORT), "server/fase1/server.jmvm"], { cwd: repo, stdio: ["ignore", "ignore", "pipe"] });
  let hostLog = "";
  host.stderr.on("data", (d) => { hostLog += d; });
  const server = WB ? spawn("node", ["workbench/server.js", String(HTTP_PORT)], { cwd: repo, stdio: "ignore" })
    : spawn("python3", ["-m", "http.server", String(HTTP_PORT)], { cwd: path.join(repo, "websapl"), stdio: "ignore" });
  const nbTekst = fs.readFileSync(path.join(repo, "notebooks", "incidenten_gedeeld.spp"), "utf8").replace("ws://localhost:8090/", `ws://localhost:${HOST_PORT}/`);
  for (const f of NB_FILES) fs.writeFileSync(f, nbTekst);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nbverb-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const cleanup = () => { chrome.kill(); server.kill(); host.kill(); for (const f of NB_FILES) { try { fs.unlinkSync(f); } catch (_) {} } };
  try {
    let targets = [];
    for (let i = 0; i < 50 && !targets.length; i++) { try { targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter((t) => t.type === "page"); } catch (_) {} await sleep(200); }
    const tweede = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" })).json();
    const A = await pagina(targets[0].webSocketDebuggerUrl), B = await pagina(tweede.webSocketDebuggerUrl);
    for (let i = 0; i < 50; i++) { try { await fetch(PAGE_A); break; } catch (_) { await sleep(200); } }
    for (const [p, page] of [[A, PAGE_A], [B, PAGE_B]]) {
      await p.send("Page.navigate", { url: page }); await sleep(300);
      await p.ev("localStorage.clear()");
      await p.send("Page.navigate", { url: `${page}nb=${NB_REL}&run=1` });
    }
    check("A en B: verbonden, versie 0", await A.waitFor(`/versie 0/.test(${BEELD})`, 90000) && await B.waitFor(`/versie 0/.test(${BEELD})`, 90000), `A: ${await A.beeld()}\nB: ${await B.beeld()}`);
    check("de widget kent de url", (await A.ev(`${W}.root.title`)) === `verbonden met ws://localhost:${HOST_PORT}/: klik of typ (met de focus hier)`, await A.ev(`${W}.root.title`));

    const klik = `(() => { const r = ${W}.root; r.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 5 })); })()`;
    const toets = (k) => `(() => { const r = ${W}.root; r.focus(); r.dispatchEvent(new KeyboardEvent("keydown", { key: "${k}", bubbles: true })); })()`;

    await A.ev(klik);
    check("A klikt: opgeslagen, versie 1", await A.waitFor(`/versie 1/.test(${BEELD}) && /opgeslagen/.test(${BEELD})`), await A.beeld());
    check("de incidenten staan als tabel (D.records van een record uit een module)", await A.waitFor(`!!${W}.root.querySelector("table") && /plaats/.test(${W}.root.querySelector("table").innerText)`), await A.ev(`${W}.root.innerHTML.slice(0, 400)`));
    check("B ziet Plek 1 op versie 1, zonder herladen", await B.waitFor(`/versie 1/.test(${BEELD}) && /Plek 1/.test(${BEELD})`), await B.beeld());

    // Een conflict: de berichten van de server voor B even vasthouden.
    await B.ev(`(() => { const w = ${W}; const om = w.sock.onmessage; w.__vast = []; w.sock.onmessage = (e) => w.__vast.push(e);
      w.__los = () => { w.sock.onmessage = om; w.__vast.splice(0).forEach(om); }; })()`);
    await A.ev(klik);
    check("A: versie 2 met Plek 2", await A.waitFor(`/versie 2/.test(${BEELD}) && /Plek 2/.test(${BEELD})`), await A.beeld());
    await B.ev(toets("d"));
    await sleep(800);
    await B.ev(`${W}.__los()`);
    check("B schreef op versie 1: conflict, en de stand van de server", await B.waitFor(`/conflict/.test(${BEELD}) && /versie 2/.test(${BEELD}) && /Plek 2/.test(${BEELD})`), await B.beeld());
    await B.ev(toets("d"));
    check("B opnieuw: opgeslagen op versie 3", await B.waitFor(`/versie 3/.test(${BEELD}) && /opgeslagen/.test(${BEELD})`), await B.beeld());
    check("A ziet versie 3 met een gesloten incident", await A.waitFor(`/versie 3/.test(${BEELD}) && /dicht/.test(${BEELD})`), await A.beeld());

    // Een dubbelklik in A (de tweede vóór het ok): beide incidenten, geen conflict.
    const rijen = `(${W}.root.querySelector("table") ? ${W}.root.querySelector("table").rows.length - 1 : 0)`;
    const n0 = await A.ev(rijen);
    await A.ev(klik); await A.ev(klik);
    check("dubbelklik in A: versie 5, twee rijen erbij, geen conflict", await A.waitFor(`/versie 5/.test(${BEELD}) && /opgeslagen/.test(${BEELD}) && ${rijen} === ${n0 + 2}`) && !/conflict/.test(await A.beeld()), await A.beeld());

    // Een groot bericht (300 incidenten, ~26 KB) van een derde client, naar
    // beide tabbladen; dan stuurt A zelf zo'n groot bericht.
    const groot = fs.readFileSync(path.join(repo, "server", "fase1", "log.txt"), "utf8").split("\n").find((l) => l.startsWith("msg 9 ")).replace(/^msg 9 /, "").replace("incidenten 0", "incidenten 5");
    const C = new WebSocket(`ws://localhost:${HOST_PORT}/`);
    await new Promise((r) => (C.onopen = r));
    C.send(groot);
    check("groot bericht: A en B tonen 300 rijen op versie 6", await A.waitFor(`/versie 6/.test(${BEELD}) && ${rijen} === 300`, 20000) && await B.waitFor(`/versie 6/.test(${BEELD}) && ${rijen} === 300`, 20000), (await A.beeld()).slice(0, 200));
    await A.ev(klik);
    check("A stuurt zelf 301 incidenten: opgeslagen op versie 7, B ziet ze", await A.waitFor(`/versie 7/.test(${BEELD}) && /opgeslagen/.test(${BEELD})`, 20000) && await B.waitFor(`/versie 7/.test(${BEELD}) && ${rijen} === 301`, 20000), (await A.beeld()).slice(0, 200));
    console.log(`      rondgang bij 301 incidenten: ${await A.ev(`${W}.foot.textContent`)}`);
    C.close();
    for (let i = 0; i < 50 && (hostLog.match(/sessie [0-9]+ dicht/g) || []).length < 1; i++) await sleep(100);

    // Opnieuw uitvoeren in B: de oude verbinding gaat dicht, een nieuwe open.
    const dichtVoor = (hostLog.match(/sessie [0-9]+ dicht/g) || []).length;
    await B.ev(`document.getElementById("btn-run").click()`);
    check("B opnieuw uitgevoerd: weer verbonden, versie 7", await B.waitFor(`/versie 7/.test(${BEELD}) && /bijgewerkt/.test(${BEELD})`, 30000), await B.beeld());
    await sleep(300);
    check("opnieuw uitvoeren sloot de oude verbinding", (hostLog.match(/sessie [0-9]+ dicht/g) || []).length === dichtVoor + 1, hostLog);
    check("één widget per tabblad", (await A.ev(`window.__nbWidgets.size`)) === 1 && (await B.ev(`window.__nbWidgets.size`)) === 1);

    // De server stopt: de cel meldt dat de verbinding weg is.
    host.kill("SIGKILL");
    check("server weg: A meldt het onder de cel", await A.waitFor(`/verbinding .* verbroken/.test(${W}.foot.textContent) && /de verbinding is weg/.test(${BEELD})`), (await A.ev(`${W}.foot.textContent`)) + " / " + (await A.beeld()));
    A.ws.close(); B.ws.close();
  } catch (e) {
    console.log("FOUT  " + e.stack);
    fail = 1;
  }
  cleanup();
  console.log(fail ? "FOUT in notebook_connected_browser_test" : "ok: notebook_connected_browser_test");
  process.exit(fail);
})();
