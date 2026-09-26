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

// 3. Programma genereren.
const gen = nb.generateProgram(nb.parseNotebook("//%%\nf x = x\n//%%\nf 1\n//%%\nstart = 2\n//%%\n2 + 2\n"));
check("exprCells", gen.exprCells, [{ cell: 1, n: 1 }, { cell: 3, n: 2 }]);
check("celfouten", Object.keys(gen.errors), ["2"]);
check("start-regel", gen.source.trim().split("\n").pop(), "start = nbCell 1 __cell1 <#> nbCell 2 __cell2 <#> 0");

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

// 5. Typecheckfouten aan cellen koppelen.
const tcCells = nb.parseNotebook("//%%\nf x = x + \"a\"\n(<+>) a b = a\n//%%\nniet_bestaand 3\n//%%\n1 + 1\n");
const tcGen = nb.generateProgram(tcCells);
check("definedNames", nb.definedNames(tcCells[0].source), ["f", "<+>"]);
check("celfouten uit typecheck", nb.cellErrorsFromTypecheck([
  "f: FOUT: f: kan niet unificeren: Num met Str",
  "__cell1: FOUT: __cell1: onbekende functie: niet_bestaand",
  "showListItems: FOUT: showListItems: oneindig type",
  "__cell2 :: Num",
].join("\n"), tcCells, tcGen), { 0: ["f: kan niet unificeren: Num met Str"], 1: ["onbekende functie: niet_bestaand"] });

console.log(failures ? `${failures} fout(en)` : "notebook_core: alles goed");
process.exit(failures ? 1 : 0);
