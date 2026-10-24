// Waarden bewaren over sessies heen in de WebSapl-worker (fase F, stap 4 van
// docs/2026-10-23_waarden_bewaren_plan.md):
//  1. een run met `@@values` bewaart elke uitgerekende `=:`-waarde (NB_RESULT.saved);
//  2. een verse sessie (RSAPL_RESET) met die waarden zet ze terug vóór er iets
//     rekent: `:sprint` toont ze uitgerekend, zonder dat een expressiecel liep;
//  3. de expressiecellen geven daarna hetzelfde, en een teruggezette half
//     uitgerekende lijst rekent verder;
//  4. een gewijzigde cel: haar waarde wordt niet teruggezet (andere hash), die
//     van de andere cel wel; de nieuwe vervangt de oude;
//  5. zonder `@@values` (`waarden=uit`): niets bewaard;
//  6. een waarde die de native REPL (./rs-driver) bewaarde, komt in de worker
//     terug (dezelfde celhash op beide platforms);
//  7. het model van een interactieve cel (§11): na elke stap bewaard (NB_MSG_RESULT.saved),
//     in een verse sessie teruggezet; opnieuw uitvoeren in dezelfde sessie begint
//     bij model0 (ook na een verse sessie daarna); een gewijzigde definitie: model0;
//     na een trap terug; een closure uit de expressiecel zelf in een sessie met een
//     andere voorgeschiedenis: `@@restorefailed` en model0; zonder `@@values` niets.
//
//   node websapl/tools/notebook_values_test.js        (vanuit de repo-root)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { call, init, repo } = require("./worker_harness.js");
const NB = require(path.join(__dirname, "..", "js", "notebook_core.js"));

const DIR = "/nbwaarden/toets";
let fail = 0;

function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FOUT"}  ${label}`);
  if (!ok) { fail = 1; if (detail) console.log("      " + String(detail).slice(0, 600)); }
}

const cellsOf = (...srcs) => srcs.map((source) => ({ kind: "code", source }));

const DEFS = (n) => [
  "fib n = if (n < 2) n (fib (n - 1) + fib (n - 2))\n" +
  `tabel =: [fib k | k <- [1 .. ${n}]]\n` +
  "som xs = case xs (Nil -> 0) (Cons x r -> x + som r)",
  "priemen =: zeef [2 ..]\n" +
  "zeef xs = case xs (Cons p r -> Cons p (zeef [x | x <- r, x % p != 0]))\n" +
  "neem n xs = if (n == 0) Nil (case xs (Cons x r -> Cons x (neem (n - 1) r)))",
];

async function nb(cells, only, dir, values) {
  const g = NB.generateNbInput(cells, only, "any", dir);
  const msg = { type: "NB_RUN", input: g.input };
  if (values) msg.values = values;
  const r = await call(msg, "NB_RESULT");
  if (!r.success) throw new Error(r.error);
  const p = NB.parseNbOutput(r.output);
  if (!p.done) throw new Error("geen @@nbdone:\n" + r.output);
  const out = {};
  for (const e of g.exprCells) {
    const c = p.cells[e.n];
    out[e.cell] = c && c.blocks ? c.blocks.map((b) => b.content).join("|").trim() : JSON.stringify(c);
  }
  return { r, p, out };
}

const sprint = async (name) => (await call({ type: "RSAPL_EVAL", line: ":sprint " + name })).output.trim();
const text = (bytes) => Buffer.from(bytes).toString("utf8");

