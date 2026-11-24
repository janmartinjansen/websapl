// sapl2wasm.html in een gewone browser (Firefox, Safari of Chrome), via de zelftest van de
// pagina (?alles=1): alle 13 benchmarks, per benchmark dezelfde uitvoer als de JMVM of de
// stackmelding; nooit een andere fout. De pagina stuurt haar uitkomst naar deze server.
// Firefox en Chrome kunnen headless (HEADLESS=1); Safari alleen met het scherm open (anders
// remt Safari het tabblad af), en het tabblad blijft daarna open.
//
//   node websapl/tools/sapl2wasm_browsers_test.js <firefox|safari|chrome>   (vanuit de repo-root)
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const welke = process.argv[2];
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
      let fail = 0, door = 0;
      for (const x of r.rijen) {
        const gelijk = /same output, res:/.test(x.verdict);
        const stack = x.melding && /Too deep for the browser/.test(x.melding);
        if (gelijk) door++;
        if (!gelijk && !stack) fail = 1;
        console.log(`${gelijk || stack ? "ok  " : "FOUT"}  ${x.naam.padEnd(10)} ${(gelijk ? x.verdict : x.melding || x.verdict || "(niets)").replace(/\n/g, " | ")}`);
      }
      console.log(`${door} van ${r.rijen.length} via wasm (zelfde uitvoer als de JMVM), de rest met de stackmelding`);
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
  const url = `http://127.0.0.1:${srv.address().port}/sapl2wasm.html?alles=1&rapport=/rapport`;
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
