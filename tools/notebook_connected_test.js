// Verbonden cellen (D.connected, fase 1 van
// docs/2026-10-25_client_server_ontwerp.md) in de WebSapl-worker, tegen de
// echte gastheer en server: de meetlat zonder browser. Het notebook
// notebooks/incidenten_gedeeld.spp met de verbonden cel twee keer (twee
// "tabbladen" A en B). Deze toets speelt de rol van de pagina: per cel een
// WebSocket, een binnenkomende regel wordt `:nbmsg <tok> message\t...`, en de
// @@send-regels van het antwoord gaan naar de socket.
//
//   node websapl/tools/notebook_connected_test.js   (vanuit de repo-root)
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { call, init, repo } = require("./worker_harness.js");
const NB = require(path.join(__dirname, "..", "js", "notebook_core.js"));

let fail = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FOUT"}  ${label}`);
  if (!ok) { fail = 1; if (detail) console.log("      " + detail); }
}

const poort = 20000 + Math.floor(Math.random() * 1000);
const host = spawn("node", ["server/gastheer/host.js", "--port", String(poort), "server/fase1/server.jmvm"], { cwd: repo, stdio: ["ignore", "ignore", "pipe"] });
let hostLog = "";
host.stderr.on("data", (d) => { hostLog += d; });
const stop = (code) => { host.kill(); process.exit(code); };
const pauze = (ms) => new Promise((r) => setTimeout(r, ms));

// Eén gebeurtenis tegelijk naar de worker, zoals de pagina (busy/queue).
let rij = Promise.resolve();
function nbmsg(tok, ev) {
  const p = rij.then(() => call({ type: "NB_MSG", tok, event: ev }, "NB_MSG_RESULT"));
  rij = p.catch(() => {});
  return p;
}

const textOf = (p) => { const c = Object.values(p.cells)[0]; return c && c.blocks ? c.blocks.filter((b) => b.kind !== "interactive").map((b) => b.content).join("\n") : (c && c.error) || ""; };

// De rol van de pagina voor één verbonden cel.
function brug(naam, tok, url) {
  const b = { naam, tok, beeld: "", vast: false, vastgehouden: [], verstuurd: [], fouten: [] };
  const ws = new WebSocket(url);
  b.ws = ws;
  async function geef(ev) {
    const r = await nbmsg(tok, ev);
    if (!r.success) { b.fouten.push(r.error); return; }
    const p = NB.parseNbOutput(r.output);
    const res = Object.values(p.cells)[0];
    if (res && res.error) b.fouten.push(res.error);
    b.beeld = textOf(p);
    for (const s of p.sends) if (s.tok === tok) { b.verstuurd.push(s.line); ws.send(s.line); }
  }
  b.geef = geef;
  ws.onopen = () => geef(NB.eventLine("connected"));
  ws.onmessage = (e) => { const ev = NB.eventLine("message", String(e.data)); if (b.vast) b.vastgehouden.push(ev); else geef(ev); };
  b.losLaten = async () => { b.vast = false; for (const ev of b.vastgehouden.splice(0)) await geef(ev); };
  return b;
}

async function wacht(label, f, ms = 5000) {
  for (let t = 0; t < ms; t += 50) { if (f()) return true; await pauze(50); }
  return false;
}