(async () => {
  await init();

  // == 1. Bewaren ===========================================================
  await call({ type: "RSAPL_RESET" });
  const cells = cellsOf(...DEFS(22), "som tabel", "neem 8 priemen");
  const a = await nb(cells, undefined, DIR);
  check("run 1: uitvoer", a.out[2] === "46367" && a.out[3] === "[2, 3, 5, 7, 11, 13, 17, 19]", JSON.stringify(a.out));
  const names = a.r.saved.map((s) => s.name).sort();
  check("run 1: tabel en priemen bewaard", JSON.stringify(names) === '["priemen","tabel"]', JSON.stringify(a.r.saved.map((s) => s.path)));
  check("run 1: bestand met kopregel", a.r.saved.every((s) => text(s.bytes).startsWith(`jmvm-waarde ${s.name} ${s.hash}\n`)), a.r.saved.map((s) => text(s.bytes).slice(0, 60)).join(" / "));
  const values = a.r.saved.map((s) => ({ path: s.path, bytes: s.bytes }));

  // == 2. Verse sessie, alleen de definitiecellen ===========================
  await call({ type: "RSAPL_RESET" });
  const b = await nb(cellsOf(...DEFS(22)), new Set(), DIR, values);
  check("sessie 2: beide teruggezet", JSON.stringify(b.p.restored.sort()) === '["priemen","tabel"]', b.r.output);
  const st = await sprint("tabel");
  check("sessie 2: tabel is al uitgerekend (:sprint)", st.startsWith("[1, 1, 2, 3, 5"), st);
  const sp = await sprint("priemen");
  check("sessie 2: priemen half uitgerekend (:sprint)", sp.startsWith("[2, 3, 5, 7, 11, 13, 17, 19 | ⟨zeef"), sp);
  check("sessie 2: niets opnieuw bewaard", b.r.saved.length === 0, JSON.stringify(b.r.saved.map((s) => s.name)));

  // == 3. Daarna rekenen ====================================================
  const c = await nb(cellsOf(...DEFS(22), "som tabel", "neem 12 priemen"), undefined, DIR);
  check("sessie 2: dezelfde som", c.out[2] === "46367", c.out[2]);
  check("sessie 2: priemen rekent verder", c.out[3] === "[2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]", c.out[3]);
  check("sessie 2: de langere priemen opnieuw bewaard", c.r.saved.map((s) => s.name).join() === "priemen", JSON.stringify(c.r.saved.map((s) => s.name)));

  // == 4. Een gewijzigde cel ================================================
  await call({ type: "RSAPL_RESET" });
  const d = await nb(cellsOf(...DEFS(21), "som tabel", "neem 3 priemen"), undefined, DIR);
  check("gewijzigd: alleen priemen teruggezet", JSON.stringify(d.p.restored) === '["priemen"]', d.r.output);
  check("gewijzigd: nieuwe som", d.out[2] === "28656", d.out[2]);
  const nt = d.r.saved.find((s) => s.name === "tabel");
  check("gewijzigd: nieuwe tabel bewaard, de oude weg", !!nt && nt.removed.length === 1 && nt.path !== a.r.saved.find((s) => s.name === "tabel").path, JSON.stringify(d.r.saved.map((s) => [s.name, s.removed])));

  // == 5. Zonder @@values ===================================================
  await call({ type: "RSAPL_RESET" });
  const e = await nb(cells, undefined, null);
  check("waarden uit: niets bewaard of teruggezet", e.r.saved.length === 0 && e.p.restored.length === 0 && e.out[2] === "46367", e.r.output);

  // == 6. Native bewaard, in de worker terug ================================
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nbwaarden-"));
  fs.mkdirSync(path.join(tmp, "w"));
  const g = NB.generateNbInput(cells, undefined, "any", path.join(tmp, "w"));
  fs.writeFileSync(path.join(tmp, "in.txt"), g.input);
  const nat = execFileSync(path.join(repo, "rs-driver"), [path.join(repo, "repl_sapl/build/mini_repl.jmvm")], { cwd: repo, input: `:nb ${path.join(tmp, "in.txt")}\n`, encoding: "utf8" });
  const files = fs.readdirSync(path.join(tmp, "w")).filter((f) => f.endsWith(".val"));
  check("native: twee waarden bewaard", files.length === 2, nat.split("\n").filter((l) => l.startsWith("@@saved")).join(" / "));
  check("native: dezelfde celhashes als in de worker", files.map((f) => f.replace(/\.val$/, "")).sort().join() === a.r.saved.map((s) => `${s.name}.${s.hash}`).sort().join(), files.join() + " tegen " + a.r.saved.map((s) => `${s.name}.${s.hash}`).join());
  await call({ type: "RSAPL_RESET" });
  const NDIR = "/nbwaarden/native";
  const f = await nb(cellsOf(...DEFS(22)), new Set(), NDIR, files.map((x) => ({ path: `${NDIR}/${x}`, bytes: new Uint8Array(fs.readFileSync(path.join(tmp, "w", x))) })));
  check("native -> worker: beide teruggezet", JSON.stringify(f.p.restored.sort()) === '["priemen","tabel"]', f.r.output);
  const ft = await sprint("tabel");
  check("native -> worker: tabel al uitgerekend", ft.startsWith("[1, 1, 2, 3, 5"), ft);
  fs.rmSync(tmp, { recursive: true, force: true });

  // == 7. Het model van een interactieve cel ================================
  const MDIR = "/nbwaarden/model";
  const MDEFS = (woord) => 'import "lib/text.spp" as T\n\n' +
    'tel ev n = case ev (D.Click x y -> n + 1) (D.Key k -> if (strEqual k "t") (1 / 0 + n) n) (_ -> n)\n\n' +
    `toon n = D.text (strcat "${woord}: " (T.showInt n))\n\n` +
    'verhoog f x = f x + 1\n\nplus ev f = case ev (D.Click x y -> verhoog f) (_ -> f)\n\ntoonF f = D.text (strcat "f: " (T.showInt (f 0)))';
  const mcells = (woord) => cellsOf(MDEFS(woord), "D.interactive 0 tel toon");
  const store = new Map();
  const keep = (saved) => { for (const v of saved) { for (const q of v.removed || []) store.delete(q); store.set(v.path, v.bytes); } };
  const storeList = () => [...store].map(([p, bytes]) => ({ path: p, bytes }));
  const tokOf = (res) => res && res.blocks && res.blocks[0] && res.blocks[0].kind === "interactive" ? NB.parseInteractive(res.blocks[0].content) : null;
  const shown = (res) => res && res.blocks ? res.blocks.filter((b) => b.kind !== "interactive").map((b) => b.content).join("|").trim() : JSON.stringify(res);
  async function nbI(cells, dir, values) {
    const g = NB.generateNbInput(cells, undefined, "any", dir);
    const msg = { type: "NB_RUN", input: g.input };
    if (values) msg.values = values;
    const r = await call(msg, "NB_RESULT");
    if (!r.success) throw new Error(r.error);
    keep(r.saved || []);
    const p = NB.parseNbOutput(r.output);
    const c = p.cells[g.exprCells[g.exprCells.length - 1].n];
    return { r, p, tok: tokOf(c), shown: shown(c) };
  }
  async function klik(tok, ev = NB.eventLine("click", "0", "0")) {
    const r = await call({ type: "NB_MSG", tok, event: ev }, "NB_MSG_RESULT");
    if (!r.success) throw new Error(r.error);
    keep(r.saved || []);
    const p = NB.parseNbOutput(r.output);
    return { r, shown: shown(Object.values(p.cells)[0]) };
  }

  await call({ type: "RSAPL_RESET" });
  let m1 = await nbI(mcells("aantal"), MDIR);
  check("model: begint bij 0, model0 bewaard", m1.shown === "aantal: 0" && m1.r.saved.some((s) => s.name.startsWith("@m")), m1.r.output);
  let k = await klik(m1.tok.tok); k = await klik(m1.tok.tok); k = await klik(m1.tok.tok);
  check("model: na drie klikken 3, elke stap bewaard", k.shown === "aantal: 3" && k.r.saved.length === 1, JSON.stringify(k.r.saved.map((s) => s.name)));
  const mfile = [...store.keys()].filter((p) => p.includes("/@m"));
  check("model: één bestand, met de tekst van 3", mfile.length === 1 && text(store.get(mfile[0])).endsWith("i3"), mfile.map((p) => text(store.get(p))).join(" / "));
  k = await klik(m1.tok.tok, NB.eventLine("key", "x"));
  check("model: een stap zonder verandering schrijft niets", k.r.saved.length === 0, JSON.stringify(k.r.saved));

  await call({ type: "RSAPL_RESET" });
  m1 = await nbI(mcells("aantal"), MDIR, storeList());
  check("verse sessie: model teruggezet (3)", m1.shown === "aantal: 3" && m1.p.restored.some((n) => n.startsWith("@m")), m1.r.output);
  k = await klik(m1.tok.tok);
  check("verse sessie: daarna verder (4)", k.shown === "aantal: 4", k.r.output);

  m1 = await nbI(mcells("aantal"), MDIR);
  check("opnieuw uitvoeren in dezelfde sessie: model0", m1.shown === "aantal: 0" && m1.p.restored.length === 0, m1.r.output);
  await call({ type: "RSAPL_RESET" });
  m1 = await nbI(mcells("aantal"), MDIR, storeList());
  check("en een verse sessie daarna: ook model0", m1.shown === "aantal: 0", m1.r.output);
  k = await klik(m1.tok.tok); k = await klik(m1.tok.tok);

  await call({ type: "RSAPL_RESET" });
  const m2 = await nbI(mcells("teller"), MDIR, storeList());
  check("gewijzigde definitie: model0, niet teruggezet", m2.shown === "teller: 0" && m2.p.restored.length === 0, m2.r.output);
  check("gewijzigde definitie: het oude bestand vervangen", [...store.keys()].filter((p) => p.includes("/@m")).length === 1, [...store.keys()].join(" "));

  m1 = await nbI(mcells("aantal"), MDIR);
  k = await klik(m1.tok.tok); k = await klik(m1.tok.tok);
  k = await klik(m1.tok.tok, NB.eventLine("key", "t"));
  check("trap (1 / 0 in update)", k.r.trapped === true, JSON.stringify(k.r));
  m1 = await nbI(mcells("aantal"), MDIR);
  check("na de trap: de volgende run zet het model terug (2)", m1.r.restarted && m1.shown === "aantal: 2", m1.r.output);

  // Een closure uit de expressiecel zelf (`\x -> x`): haar naam hangt af van
  // het stuk. Met dezelfde voorgeschiedenis komt ze terug, met een andere niet.
  const fcells = cellsOf(MDEFS("aantal"), "D.interactive (\\x -> x) plus toonF");
  await call({ type: "RSAPL_RESET" });
  let f1 = await nbI(fcells, MDIR);
  k = await klik(f1.tok.tok); k = await klik(f1.tok.tok);
  check("closure in het model: f 0 = 2", k.shown === "f: 2", k.r.output);
  await call({ type: "RSAPL_RESET" });
  await nbI(cellsOf("1 + 1"), null);
  f1 = await nbI(fcells, MDIR, storeList());
  check("closure uit de cel, andere voorgeschiedenis: model0 met een melding", f1.shown === "f: 0" && f1.p.valueErrors.some((e) => e.name.startsWith("@m")), f1.r.output);

  await call({ type: "RSAPL_RESET" });
  m1 = await nbI(mcells("aantal"), null);
  k = await klik(m1.tok.tok);
  check("waarden uit: niets bewaard of teruggezet", m1.shown === "aantal: 0" && m1.r.saved.length === 0 && k.r.saved.length === 0, m1.r.output);

  console.log(fail ? "FOUT" : "alles in orde");
  process.exit(fail);
})().catch((err) => { console.error(err); process.exit(1); });
