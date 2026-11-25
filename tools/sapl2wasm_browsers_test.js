// sapl2wasm.html in een gewone browser (Firefox, Safari of Chrome), via de zelftest van de
// pagina (?alles=1): alle 13 benchmarks, per kolom (direct, eigen stack) dezelfde uitvoer als de
// JMVM of de stackmelding; nooit een andere fout. De pagina stuurt haar uitkomst naar deze server.
// Firefox en Chrome kunnen headless (HEADLESS=1); Safari alleen met het scherm open (anders
// remt Safari het tabblad af), en het tabblad blijft daarna open.
//
//   node websapl/tools/sapl2wasm_browsers_test.js <firefox|safari|chrome> [auto|tail|tramp]   (vanuit de repo-root)
// Het tweede argument kiest de vorm van de derde kolom (?eigen=; standaard auto: de trampoline
// in Safari, staartsprongen in de rest). Elke vorm moet 13 van 13 halen.
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const welke = process.argv[2];
const vorm = process.argv[3] || "auto";
if (!["firefox", "safari", "chrome"].includes(welke)) { console.error("gebruik: node sapl2wasm_browsers_test.js <firefox|safari|chrome>"); process.exit(2); }
const root = path.resolve(__dirname, "..");
const TYPE = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".cfp": "text/plain", ".jvb": "application/octet-stream", ".css": "text/css", ".spp": "text/plain" };
let browser = null, profiel = null;
const stop = (code) => { try { browser && browser.kill(); } catch (_) {} try { profiel && fs.rmSync(profiel, { recursive: true, force: true }); } catch (_) {} process.exit(code); };

const srv = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST" && url.pathname === "/rapport") {
    let body = ""; req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.end("ok");
      const r = JSON.parse(body);
      console.log(r.userAgent);
      const vormen = [...new Set(r.rijen.map((x) => x.eigen.vorm + (x.eigen.auto ? " (automatisch)" : "")))];
      console.log("eigen stack via: " + vormen.join(", "));
      let fail = 0, door = 0;
      let doorE = 0;
      const f = (x) => (x.ok ? `${x.ms} ms (${(r0.jmvm / Math.max(1, x.ms)).toFixed(1)}×)${x.same ? "" : " ANDERE UITVOER"}` : x.stack ? "stack" : `fout (${x.stage})`);
      let r0;
      for (const x of r.rijen) {
        r0 = x;
        const d = x.direct, e = x.eigen;
        if (d.ok && d.same) door++;
        if (e.ok && e.same) doorE++;
        // direct: dezelfde uitvoer of de stackmelding; eigen stack: altijd dezelfde uitvoer
        const ok = ((d.ok && d.same) || d.stack) && e.ok && e.same;
        if (!ok) fail = 1;
        console.log(`${ok ? "ok  " : "FOUT"}  ${x.naam.padEnd(10)} JMVM ${x.jmvm} ms · direct ${f(d)} · eigen stack ${f(e)}`);
      }
      console.log(`direct ${door} van ${r.rijen.length}, eigen stack ${doorE} van ${r.rijen.length} via wasm (zelfde uitvoer als de JMVM)`);
      stop(fail);
    });
    return;
  }
  const p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader("Content-Type", TYPE[path.extname(p)] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(p).pipe(res);
});
srv.listen(0, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${srv.address().port}/sapl2wasm.html?alles=1&rapport=/rapport&eigen=${vorm}`;
  console.error(`pagina: ${url}`);
  const headless = !!process.env.HEADLESS;
  if (welke === "firefox") {
    profiel = fs.mkdtempSync(path.join(os.tmpdir(), "sapl2wasm-ff-"));
    fs.writeFileSync(path.join(profiel, "user.js"), ['user_pref("browser.aboutwelcome.enabled", false);', 'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("browser.startup.homepage_override.mstone", "ignore");', 'user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);'].join("\n") + "\n");
    browser = spawn("/Applications/Firefox.app/Contents/MacOS/firefox", ["-no-remote", "-new-instance", ...(headless ? ["-headless"] : []), "-profile", profiel, url], { stdio: "ignore" });
  } else if (welke === "chrome") {
    profiel = fs.mkdtempSync(path.join(os.tmpdir(), "sapl2wasm-ch-"));
    browser = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [`--user-data-dir=${profiel}`, "--no-first-run", ...(headless ? ["--headless=new"] : ["--new-window"]), url], { stdio: "ignore" });
  } else {
    spawn("open", ["-a", "Safari", url], { stdio: "ignore" });
  }
});
setTimeout(() => { console.error("FOUT: geen uitkomst binnen 10 minuten"); stop(1); }, 600000);
