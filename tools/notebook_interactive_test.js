// Interactieve cellen in de WebSapl-worker (fase E van
// docs/2026-10-15_notebook_integraal_plan.md, 23 oktober 2026):
// `D.interactive`/`D.animated` via NB_RUN, gebeurtenissen via NB_MSG
// (`:nbmsg sleutel gebeurtenis`). Toetst het model (klik, toets, tik), een
// fout in update (model blijft), een oude sleutel (@@stale), een nieuwe run
// (nieuwe sleutel, de oude vervalt), en meet de rondgang van een
// gebeurtenis op notebooks/interactief.spp.
//
//   node websapl/tools/notebook_interactive_test.js   (vanuit de repo-root)
const fs = require("fs");
const path = require("path");
const { call, init, repo } = require("./worker_harness.js");
const NB = require(path.join(__dirname, "..", "js", "notebook_core.js"));

let fail = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FOUT"}  ${label}`);
  if (!ok) { fail = 1; if (detail) console.log("      " + detail); }
}

async function run(cells) {
  const g = NB.generateNbInput(cells, undefined, "any");
  const r = await call({ type: "NB_RUN", input: g.input }, "NB_RESULT");
  if (!r.success) throw new Error(r.error);
  const p = NB.parseNbOutput(r.output);
  const byCell = {};
  for (const e of g.exprCells) byCell[e.cell] = p.cells[e.n];
  return { byCell, p, raw: r.output };
}

async function msg(tok, ev) {
  const r = await call({ type: "NB_MSG", tok, event: ev }, "NB_MSG_RESULT");
  if (!r.success) throw new Error(r.error);
  return { r, p: NB.parseNbOutput(r.output) };
}

const tokOf = (res) => res && res.blocks && res.blocks[0] && res.blocks[0].kind === "interactive" ? NB.parseInteractive(res.blocks[0].content) : null;
const textOf = (p) => { const c = Object.values(p.cells)[0]; return c && c.blocks ? c.blocks.filter((b) => b.kind !== "interactive").map((b) => b.content).join("\n") : (c && c.error) || ""; };
const cellsOf = (...srcs) => srcs.map((source) => ({ kind: "code", source }));