(async () => {
  for (let i = 0; i < 100 && !/luistert/.test(hostLog); i++) await pauze(50);
  await init();
  const tekst = fs.readFileSync(path.join(repo, "notebooks", "incidenten_gedeeld.spp"), "utf8").replace("ws://localhost:8090/", `ws://localhost:${poort}/`);
  const cells = NB.parseNotebook(tekst);
  const verbonden = cells.find((c) => c.kind === "code" && /D\.connected/.test(c.source));
  cells.push({ kind: "code", source: verbonden.source });
  const g = NB.generateNbInput(cells, undefined, "any");
  const r = await call({ type: "NB_RUN", input: g.input }, "NB_RESULT");
  if (!r.success) { console.log("FOUT: NB_RUN: " + r.error); stop(1); }
  const p = NB.parseNbOutput(r.output);
  const infos = g.exprCells.map((e) => p.cells[e.n]).filter((c) => c && c.blocks && c.blocks[0] && c.blocks[0].kind === "interactive").map((c) => ({ info: NB.parseInteractive(c.blocks[0].content), beeld: c.blocks.slice(1).map((b) => b.content).join("\n") }));
  check("twee verbonden cellen, met de url", infos.length === 2 && infos.every((x) => x.info.url === `ws://localhost:${poort}/` && x.info.ms === 0), JSON.stringify(infos.map((x) => x.info)) + "\n" + r.output.slice(0, 2000));
  if (infos.length !== 2) stop(1);
  check("geen typewaarschuwingen in het notebook", !Object.keys(p.typeWarnings).length && !Object.values(p.types).flat().some((t) => t.error), JSON.stringify(p.typeWarnings) + JSON.stringify(p.types));
  check("beginbeeld: nog niet verbonden", /nog niet verbonden/.test(infos[0].beeld), infos[0].beeld);

  const A = brug("A", infos[0].info.tok, infos[0].info.url);
  const B = brug("B", infos[1].info.tok, infos[1].info.url);
  check("A en B lezen: versie 0", await wacht("v0", () => /versie 0/.test(A.beeld) && /versie 0/.test(B.beeld)), `A: ${A.beeld}\nB: ${B.beeld}\n${A.fouten} ${B.fouten}`);
  check("A stuurde `lees incidenten`", A.verstuurd[0] === "lees incidenten", JSON.stringify(A.verstuurd));

  await A.geef(NB.eventLine("click", "0", "0"));
  check("A klikt: schrijf op versie 0", /^schrijf incidenten 0 waarde @type \[Incident\.Incident\]\\n/.test(A.verstuurd[1] || ""), A.verstuurd[1]);
  check("A: opgeslagen, versie 1", await wacht("A1", () => /versie 1/.test(A.beeld) && /opgeslagen/.test(A.beeld)), A.beeld);
  check("B ziet Plek 1 op versie 1", await wacht("B1", () => /versie 1/.test(B.beeld) && /Plek 1/.test(B.beeld)), B.beeld);

  // Een conflict: B hoort even niets (de update van A wordt vastgehouden),
  // en schrijft dan op de oude versie 1.
  B.vast = true;
  await A.geef(NB.eventLine("click", "0", "0"));
  check("A: tweede incident, versie 2", await wacht("A2", () => /versie 2/.test(A.beeld) && /Plek 2/.test(A.beeld)), A.beeld);
  await B.geef(NB.eventLine("key", "d"));
  check("B sluit het eerste incident op versie 1", /^schrijf incidenten 1 /.test(B.verstuurd[B.verstuurd.length - 1]), B.verstuurd[B.verstuurd.length - 1]);
  await pauze(300);
  await B.losLaten();
  check("B: conflict, en de stand van de server (versie 2, Plek 2)", await wacht("Bc", () => /conflict/.test(B.beeld) && /versie 2/.test(B.beeld) && /Plek 2/.test(B.beeld)), B.beeld);
  check("A merkte niets van de mislukte schrijf van B", /versie 2/.test(A.beeld) && !/dicht/.test(A.beeld), A.beeld);

  await B.geef(NB.eventLine("key", "d"));
  check("B opnieuw: opgeslagen op versie 3", await wacht("B3", () => /versie 3/.test(B.beeld) && /opgeslagen/.test(B.beeld)), B.beeld);
  check("A ziet versie 3 met een gesloten incident", await wacht("A3", () => /versie 3/.test(A.beeld) && /dicht/.test(A.beeld)), A.beeld);
  check("geen fouten in update/view", !A.fouten.length && !B.fouten.length, `${A.fouten} / ${B.fouten}`);

  // Twee snelle wijzigingen in één tabblad (de tweede vóór het ok van de
  // eerste): niets mag verloren gaan, en geen conflict met zichzelf.
  const voor = (A.beeld.match(/Plek/g) || []).length;
  A.geef(NB.eventLine("click", "0", "0"));
  A.geef(NB.eventLine("click", "0", "0"));
  check("dubbelklik in A: versie 5, twee incidenten erbij, geen conflict", await wacht("dubbel", () => /versie 5/.test(A.beeld) && /opgeslagen/.test(A.beeld)) && (A.beeld.match(/Plek/g) || []).length === voor + 2 && !/conflict/.test(A.beeld), A.beeld);
  check("B ziet ze allebei", await wacht("dubbelB", () => /versie 5/.test(B.beeld) && (B.beeld.match(/Plek/g) || []).length === voor + 2), B.beeld);

  // Grote berichten door de notebookroute: een derde client (geen notebook)
  // schrijft 300 incidenten (~26 KB); A en B krijgen dat als `message`. Dan
  // stuurt B er via @@send zelf een van ~26 KB.
  const groot = fs.readFileSync(path.join(repo, "server", "fase1", "log.txt"), "utf8").split("\n").find((l) => l.startsWith("msg 9 ")).replace(/^msg 9 /, "").replace("incidenten 0", "incidenten " + /versie ([0-9]+)/.exec(A.beeld)[1]);
  const vGroot = +/versie ([0-9]+)/.exec(A.beeld)[1] + 1;
  const C = new WebSocket(infos[0].info.url);
  await new Promise((r) => (C.onopen = r));
  const t0 = Date.now();
  C.send(groot);
  check(`groot bericht (${groot.length} bytes) komt aan in A en B: 300 rijen`, await wacht("groot", () => A.beeld.includes(`versie ${vGroot}`) && /\n300\tPlaats/.test(A.beeld) && B.beeld.includes(`versie ${vGroot}`) && /\n300\tPlaats/.test(B.beeld), 20000), A.beeld.slice(0, 200) + " ... " + A.fouten);
  console.log(`      300 incidenten bij A en B: ${Date.now() - t0} ms`);
  const t1 = Date.now();
  await B.geef(NB.eventLine("click", "0", "0"));
  const bGroot = B.verstuurd[B.verstuurd.length - 1] || "";
  check(`B stuurt zelf een groot bericht (${bGroot.length} bytes): opgeslagen, A ziet Plek 301`, bGroot.length > 20000 && await wacht("groot2", () => B.beeld.includes(`versie ${vGroot + 1}`) && /opgeslagen/.test(B.beeld) && A.beeld.includes(`versie ${vGroot + 1}`) && /Plek 301/.test(A.beeld), 20000), B.beeld.slice(0, 200));
  console.log(`      301 incidenten van B naar A: ${Date.now() - t1} ms`);
  C.close();

  B.ws.close();
  await wacht("dicht", () => /sessie [0-9]+ dicht/.test(hostLog));
  check("B dicht: de gastheer meldt het", /sessie [0-9]+ dicht/.test(hostLog), hostLog);

  console.log(fail ? "FOUT in notebook_connected_test" : "ok: notebook_connected_test");
  A.ws.close();
  stop(fail);
})().catch((e) => { console.log("FOUT: " + (e.stack || e.message)); stop(1); });
