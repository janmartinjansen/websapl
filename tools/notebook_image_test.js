// Test van het blijvende beeld in de WebSapl-worker (notebookplan §6.2,
// 6 oktober 2026): NOTEBOOK_RUN draait op één wasm-exemplaar dat tussen
// runs blijft, zodat een dure CAF niet opnieuw berekend wordt; vanaf de
// tweede run worden alleen de eigen cellen gecompileerd (een los stuk tegen
// de bibliotheek in het beeld).
//
//   node websapl/tools/notebook_image_test.js     (vanuit de repo-root)
//
// Het programma is wat notebook_core.js zou maken: definities, en een start
// die elke expressiecel afdrukt. Getoetst wordt aan het aantal aanroepen per
// run (jmvm_image_calls) en aan de uitvoer.
const { call, init } = require("./worker_harness.js");

const prog = (extra, fDef) => `#import "repl/stddyn.cfp"
#import "lib/notebook_glue.cfp"
import "lib/display.spp" as D
import "grafisch/graphics.cfp" as G
tel !a !n = if (n == 0) a (tel (a + n) (n - 1))
big =: tel 0 2000000
${fDef}
g =: f 5
w x = printString "@@w" <#> printVal x <#> printString "@@"
start = w (big + g) <#> w (${extra})
`;

(async () => {
  await init();
  let fail = 0;
  const run = async (source, noImage = false) => {
    const r = await call({ type: "NOTEBOOK_RUN", source, noImage });
    if (!r.success) throw new Error(`${r.stage}: ${r.error}`);
    // De programmauitvoer staat tussen @@w-markeringen (de lader en `res:`
    // schrijven er ook wat omheen).
    const lines = [...r.output.matchAll(/@@w(-?\d+)@@/g)].map((m) => m[1]);
    return { lines, image: r.image };
  };
  const check = (name, ok, info) => {
    console.log(`${ok ? "ok  " : "FOUT"}  ${name}${info ? ": " + info : ""}`);
    if (!ok) fail = 1;
  };

  const f1 = "f x = x + 1", f2 = "f x = x * 10";
  const a = await run(prog("1", f1));
  check("eerste run rekent big uit", a.image && a.image.calls > 2000000, `aanroepen ${a.image && a.image.calls}`);
  // Eerst met beeld: de referentie zonder beeld zet het programma anders al
  // in de compileercache, en dan wordt er helemaal niet meer gecompileerd.
  const b = await run(prog("2", f1));
  const ref = await run(prog("2", f1), true);
  check("andere expressie: big bewaard", b.image && b.image.calls < 1000, `aanroepen ${b.image && b.image.calls}`);
  check("zelfde uitvoer als zonder beeld", JSON.stringify(b.lines) === JSON.stringify(ref.lines), b.lines.join(" "));
  check("tweede run als los stuk (alleen de eigen cellen gecompileerd)", b.image && b.image.chunk === true, `chunk ${b.image && b.image.chunk}`);
  const c = await run(prog("3", f2));
  const refC = await run(prog("3", f2), true);
  check("f opnieuw: code opnieuw, big bewaard", c.image && c.image.calls < 1000 && /code opnieuw/.test(c.image.event), `aanroepen ${c.image && c.image.calls}, ${c.image && c.image.event}`);
  check("g opnieuw berekend (50)", JSON.stringify(c.lines) === JSON.stringify(refC.lines) && c.lines[0] === String(2000001000000 + 50), c.lines.join(" "));
  const d = await run(prog("4", f2).replace("tel (a + n)", "tel (a + n + 1)"));
  check("tel opnieuw: big opnieuw berekend", d.image && d.image.calls > 2000000, `aanroepen ${d.image && d.image.calls}`);
  process.exit(fail);
})();
