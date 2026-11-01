// Warme A/B-meting van twee VM-wasms in Safari (README.md hier), met dezelfde
// meet.html als meet_chrome.js, via WebDriver (safaridriver). Eenmalig nodig:
// Safari > Instellingen > Ontwikkelaar > "Sta automatisering op afstand toe".
// Safari opent een automatiseringsvenster op het scherm; de Mac moet wakker
// zijn (met een slapend scherm zet Safari de pagina stil).
//   node websapl/tools/wasm_ab_meting/meet_safari.js <werkmap> [-n rondes] [--var a,b] [--los] [benchmark...]
const { spawn } = require("child_process");
const fs = require("fs"), http = require("http"), path = require("path");
const PORT = 8768;
const { zorgVoorJvb } = require("./jvb.js");
const { BENCHMARKS } = require("./meet_kern.js");

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
if (!fs.existsSync(werkmap)) { console.error("gebruik: meet_safari.js <werkmap> [-n rondes] [--var a,b] [--los] [benchmark...]"); process.exit(2); }
for (const f of ["meet.html", "meet_kern.js"]) fs.copyFileSync(path.join(__dirname, f), path.join(werkmap, f));
fs.copyFileSync("websapl/engine/worker.js", path.join(werkmap, "worker.js"));
const bl = path.join(werkmap, "benchmarks");
try { fs.unlinkSync(bl); } catch (_) {}
fs.symlinkSync(path.resolve("benchmarks"), bl);
// Terugval zonder WebDriver: Safari opent meet_safari.html (open -a Safari),
// die meet.html in een frame draait en de uitkomst naar /resultaat post.
fs.writeFileSync(path.join(werkmap, "meet_safari.html"), `<!doctype html><meta charset="utf-8"><title>wasm A/B (Safari)</title>
<p>Meten... laat dit venster op de voorgrond.</p>
<iframe id="f" src="meet.html?${q}" style="width:100%;height:80vh"></iframe>
<script>
const f = document.getElementById("f");
const t = setInterval(() => {
  const w = f.contentWindow;
  if (w && w.__klaar) {
    clearInterval(t);
    const ua = (navigator.userAgent.match(/Version\\/[0-9.]+/) || ["?"])[0];
    fetch("/resultaat", { method: "POST", body: "Safari " + ua + "\\n" + w.__uit });
  }
}, 2000);
</script>`);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };
const srv = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/resultaat") {
    let b = ""; req.on("data", (d) => (b += d));
    req.on("end", () => { res.end("ok"); console.log(b); srv.close(); process.exit(/FOUT/.test(b) ? 1 : 0); });
    return;
  }
  const p = path.join(werkmap, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (e, d) => {
    if (e) { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", TYPES[path.extname(p)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(d);
  });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WD = 4446;
srv.listen(PORT, async () => {
  const drv = spawn("safaridriver", ["-p", String(WD)], { stdio: "ignore" });
  const stop = (code) => { drv.kill(); srv.close(); process.exit(code); };
  const wd = async (method, url, body) => (await (await fetch(`http://localhost:${WD}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json()).value;
  try {
    let sess;
    for (let i = 0; i < 50 && !sess; i++) { try { sess = await wd("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } }); } catch (_) { await sleep(200); } }
    if (!sess || !sess.sessionId) {
      console.error("safaridriver: " + (sess && sess.message) + "\nterugval: open -a Safari");
      drv.kill();
      spawn("open", ["-a", "Safari", `http://localhost:${PORT}/meet_safari.html`]);
      return;   // de pagina post de uitkomst naar /resultaat
    }
    const id = sess.sessionId, ev = (e) => wd("POST", `/session/${id}/execute/sync`, { script: `return ${e};`, args: [] });
    await wd("POST", `/session/${id}/url`, { url: `http://localhost:${PORT}/meet.html?${q}` });
    while ((await ev("window.__klaar === true")) !== true) await sleep(3000);
    const uit = await ev("window.__uit");
    const ua = await ev("(navigator.userAgent.match(/Version\\/[0-9.]+/) || ['?'])[0]");
    console.log(`Safari ${ua}${q.get("los") ? ", --los" : ""}\n${uit}`);
    await wd("DELETE", `/session/${id}`);
    stop(/^FOUT/.test(uit) ? 1 : 0);
  } catch (e) { console.log("FOUT " + e.stack); stop(1); }
});
