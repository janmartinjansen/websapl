// Het rekenproces (fase 3, stap 2 van docs/2026-10-28_fase3_code_verhuizen_plan.md)
// in de browser: notebooks/rekenen_op_server.spp in headless Chrome, tegen
// server/rekenen/host.js --code. De cel stuurt R.bron (de pagina vult de
// definitiecellen in), klikken laat fib 27 op het rekenproces uitrekenen.
// Dan een gewijzigde definitie die niet opnieuw is uitgevoerd: het
// rekenproces krijgt (na opnieuw verbinden) de nieuwe tekst, de cel pakt nog
// de oude code in, en de hash geeft een fout in plaats van een verkeerde
// uitkomst.
//
// Met --workbench: de pagina in de Workbench (`?engine=server`, de engine is
// een eigen ./rs-driver-proces); anders WebSapl (de wasm-worker).
//
//   node websapl/tools/notebook_rekenen_browser_test.js [--workbench]   (vanuit de repo-root)
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repo = path.resolve(__dirname, "..", "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HTTP_PORT = 8767, CDP_PORT = 9335;
const HOST_PORT = 23000 + Math.floor(Math.random() * 1000);
const WB = process.argv.includes("--workbench");
const NB_REL = "notebooks/_rekenen_test.spp";
const NB_FILES = WB ? [path.join(repo, NB_REL), path.join(repo, "websapl", NB_REL)] : [path.join(repo, "websapl", NB_REL)];
const PAGE = WB ? `http://localhost:${HTTP_PORT}/websapl/notebook.html?engine=server&` : `http://localhost:${HTTP_PORT}/notebook.html?`;
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
  const host = spawn("node", ["server/rekenen/host.js", "--code", "--port", String(HOST_PORT)], { cwd: repo, stdio: ["ignore", "ignore", "pipe"] });
  let hostLog = "";
  host.stderr.on("data", (d) => { hostLog += d; });
  const server = WB ? spawn("node", ["workbench/server.js", String(HTTP_PORT)], { cwd: repo, stdio: "ignore" })
    : spawn("python3", ["-m", "http.server", String(HTTP_PORT)], { cwd: path.join(repo, "websapl"), stdio: "ignore" });
  // Erbij voor de toets: toets "t" laat een tekst met een newline, een tab,
  // een backslash en een é uitrekenen (de uitkomst wordt twee keer
  // geëscapet: door het rekenproces en door de pagina voor :nbmsg).
  const nbTekst = fs.readFileSync(path.join(repo, "notebooks", "rekenen_op_server.spp"), "utf8")
    .replace("ws://localhost:8091/", `ws://localhost:${HOST_PORT}/`)
    .replace('import "lib/text.spp" as T', 'import "lib/text.spp" as T\nimport "lib/verbinding.spp" as V\n\nlastig n = strappend (V.vanTekens (Cons \'r\' (Cons 10 (Cons \'s\' (Cons 9 (Cons 92 (Cons \'t\' Nil))))))) (strappend " é " (T.showInt n))')
    .replace("  (_ -> D.Reply m [])\n\nontvang", '  (D.Key k -> D.Reply "bezig" [R.reken "tekst" (lastig 7)])\n  (_ -> D.Reply m [])\n\nontvang')
    .replace("  (R.Uitkomst id t -> ", '  (R.Uitkomst id t -> if (id == "tekst") (strappend "tekst:" (unpack t)) (')
    .replace('(T.showInt (unpack t)))', '(T.showInt (unpack t))))');
  for (const f of NB_FILES) fs.writeFileSync(f, nbTekst);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nbreken-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const cleanup = () => { chrome.kill(); server.kill(); host.kill(); for (const f of NB_FILES) { try { fs.unlinkSync(f); } catch (_) {} } };
  try {
    let targets = [];
    for (let i = 0; i < 50 && !targets.length; i++) { try { targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter((t) => t.type === "page"); } catch (_) {} await sleep(200); }
    const A = await pagina(targets[0].webSocketDebuggerUrl);
    for (let i = 0; i < 50; i++) { try { await fetch(PAGE); break; } catch (_) { await sleep(200); } }
    await A.send("Page.navigate", { url: PAGE }); await sleep(300);
    await A.ev("localStorage.clear()");
    await A.send("Page.navigate", { url: `${PAGE}nb=${NB_REL}&run=1` });
    check("verbonden, de bron is gecompileerd", await A.waitFor(`/klaar: klik/.test(${BEELD})`, 120000), await A.beeld());

    const klik = `(() => { const r = ${W}.root; r.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 5 })); })()`;
    await A.ev(klik);
    check("klik: fib 27 = 196418, uitgerekend op het rekenproces", await A.waitFor(`/fib 27 = 196418/.test(${BEELD})`, 30000), await A.beeld());
    console.log(`      rondgang: ${await A.ev(`${W}.foot.textContent`)}`);
    await A.ev(`(() => { const r = ${W}.root; r.focus(); r.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true })); })()`);
    check("een tekst met newline, tab, backslash en é komt heel terug", await A.waitFor(`${W}.root.textContent.includes("tekst:r\\ns\\t\\\\t é 7")`, 30000), JSON.stringify(await A.ev(`${W}.root.textContent`)));

    // Het rekenproces krijgt een andere fib dan de cel heeft (zoals na een
    // gewijzigde cel die bij de client niet opnieuw is uitgevoerd): de
    // uitgaande bron aanpassen en de verbinding verbreken; na het opnieuw
    // verbinden stuurt de cel R.bron opnieuw.
    const gewijzigd = await A.ev(`(() => {
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (d) {
        if (String(d).startsWith("bron ")) d = String(d).replace("fib (n - 2))", "fib (n - 2) + 1)");
        return send.call(this, d);
      };
      ${W}.sock.close();
      return true;
    })()`);
    check("een andere fib voor het rekenproces, verbinding verbroken", gewijzigd === true);
    check("opnieuw verbonden, de nieuwe bron is gecompileerd", await A.waitFor(`/klaar: klik/.test(${BEELD})`, 30000), await A.beeld());
    await A.ev(klik);
    check("klik: een fout over fib/taak, geen verkeerde uitkomst", await A.waitFor(`/fout: .*anders dan toen/.test(${BEELD})`, 30000) && !/fib 27 = /.test(await A.beeld()), await A.beeld());
    console.log(`      ${await A.beeld()}`);
    A.ws.close();
  } catch (e) {
    console.log("FOUT  " + e.stack);
    fail = 1;
  }
  cleanup();
  if (fail) console.log(hostLog);
  console.log(fail ? "FOUT in notebook_rekenen_browser_test" : "ok: notebook_rekenen_browser_test");
  process.exit(fail);
})();
