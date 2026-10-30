// Regressietest voor js/notebook_core.js (de logica van notebook.html):
// celindeling, bestandsformaat heen en terug, en het uitlezen van de
// @@begin/@@end-uitvoer van lib/notebook_glue.cfp. Zonder browser of VM.
// Gebruik: node websapl/tools/test_notebook_core.js   (exitcode 0 = goed)
const path = require("path");
const nb = require(path.join(__dirname, "..", "js", "notebook_core.js"));

let failures = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FOUT ${label}\n  verwacht ${w}\n  kreeg    ${g}`); }
}

// 1. Celindeling: definitie of expressie (en de fouten).
const cases = [
  ["let a = 1 in a", "expr"], ["x == 3", "expr"], ["f n\n  | n < 0 = 0\n  | otherwise = n", "def"],
  ["[x | x <- xs]", "expr"], ["\\x -> x + 1", "expr"], ["::Kleur = Rood | Groen", "def"],
  ["import \"lib/list.spp\" as L", "def"], ["#import \"lib/stdlib.cfp\"", "def"], ["(<+>) a b = a + b", "def"],
  ["a >= b", "expr"], ["a <= b", "expr"], ["a != b", "expr"], ["f x = x\ng y = y", "def"],
  ["1 + 2\n3 + 4", "expr!"], ["start = 1", "def!"], ["// alleen commentaar", "empty"],
  ["L.sum (L.map (\\x -> let y = x in y) [1])", "expr"], ["tekst = \"a = b\"", "def"],
  ["\"a = b\"", "expr"], ["foo\n  (bar 1)\n  2", "expr"], ["  1 + 1", "expr!"],
  ["big =: som 0 10", "def"], ["k =: [x | x <- xs]", "def"],
];
for (const [src, want] of cases) {
  const r = nb.classifyCell(src);
  check(`classify ${JSON.stringify(src)}`, r.kind + (r.error ? "!" : ""), want);
}

// 2. Bestandsformaat.
const text = "// voorwoord\n//%% [markdown]\n// # Titel\n//\n// tekst\n//%%\nimport \"lib/list.spp\" as L\n//%%\nL.sum [1, 2]\n";
const cells = nb.parseNotebook(text);
check("parse", cells, [
  { kind: "code", source: "// voorwoord" },
  { kind: "markdown", source: "# Titel\n\ntekst" },
  { kind: "code", source: "import \"lib/list.spp\" as L" },
  { kind: "code", source: "L.sum [1, 2]" },
]);
check("heen en terug", nb.parseNotebook(nb.serializeNotebook(cells)), cells);

// 3. De invoer voor de notebookmodus (`:nb`).
const gen = nb.generateNbInput(nb.parseNotebook("//%%\nf x = x\n//%%\nf 1\n//%%\nstart = 2\n//%%\n2 + 2\n"));
check("exprCells", gen.exprCells, [{ cell: 1, n: 1 }, { cell: 3, n: 2 }]);
check("celfouten", Object.keys(gen.errors), ["2"]);
check("nb-invoer", gen.input, "@@mode any\n@@defsall\n@@def 0\nf x = x\n@@expr 1 1\nf 1\n@@expr 3 2\n2 + 2\n");
{
  // Het definitiepaneel (11 oktober 2026): @@defsall alleen zolang een
  // definitiecel nog geen paneel heeft; @@defsame <cel> = houd het vorige.
  const cs = nb.parseNotebook("//%%\nf x = x\n//%%\nf 1\n");
  cs[0].output = { def: true, defs: [{ name: "f", type: "a -> a" }] };
  check("geen @@defsall met een paneel", nb.generateNbInput(cs).input.split("\n").includes("@@defsall"), false);
  check("@@defsame", nb.parseNbOutput("@@defsame 0\n@@def 2 g :: Num\n@@nbdone\n").defsSame, [0]);
}
check("nb-invoer van boven naar beneden", nb.generateNbInput(nb.parseNotebook("//%%\n1\n"), undefined, "top").input, "@@mode top\n@@expr 0 1\n1\n");
{
  const p = nb.parseNbOutput("@@deferror 0 onbekende naam x\n@@deferror -1 kapot\n@@begin 1\n@@value\n2\n@@end 1\n@@nbdone\n");
  check("nb-uitvoer", [p.defErrors[0], p.cells[1].blocks[0].content, p.done, p.error], ["onbekende naam x", "2", true, "uitvoerlaag: kapot"]);
}
check("typewaarschuwingen", nb.parseNbOutput("@@typewarn 2 f: kan niet unificeren: Num met Str\n@@nbdone\n").typeWarnings, { 2: ["f: kan niet unificeren: Num met Str"] });
check("instellingen", [nb.parseSettings("//%% [instellingen] volgorde=boven-naar-beneden\n//%%\n1\n").order, nb.parseSettings("//%%\n1\n").order], ["top", "any"]);

// Waarden bewaren (fase F, docs/2026-10-23_waarden_bewaren_plan.md).
check("instelling waarden=uit", [nb.parseSettings("//%% [instellingen] volgorde=boven-naar-beneden waarden=uit\n").values, nb.parseSettings("//%%\n1\n").values], [false, true]);
check("waarden=uit in het bestand", nb.serializeNotebook([{ kind: "code", source: "1" }], { order: "top", values: false }).split("\n")[0], "//%% [instellingen] volgorde=boven-naar-beneden waarden=uit");
check("@@values in de invoer", nb.generateNbInput([{ kind: "code", source: "x =: 1" }], null, "any", "/nbwaarden/a").input.split("\n").slice(0, 2), ["@@mode any", "@@values /nbwaarden/a"]);
{
  const p = nb.parseNbOutput("@@restored x\n@@restorestale y\n@@restorefailed z onbekende functie f\n@@saved x 12-34 /nbwaarden/a/x.12-34.val\n@@nbdone\n");
  check("@@saved, @@restored en fouten", [p.saved, p.restored, p.valueErrors, p.loose || ""], [[{ name: "x", hash: "12-34", path: "/nbwaarden/a/x.12-34.val" }], ["x"], [{ name: "z", error: "onbekende functie f" }], ""]);
}

// 4. Uitvoer uitlezen (zoals de VM die schrijft; cel 3 stopt met `error`).
const raw = [
  "VM starting for x", "execution started, progsize=10",
  "@@begin 1", "@@value", "55", "@@end 1",
  "@@begin 2", "@@table", "n\tn^2", "1\t1", "@@end 2",
  "@@begin 3", "List.head: lege lijststop", "Elapsed time: 0.00 secs",
].join("\n");
const out = nb.parseOutput(raw);
check("cel 1", out.cells[1], { blocks: [{ kind: "value", content: "55" }], ended: true });
check("cel 2", out.cells[2].blocks[0], { kind: "table", content: "n\tn^2\n1\t1" });
check("cel 3", [out.cells[3].ended, out.cells[3].error], [false, "List.head: lege lijst"]);
check("los", out.loose, "");

// 5. Namen in definitiecellen; CAF-cel (`naam =: expr`,
// docs/2026-10-03_expliciete_cafs_plan.md): een definitie, en `=:` blijft in
// de invoer staan.
check("definedNames", nb.definedNames("f x = x + \"a\"\n(<+>) a b = a"), ["f", "<+>"]);
check("definedNames CAF", nb.definedNames("big =: 1\nf x = x"), ["big", "f"]);
check("cafHintNames", nb.cafHintNames("big = som 0 10\nn = 5\ns = \"x\"\nc =: dure 1\nf x = x\nstart = big\nt = (1, 2)\n  vervolg = 3\n::K = A\nq == 1"), ["big", "t"]);
check("CAF in de invoer", nb.generateNbInput(nb.parseNotebook("//%%\nbig =: 5\n//%%\nbig + big\n")).input.split("\n").includes("big =: 5"), true);

// 6. Celsoorten en inklappen in het bestand (lc/type als commentaar).
const kinds = nb.parseNotebook("//%% [lc]\n// I = \\x.x\n//%% [type]\n// 1 + 1\n//%%\n2\n");
check("lc/type parse", kinds.map((c) => [c.kind, c.source]), [["lc", "I = \\x.x"], ["type", "1 + 1"], ["code", "2"]]);
check("lc/type heen en terug", nb.parseNotebook(nb.serializeNotebook(kinds)), kinds);
const folded = nb.parseNotebook("//%% [ingeklapt]\nf x = x\ng y = y\n//%% [lc, ingeklapt]\n// I = \\x.x\n//%%\nf 1\n");
check("ingeklapte cellen parse", folded, [
  { kind: "code", source: "f x = x\ng y = y", folded: true },
  { kind: "lc", source: "I = \\x.x", folded: true },
  { kind: "code", source: "f 1" },
]);
check("ingeklapte cellen heen en terug", nb.parseNotebook(nb.serializeNotebook(folded)), folded);
check("code=verborgen in de instellingen", [nb.parseSettings("//%% [instellingen] code=verborgen\n").hideCode, nb.serializeNotebook([{ kind: "code", source: "1" }], { order: "any", values: true, hideCode: true }).split("\n")[0]], [true, "//%% [instellingen] code=verborgen"]);
check("cellSummary", [nb.cellSummary(folded[0]), nb.cellSummary(folded[2])], ["f, g (2 regels)", "f 1"]);

// 7. Afhankelijkheden.
const dep = nb.parseNotebook([
  "//%%", "import \"lib/list.spp\" as L",
  "//%%", "kwadraat x = x * x",
  "//%%", "::Vorm = Rond !r | Vierkant !z", "", "render_Rond v = D.text \"rond\"",
  "//%%", "L.map kwadraat [1, 2]",
  "//%%", "Rond 3",
  "//%% [type]", "// kwadraat",
  "//%%", "42",
  "//%%", "#import \"lib/stdlib.cfp\"",
].join("\n"));
check("dependents import", [...nb.dependents(dep, 0)].sort(), [0, 3]);
check("dependents functie", [...nb.dependents(dep, 1)].sort(), [1, 3, 5]);
check("dependents haak", [...nb.dependents(dep, 2)].sort(), [2, 4]);
check("dependents expressie", [...nb.dependents(dep, 6)], [6]);
check("dependents #import", nb.dependents(dep, 7).size, 8);
check("deelprogramma", nb.generateNbInput(dep, new Set([4])).exprCells, [{ cell: 4, n: 1 }]);

// 8. type-cellen (in de notebookmodus).
check("type-cel in de invoer", nb.generateNbInput(dep).input.includes("@@type 5\nkwadraat"), true);
check("type-cel niet gekozen", nb.generateNbInput(dep, new Set([4])).input.includes("@@type"), false);
check("typen uit de uitvoer", nb.parseNbOutput("@@typeok 5 kwadraat :: (Num -> Num)\n@@typeerr 5 x y @@ onbekende functie: x\n@@nbdone\n").types,
  { 5: [{ expr: "kwadraat", type: "(Num -> Num)" }, { expr: "x y", error: "onbekende functie: x" }] });

// 9. lc-cellen (uitvoer zoals lc_repl die schrijft).
const lcCells = [{ kind: "lc", source: "I = \\x.x\n:nf I 1" }, { kind: "lc", source: ":nf bad\n:nf 2" }];
const li = nb.lcInput(lcCells);
check("lc stdin", li.stdin, "I = \\x.x\n:nf I 1\n:nf bad\n:nf 2\nquit\n");
check("lc uitvoer", nb.parseLcOutput("execution started, progsize=1\nbanner\nlc> gedefinieerd: I\nlc> 1\nlc> onbekende variabele: badstop\n", li.lines), {
  0: [{ line: "I = \\x.x", output: "gedefinieerd: I" }, { line: ":nf I 1", output: "1" }],
  1: [{ line: ":nf bad", error: "onbekende variabele: bad" }, { line: ":nf 2", notRun: true }],
});

// 10. Formulieren (@@form, D.form/D.slider/D.choice; fase C van
// docs/2026-10-15_notebook_integraal_plan.md).
check("form record", nb.parseForm("record\tOpties\nfield\tnaam\tstr\ta\\tb \"c\"\nfield\tn\tint\t3\nfield\taan\tbool\tTrue"),
  { kind: "record", con: "Opties", fields: [{ name: "naam", type: "str", value: "a\tb \"c\"", opts: [] }, { name: "n", type: "int", value: "3", opts: [] }, { name: "aan", type: "bool", value: "True", opts: [] }] });
check("form slider", nb.parseForm("slider\tfloat\t0.25\t0\t1"), { kind: "slider", type: "float", value: "0.25", lo: "0", hi: "1" });
check("form choice", nb.parseForm("choice\tgroen\trood\tgroen"), { kind: "choice", type: "str", value: "groen", options: ["rood", "groen"] });
check("form value", nb.parseForm("value\tint\t12"), { kind: "value", type: "int", value: "12" });
check("binding form", nb.formBinding("D.form opties"), "opties");
check("binding slider", nb.formBinding("D.slider 0 100 n'"), "n'");
check("binding choice", nb.formBinding("D.choice [\"a\", \"b\"] kleur"), "kleur");
check("binding geen naam", nb.formBinding("D.form (Opties 1 2)"), null);
check("binding geen formulier", nb.formBinding("L.sum xs"), null);
const fcells = [{ kind: "code", source: "x = 5\nopties = Opties 3 10 True\nf a = a" }, { kind: "code", source: "D.form opties" }, { kind: "markdown", source: "opties = 1" }];
check("definitie gevonden", nb.findDefinition(fcells, "opties"), { cell: 0 });
check("definitie niet in een expressiecel of markdown", nb.findDefinition(fcells, "D"), null);
check("definitie met =:", nb.findDefinition([{ kind: "code", source: "n =: 4" }], "n"), { cell: 0 });
check("niet n == 4", nb.findDefinition([{ kind: "code", source: "m = 1\nn == 4" }], "n"), null);
check("literal int", [nb.saplLiteral("int", "42"), nb.saplLiteral("int", "-3"), nb.saplLiteral("int", "4.5")], ["42", "(0 - 3)", null]);
check("literal float", [nb.saplLiteral("float", "2"), nb.saplLiteral("float", "-0.5"), nb.saplLiteral("float", "1e-7"), nb.saplLiteral("float", "x")], ["2.0", "(0.0 - 0.5)", "0.0000001", null]);
check("literal str", nb.saplLiteral("str", 'a "b"\\c\n'), '"a \\"b\\"\\\\c\\n"');
check("literal bool", [nb.saplLiteral("bool", true), nb.saplLiteral("bool", false)], ["True", "False"]);
check("args", nb.splitArgs('Con a (b c) "d e" [1, 2] \'x\''), ["Con", "a", "(b c)", '"d e"', "[1, 2]", "'x'"]);
check("herschrijf veld", nb.rewriteDefinition("x = 5\nopties = Opties 3 10 True  // standaard\nf a = a", "opties", 1, "11"),
  { source: "x = 5\nopties = Opties 3 11 True\nf a = a" });
check("herschrijf tussen haakjes", nb.rewriteDefinition("o = (Opties \"a b\" (0 - 1) True)", "o", 2, "False"), { source: "o = Opties \"a b\" (0 - 1) False" });
check("herschrijf vervolgregel", nb.rewriteDefinition("o =: Opties 1\n  2 3\ng = 1", "o", 0, "7"), { source: "o =: Opties 7 2 3\ng = 1" });
check("herschrijf geheel", nb.rewriteDefinition("n = 5\nm = n", "n", null, "6"), { source: "n = 6\nm = n" });
check("herschrijf geen constructor", nb.rewriteDefinition("o = maak 1 2", "o", 0, "3").error !== undefined, true);
check("herschrijf ontbreekt", nb.rewriteDefinition("p = 1", "o", null, "3").error !== undefined, true);
check("@@form in de uitvoer", nb.parseOutput("@@begin 1\n@@form\nvalue\tint\t12\n@@end 1\n").cells[1].blocks, [{ kind: "form", content: "value\tint\t12" }]);

check("record: constructor, getters en setters", [...nb.providedNames("::Opties = { !aantal : Int, aan : Bool }\nopties = Opties 3 True").names].sort(),
  ["Opties", "aan", "aantal", "opties", "setAan", "setAantal"]);
check("record: een cel met alleen een getter hangt ervan af", [...nb.dependents([{ kind: "code", source: "::P = { !px : Int }" }, { kind: "code", source: "px" }], 0)], [0, 1]);

check("geen =:-tip bij een constructor met letterlijke waarden", nb.cafHintNames("golf = Golf 1.0 3 True\no = Opties \"a b\" (0 - 1) 'c'\np = Punt (f 1) 2"), ["p"]);

// Presentatiemodus: een dia begint bij een tekstcel met een kop # of ##.
{
  const md = (t) => ({ kind: "markdown", source: t });
  const code = (t) => ({ kind: "code", source: t });
  check("dia's: kop # en ## beginnen een dia, ### niet, code niet",
    nb.slideStarts([code("x = 1"), md("# Titel"), code("x"), md("\n## Twee\ntekst"), md("### sub"), code("# geen kop"), md("gewone tekst"), md("## Drie")]),
    [0, 1, 3, 7]);
  check("dia's: een kop als eerste cel geeft geen lege dia", nb.slideStarts([md("# A"), md("## B")]), [0, 1]);
  check("dia's: leeg notebook", nb.slideStarts([]), [0]);
}

console.log(failures ? `${failures} fout(en)` : "notebook_core: alles goed");
process.exit(failures ? 1 : 0);