(async () => {
  await init();

  // == Een teller ================================================================
  const teller = cellsOf(
    'import "lib/text.spp" as T\n\ntel ev n = case ev (D.Click x y -> n + 1) (D.Key k -> if (strEqual k "r") 0 n) (D.Tick t -> n + 100) (_ -> n)\n\ntoon n = D.text (strcat "aantal: " (T.showInt n))\n\nbreek ev n = case ev (D.Key k -> if (strEqual k \"t\") (1 / 0 + n) (error \"kapot\")) (_ -> n + 1)',
    "D.interactive 0 tel toon",
    "D.interactive 5 breek toon",
    "1 + 2");
  const r1 = await run(teller);
  const i1 = tokOf(r1.byCell[1]);
  check("interactieve cel: @@interactive met sleutel en ms 0", i1 && i1.ms === 0, JSON.stringify(r1.byCell[1]));
  check("interactieve cel: begint met view model0", r1.byCell[1] && r1.byCell[1].blocks[1] && r1.byCell[1].blocks[1].content === "aantal: 0", JSON.stringify(r1.byCell[1]));
  check("gewone cel ernaast: 3", r1.byCell[3] && r1.byCell[3].blocks[0].content === "3");
  let m = await msg(i1.tok, NB.eventLine("click", "0.5", "-0.25"));
  check("klik: aantal 1", textOf(m.p) === "aantal: 1", m.r.output);
  m = await msg(i1.tok, NB.eventLine("click", "0", "0"));
  m = await msg(i1.tok, NB.eventLine("tick", "40"));
  check("klik en tik: aantal 102", textOf(m.p) === "aantal: 102", m.r.output);
  m = await msg(i1.tok, NB.eventLine("key", "r"));
  check("toets r: terug naar 0", textOf(m.p) === "aantal: 0", m.r.output);
  m = await msg(i1.tok, NB.eventLine("key", "\\"));
  check("toets \\ (escape): model blijft 0", textOf(m.p) === "aantal: 0", m.r.output);

  const i2 = tokOf(r1.byCell[2]);
  m = await msg(i2.tok, NB.eventLine("click", "0", "0"));
  check("tweede cel, eigen model: 6", textOf(m.p) === "aantal: 6", m.r.output);
  m = await msg(i2.tok, NB.eventLine("key", "x"));
  const c2 = Object.values(m.p.cells)[0];
  check("fout in update: melding bij de cel, geen @@end", c2 && !c2.ended && /kapot/.test(c2.error || ""), m.r.output);
  m = await msg(i2.tok, NB.eventLine("click", "0", "0"));
  check("na de fout: het model is gebleven (7)", textOf(m.p) === "aantal: 7", m.r.output);
  m = await msg(i1.tok, NB.eventLine("click", "0", "0"));
  check("de eerste cel merkt niets van de fout (1)", textOf(m.p) === "aantal: 1", m.r.output);

  m = await msg("999_1", NB.eventLine("click", "0", "0"));
  check("onbekende sleutel: @@stale", m.p.stale.includes("999_1"), m.r.output);

  // Alleen de tweede cel opnieuw: haar sleutel vervangt de oude; de eerste blijft.
  const g2 = NB.generateNbInput(teller, new Set([2]), "any");
  const rr = await call({ type: "NB_RUN", input: g2.input }, "NB_RESULT");
  const p2 = NB.parseNbOutput(rr.output);
  const i2b = tokOf(p2.cells[g2.exprCells[0].n]);
  check("opnieuw uitgevoerd: nieuwe sleutel, model terug op 5", i2b && i2b.tok !== i2.tok && textOf({ cells: { x: p2.cells[g2.exprCells[0].n] } }) === "aantal: 5", rr.output);
  m = await msg(i2.tok, NB.eventLine("click", "0", "0"));
  check("de oude sleutel is verlopen", m.p.stale.includes(i2.tok), m.r.output);
  m = await msg(i1.tok, NB.eventLine("click", "0", "0"));
  check("de cel die niet meedeed, houdt haar model (2)", textOf(m.p) === "aantal: 2", m.r.output);

  // == notebooks/interactief.spp: de zeef en de bal, met de rondgang ==========
  const cells = NB.parseNotebook(fs.readFileSync(path.join(repo, "notebooks/interactief.spp"), "utf8"));
  const r3 = await run(cells);
  const toks = Object.values(r3.byCell).map(tokOf).filter(Boolean);
  check("voorbeeldnotebook: drie interactieve cellen (ms 0, 40 en 40)", toks.length === 3 && toks[0].ms === 0 && toks[1].ms === 40 && toks[2].ms === 40, JSON.stringify(toks));
  check("voorbeeldnotebook: geen typewaarschuwingen", Object.keys(r3.p.typeWarnings).length === 0, JSON.stringify(r3.p.typeWarnings));
  let t = performance.now();
  const n1 = 18;
  for (let i = 0; i < n1; i++) m = await msg(toks[0].tok, NB.eventLine("click", "0", "0"));
  const zeefMs = (performance.now() - t) / n1;
  const groen = (textOf(m.p).match(/GraphDisc 10 /g) || []).length;
  const grijs = (textOf(m.p).match(/GraphDisc 8 /g) || []).length;
  check("zeef na 18 klikken: de 17 priemgetallen tot 60 groen, de 42 andere grijs", groen === 17 && grijs === 42, `groen: ${groen}, grijs: ${grijs}`);
  t = performance.now();
  const n2 = 200;
  for (let i = 0; i < n2; i++) m = await msg(toks[1].tok, NB.eventLine("tick", String(i * 40)));
  const balMs = (performance.now() - t) / n2;
  check("bal na 200 tikken: een plaatje", /GraphDisc 12 /.test(textOf(m.p)), textOf(m.p));
  console.log(`      rondgang in de worker: zeef ${zeefMs.toFixed(1)} ms per klik, bal ${balMs.toFixed(2)} ms per tik`);
  check("bal: een tik ruim binnen 50 ms (20 beelden per seconde)", balMs < 25, `${balMs.toFixed(2)} ms`);

  // == Een formulier in een interactieve cel: Input-gebeurtenissen ==========
  const fig = toks[2];
  check("voorbeeldnotebook: de derde interactieve cel (formulier en plaatje)", fig && fig.ms === 40, JSON.stringify(toks));
  const blocksOf = (p) => { const c = Object.values(p.cells)[0]; return c && c.blocks ? c.blocks : []; };
  const formOf = (p) => { const b = blocksOf(p).find((x) => x.kind === "form"); return b ? NB.parseForm(b.content) : null; };
  m = await msg(fig.tok, NB.eventLine("input", "kleur", "Rood"));
  let fm = formOf(m.p);
  check("input kleur Rood: het formulier toont Rood, het plaatje kleur 12", fm && fm.fields[2].value === "Rood" && /GraphPolyLine 12 /.test(blocksOf(m.p).map((b) => b.content).join("\n")), m.r.output.slice(0, 400));
  m = await msg(fig.tok, NB.eventLine("input", "lijn", "False"));
  check("input lijn False: stippen in plaats van een lijn", /GraphDisc 12 /.test(blocksOf(m.p).map((b) => b.content).join("\n")), m.r.output.slice(0, 300));
  m = await msg(fig.tok, NB.eventLine("input", "fx", "abc"));
  const ce = Object.values(m.p.cells)[0];
  check("input fx abc: een melding, het model blijft", ce && /geen geheel getal/.test(ce.error || ""), m.r.output.slice(0, 300));
  m = await msg(fig.tok, NB.eventLine("input", "fx", "5"));
  fm = formOf(m.p);
  check("input fx 5: daarna gewoon verder", fm && fm.fields[0].value === "5" && fm.fields[2].value === "Rood" && fm.fields[3].value === "False", m.r.output.slice(0, 300));

  // == Een trap (1 / 0 is in wasm geen vangbare fout): de sessie is weg ======
  const r4 = await run(teller);
  const i4 = tokOf(r4.byCell[2]);
  m = await msg(i4.tok, NB.eventLine("key", "t"));
  check("1 / 0 in update: trapped (de pagina stopt dan alle interactieve cellen)", m.r.trapped === true, JSON.stringify(m.r));
  m = await msg(i4.tok, NB.eventLine("click", "0", "0"));
  check("daarna: trapped (geen sessie)", m.r.trapped === true, JSON.stringify(m.r));

  process.exit(fail);
})().catch((e) => { console.error(e); process.exit(1); });
