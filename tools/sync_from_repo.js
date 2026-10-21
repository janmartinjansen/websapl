#!/usr/bin/env node
/**
 * Houdt de kopieën in websapl/ gelijk aan hun bron elders in de repo.
 *
 * WebSapl is een statische site: alles wat de browser nodig heeft
 * (compiler-bytecode in engine/, #import-modules, voorbeelden) moet ONDER
 * websapl/ staan. Die bestanden zijn dus kopieën, en zonder dit script
 * liepen ze ongemerkt achter: tot 24 sep 2026 stonden er een maand oude
 * sapl_compiler/stage_dump.cfp en ast_helpers.cfp.
 *
 *   node websapl/tools/sync_from_repo.js          # kopieer wat afwijkt
 *   node websapl/tools/sync_from_repo.js --check  # alleen melden; exit 1 bij afwijking
 *
 * De bron is altijd leidend: pas het bestand daar aan, niet hier. Een paar
 * kopieën krijgen een padvertaling (`rewrite`), omdat websapl sommige
 * mappen anders noemt (benchmarks/ -> benchmarks_sapl/, benchmarks_spp/ ->
 * benchmarks_saplplus/; sinds 12 oktober 2026 ook tests/x/ -> x/,
 * experiments/x/ -> x/: websapl hield de oude indeling). Voeg je een nieuwe kopie toe : zet hem in ENTRIES
 * en draai daarna ook build_manifest.js.
 *
 * Bewust NIET gesynchroniseerd (websapl-eigen inhoud met dezelfde naam):
 *   - io/lazy_io_test_input.txt: eigen, Nederlandse invoertekst die de
 *     webversie van lazy_io_test.cfp uitlegt.
 *   - README.md's: elke websapl-map heeft een eigen README voor de
 *     bestandsboom in de browser.
 *   - css/workbench.css, server.js: websapl-eigen, geen kopie van workbench/.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const WEBSAPL = path.join(REPO, "websapl");

// src: pad vanaf de repo-root; dst: pad vanaf websapl/.
const ENTRIES = [
  { src: "benchmarks/eval.cfp", dst: "benchmarks_sapl/eval.cfp" },
  // eval2: de vervanger van eval in de kernbenchmarks (11 oktober 2026); hij
  // importeert de interpreter uit Sapl_interpreter/, die de worker met
  // fetch("../Sapl_interpreter/...") ophaalt.
  { src: "benchmarks/eval2.cfp", dst: "benchmarks_sapl/eval2.cfp" },
  { src: "Sapl_interpreter/ast.cfp", dst: "Sapl_interpreter/ast.cfp" },
  { src: "Sapl_interpreter/interp.cfp", dst: "Sapl_interpreter/interp.cfp" },
  { src: "Sapl_interpreter/lexer.cfp", dst: "Sapl_interpreter/lexer.cfp" },
  { src: "Sapl_interpreter/parser.cfp", dst: "Sapl_interpreter/parser.cfp" },
  { src: "benchmarks/fib.cfp", dst: "benchmarks_sapl/fib.cfp" },
  { src: "benchmarks/hamming.cfp", dst: "benchmarks_sapl/hamming.cfp" },
  { src: "benchmarks/knights.cfp", dst: "benchmarks_sapl/knights.cfp" },
  { src: "benchmarks/match.cfp", dst: "benchmarks_sapl/match.cfp" },
  { src: "benchmarks/parsetest.cfp", dst: "benchmarks_sapl/parsetest.cfp" },
  { src: "benchmarks/primes.cfp", dst: "benchmarks_sapl/primes.cfp" },
  { src: "benchmarks/prolog.cfp", dst: "benchmarks_sapl/prolog.cfp" },
  { src: "benchmarks/queens.cfp", dst: "benchmarks_sapl/queens.cfp" },
  { src: "benchmarks/sort.cfp", dst: "benchmarks_sapl/sort.cfp" },
  { src: "benchmarks/sprimes.cfp", dst: "benchmarks_sapl/sprimes.cfp" },
  { src: "benchmarks/twice.cfp", dst: "benchmarks_sapl/twice.cfp" },
  { src: "benchmarks_spp/eval.spp", dst: "benchmarks_saplplus/eval.spp" },
  { src: "benchmarks_spp/hamming.spp", dst: "benchmarks_saplplus/hamming.spp" },
  { src: "benchmarks_spp/knights.spp", dst: "benchmarks_saplplus/knights.spp" },
  { src: "benchmarks_spp/match.spp", dst: "benchmarks_saplplus/match.spp" },
  { src: "benchmarks_spp/parsetest.spp", dst: "benchmarks_saplplus/parsetest.spp", rewrite: [["\"benchmarks_spp/", "\"benchmarks_saplplus/"]] },
  { src: "benchmarks_spp/primes.spp", dst: "benchmarks_saplplus/primes.spp" },
  { src: "benchmarks_spp/prolog.spp", dst: "benchmarks_saplplus/prolog.spp", rewrite: [["\"benchmarks_spp/", "\"benchmarks_saplplus/"]] },
  { src: "benchmarks_spp/prologlib.spp", dst: "benchmarks_saplplus/prologlib.spp" },
  { src: "benchmarks_spp/queens.spp", dst: "benchmarks_saplplus/queens.spp" },
  { src: "benchmarks_spp/sort.spp", dst: "benchmarks_saplplus/sort.spp" },
  { src: "experiments/contracts/contracts.cfp", dst: "contracts/contracts.cfp", rewrite: [["experiments/contracts/", "contracts/"]] },
  { src: "experiments/contracts/phantom_types.cfp", dst: "contracts/phantom_types.cfp", rewrite: [["experiments/contracts/", "contracts/"]] },
  { src: "experiments/contracts/voorbeeld_precondities.cfp", dst: "contracts/voorbeeld_precondities.cfp", rewrite: [["experiments/contracts/", "contracts/"]] },
  { src: "experiments/contracts/voorbeeld_precondities_fout.cfp", dst: "contracts/voorbeeld_precondities_fout.cfp", rewrite: [["experiments/contracts/", "contracts/"]] },
  { src: "experiments/contracts/voorbeeld_refine.cfp", dst: "contracts/voorbeeld_refine.cfp", rewrite: [["experiments/contracts/", "contracts/"]] },
  { src: "experiments/contracts/voorbeeld_safe_makeconstr.cfp", dst: "contracts/voorbeeld_safe_makeconstr.cfp", rewrite: [["experiments/contracts/", "contracts/"]] },
  { src: "experiments/contracts/voorbeeld_safe_makeconstr_fout.cfp", dst: "contracts/voorbeeld_safe_makeconstr_fout.cfp", rewrite: [["experiments/contracts/", "contracts/"]] },
  { src: "workbench/css/codemirror.min.css", dst: "css/codemirror.min.css" },
  { src: "tests/dict/dict_basic.cfp", dst: "dict/dict_basic.cfp", rewrite: [["tests/dict/", "dict/"]] },
  { src: "tests/dict/dict_basic.jmvm", dst: "dict/dict_basic.jmvm" },
  { src: "docs/main.pdf", dst: "docs/main.pdf" },
  { src: "preprocess/driver.jmvm", dst: "engine/driver.jmvm" },
  { src: "preprocess/driver.jvb", dst: "engine/driver.jvb" },   // het binaire laadformaat (laadformaat/)
  { src: "lamlift/lamlift.jmvm", dst: "engine/lamlift.jmvm" },
  { src: "lamlift/lamlift.jvb", dst: "engine/lamlift.jvb" },   // het binaire laadformaat (laadformaat/)
  { src: "sapl_compiler/retagcomp.jmvm", dst: "engine/retagcomp.jmvm" },
  { src: "sapl_compiler/retagcomp.jvb", dst: "engine/retagcomp.jvb" },   // het binaire laadformaat (laadformaat/)
  { src: "sapl_compiler/retaglink.jmvm", dst: "engine/retaglink.jmvm" },
  { src: "sapl_compiler/retaglink.jvb", dst: "engine/retaglink.jvb" },   // het binaire laadformaat (laadformaat/)
  { src: "sapl_compiler/saplcomp.jmvm", dst: "engine/saplcomp.jmvm" },
  { src: "sapl_compiler/saplcomp.jvb", dst: "engine/saplcomp.jvb" },   // het binaire laadformaat (laadformaat/)
  { src: "sapl_compiler/saplcomp_module.jmvm", dst: "engine/saplcomp_module.jmvm" },
  { src: "sapl_compiler/saplcomp_module.jvb", dst: "engine/saplcomp_module.jvb" },   // het binaire laadformaat (laadformaat/)
  // De REPL in Sapl (stap 6, 7 oktober 2026): bytecode en prelude-interface.
  { src: "repl_sapl/build/mini_repl.jmvm", dst: "repl_sapl/build/mini_repl.jmvm" },
  { src: "repl_sapl/build/mini_repl.jvb", dst: "repl_sapl/build/mini_repl.jvb" },   // het binaire laadformaat (laadformaat/)
  { src: "repl_sapl/build/prelude/prelude.cfp", dst: "repl_sapl/build/prelude/prelude.cfp" },
  { src: "repl_sapl/build/prelude/prelude.pp.cfp", dst: "repl_sapl/build/prelude/prelude.pp.cfp" },
  { src: "repl_sapl/build/prelude/prelude.defs.txt", dst: "repl_sapl/build/prelude/prelude.defs.txt" },
  { src: "preprocess/typecheck.jmvm", dst: "engine/typecheck.jmvm" },
  { src: "preprocess/typecheck.jvb", dst: "engine/typecheck.jvb" },   // het binaire laadformaat (laadformaat/)
  { src: "examples/curryvb.cfp", dst: "examples/curryvb.cfp" },
  { src: "examples/curryvbns.cfp", dst: "examples/curryvbns.cfp" },
  { src: "examples/fac.cfp", dst: "examples/fac.cfp" },
  { src: "examples/fib1.cfp", dst: "examples/fib1.cfp" },
  { src: "examples/fib43.cfp", dst: "examples/fib43.cfp" },
  { src: "examples/hanoi.cfp", dst: "examples/hanoi.cfp" },
  { src: "tests/io/iotest.cfp", dst: "examples/iotest.cfp" },
  { src: "tests/io/lazy_io_test.cfp", dst: "examples/lazy_io_test.cfp", rewrite: [["tests/io/", "io/"]] },
  { src: "examples/maptest.cfp", dst: "examples/maptest.cfp" },
  { src: "examples/print_primes.cfp", dst: "examples/print_primes.cfp", rewrite: [["\"benchmarks/", "\"benchmarks_sapl/"]] },
  { src: "examples/string.cfp", dst: "examples/string.cfp" },
  { src: "examples/tak.cfp", dst: "examples/tak.cfp" },
  { src: "examples/tlazy.cfp", dst: "examples/tlazy.cfp" },
  { src: "examples/twice1.cfp", dst: "examples/twice1.cfp" },
  { src: "examples/twice_direct.cfp", dst: "examples/twice_direct.cfp" },
  { src: "grafisch/boom.cfp", dst: "grafisch/boom.cfp" },
  { src: "grafisch/bspline.cfp", dst: "grafisch/bspline.cfp" },
  { src: "grafisch/convex.cfp", dst: "grafisch/convex.cfp" },
  { src: "grafisch/curves.cfp", dst: "grafisch/curves.cfp" },
  { src: "grafisch/grafiek.cfp", dst: "grafisch/grafiek.cfp" },
  { src: "grafisch/grafiek_paint_interactive.cfp", dst: "grafisch/grafiek_paint_interactive.cfp" },
  { src: "grafisch/graphics.cfp", dst: "grafisch/graphics.cfp" },
  { src: "grafisch/hwdes.cfp", dst: "grafisch/hwdes.cfp" },
  { src: "grafisch/menu_demo.cfp", dst: "grafisch/menu_demo.cfp" },
  { src: "grafisch/recpic.cfp", dst: "grafisch/recpic.cfp" },
  { src: "workbench/js/clike_mode.js", dst: "js/clike_mode.js" },
  { src: "workbench/js/closebrackets.min.js", dst: "js/closebrackets.min.js" },
  { src: "workbench/js/codemirror.min.js", dst: "js/codemirror.min.js" },
  { src: "workbench/js/marked.min.js", dst: "js/marked.min.js" },
  { src: "workbench/js/matchbrackets.min.js", dst: "js/matchbrackets.min.js" },
  { src: "workbench/js/sapl_mode.js", dst: "js/sapl_mode.js" },
  { src: "lamlift/case_map.lfp", dst: "lamlift/case_map.lfp" },
  { src: "lamlift/factorial.lfp", dst: "lamlift/factorial.lfp" },
  { src: "lamlift/feature_coverage.lfp", dst: "lamlift/feature_coverage.lfp" },
  { src: "lamlift/lam25.lfp", dst: "lamlift/lam25.lfp" },
  { src: "lamlift/self_application.lfp", dst: "lamlift/self_application.lfp" },
  { src: "lamlift/shadowing.lfp", dst: "lamlift/shadowing.lfp" },
  { src: "lamlift/tromp.lfp", dst: "lamlift/tromp.lfp" },
  { src: "lc_repl/lc_repl.jmvm", dst: "lc_repl/lc_repl.jmvm" },
  { src: "lib/dict.cfp", dst: "lib/dict.cfp" },
  { src: "lib/display.spp", dst: "lib/display.spp" },
  { src: "lib/list.spp", dst: "lib/list.spp" },
  { src: "lib/notebook_glue.cfp", dst: "lib/notebook_glue.cfp" },
  { src: "lib/text.spp", dst: "lib/text.spp" },
  { src: "lib/stats.spp", dst: "lib/stats.spp" },
  { src: "lib/plot.spp", dst: "lib/plot.spp" },
  { src: "lib/csv.spp", dst: "lib/csv.spp" },
  { src: "lib/shape.spp", dst: "lib/shape.spp" },
  { src: "notebooks/data_verkennen.spp", dst: "notebooks/data_verkennen.spp" },
  { src: "notebooks/data/fruit.csv", dst: "notebooks/data/fruit.csv" },
  { src: "notebooks/kennismaking.spp", dst: "notebooks/kennismaking.spp" },
  { src: "notebooks/formulieren.spp", dst: "notebooks/formulieren.spp" },
  { src: "notebooks/vm_metingen.spp", dst: "notebooks/vm_metingen.spp" },
  { src: "notebooks/data/meting_info.csv", dst: "notebooks/data/meting_info.csv" },
  { src: "notebooks/data/benchmarks.csv", dst: "notebooks/data/benchmarks.csv" },
  { src: "notebooks/data/compiler.csv", dst: "notebooks/data/compiler.csv" },
  { src: "notebooks/data/opcodes.csv", dst: "notebooks/data/opcodes.csv" },
  { src: "notebooks/data/schaal_nfib.csv", dst: "notebooks/data/schaal_nfib.csv" },
  { src: "lib/eqnum.spp", dst: "lib/eqnum.spp" },
  { src: "lib/stdlib.cfp", dst: "lib/stdlib.cfp" },
  { src: "docs/main.pdf", dst: "paper_examples/main.pdf" },
  { src: "experiments/parser_combinators/calc_demo.spp", dst: "parser_combinators/calc_demo.spp", rewrite: [["experiments/parser_combinators/", "parser_combinators/"]] },
  { src: "experiments/parser_combinators/parsecomb.spp", dst: "parser_combinators/parsecomb.spp" },
  { src: "experiments/parser_combinators/saplParse.spp", dst: "parser_combinators/saplParse.spp", rewrite: [["experiments/parser_combinators/", "parser_combinators/"]] },
  { src: "experiments/parser_combinators/saplParse_demo.spp", dst: "parser_combinators/saplParse_demo.spp", rewrite: [["experiments/parser_combinators/", "parser_combinators/"]] },
  { src: "tests/records/records_showcase.spp", dst: "records/records_showcase.spp" },
  { src: "repl/repl_prelude.cfp", dst: "repl/repl_prelude.cfp" },
  { src: "repl/stddyn.cfp", dst: "repl/stddyn.cfp" },
  { src: "benchmarks/fib.cfp", dst: "repl_examples/fib.cfp" },
  { src: "benchmarks/hamming.cfp", dst: "repl_examples/hamming.cfp" },
  { src: "benchmarks/primes.cfp", dst: "repl_examples/primes.cfp" },
  { src: "benchmarks/queens.cfp", dst: "repl_examples/queens.cfp" },
  { src: "benchmarks/twice.cfp", dst: "repl_examples/twice.cfp" },
  { src: "sapl_compiler/ast_helpers.cfp", dst: "sapl_compiler/ast_helpers.cfp" },
  { src: "sapl_compiler/lexer2.cfp", dst: "sapl_compiler/lexer2.cfp" },
  { src: "sapl_compiler/ast.cfp", dst: "sapl_compiler/ast.cfp" },
  { src: "sapl_compiler/stage5_codegen.cfp", dst: "sapl_compiler/stage5_codegen.cfp" },
  { src: "sapl_compiler/stage_dump.cfp", dst: "sapl_compiler/stage_dump.cfp" },
  { src: "experiments/sapl_plus_demo/sapl_plus_showcase.spp", dst: "sapl_plus_demo/sapl_plus_showcase.spp", rewrite: [["experiments/parser_combinators/", "parser_combinators/"]] },
  { src: "experiments/saplsimple_direct/examples/list_demo.fp", dst: "selfinter/examples/list_demo.fp" },
  { src: "experiments/saplsimple_direct/examples/minimal_primes.fp", dst: "selfinter/examples/minimal_primes.fp" },
  { src: "experiments/saplsimple_direct/examples/self_interpreter.fp", dst: "selfinter/examples/self_interpreter.fp" },
  { src: "experiments/saplsimple_direct/examples/sieve.fp", dst: "selfinter/examples/sieve.fp" },
  { src: "typing/01_basis.cfp", dst: "typing/01_basis.cfp" },
  { src: "typing/02_lijsten.cfp", dst: "typing/02_lijsten.cfp" },
  { src: "typing/03_case.cfp", dst: "typing/03_case.cfp" },
  { src: "typing/04_adt.cfp", dst: "typing/04_adt.cfp" },
  { src: "typing/05_zf.spp", dst: "typing/05_zf.spp" },
  { src: "typing/06_guards_multiclause.spp", dst: "typing/06_guards_multiclause.spp" },
  { src: "typing/07_lambda.spp", dst: "typing/07_lambda.spp" },
  { src: "typing/08_try_throw.cfp", dst: "typing/08_try_throw.cfp" },
  { src: "typing/09_foutmeldingen.cfp", dst: "typing/09_foutmeldingen.cfp" },
  { src: "typing/10_beperkingen.cfp", dst: "typing/10_beperkingen.cfp" },
  { src: "typing/11_vm_primitieven.cfp", dst: "typing/11_vm_primitieven.cfp" },
  // WASM-compiler testbank; wasm_test/build/ zelf is gegenereerd door
  // wasm_compiler/build_websapl_test.sh en staat hier dus niet.
  { src: "experiments/wasm_compiler/host.js", dst: "wasm_test/host.js" },
  // Het taallab (taallab.html, 19 oktober 2026): het raamwerk van taalproto/,
  // de hybride route waar het op draait, de vier voorbeeldtalen en hun programma's.
  { src: "docs/2026-10-19_language_prototyping_guide.md", dst: "docs/language_prototyping_guide.md" },
  { src: "sapl_naar_lc/hybride.cfp", dst: "sapl_naar_lc/hybride.cfp" },
  { src: "sapl_naar_lc/compiler.cfp", dst: "sapl_naar_lc/compiler.cfp" },
  { src: "sapl_naar_lc/seval.cfp", dst: "sapl_naar_lc/seval.cfp" },
  { src: "taalproto/taal.spp", dst: "taalproto/taal.spp" },
  { src: "taalproto/naar_sapl.spp", dst: "taalproto/naar_sapl.spp" },
  { src: "taalproto/repl_taal.spp", dst: "taalproto/repl_taal.spp" },
  { src: "taalproto/grammatica.spp", dst: "taalproto/grammatica.spp" },
  { src: "taalproto/calc/calc.spp", dst: "taalproto/calc/calc.spp" },
  { src: "taalproto/while/while.spp", dst: "taalproto/while/while.spp" },
  { src: "taalproto/ml/ml.spp", dst: "taalproto/ml/ml.spp" },
  { src: "taalproto/tiny/tiny.spp", dst: "taalproto/tiny/tiny.spp" },
  { src: "taalproto/tiny/progs/higher.tiny", dst: "taalproto/tiny/progs/higher.tiny" },
  { src: "taalproto/tiny/progs/primes.tiny", dst: "taalproto/tiny/progs/primes.tiny" },
  { src: "taalproto/tiny/progs/queens.tiny", dst: "taalproto/tiny/progs/queens.tiny" },
  { src: "taalproto/ml/progs/boom.ml", dst: "taalproto/ml/progs/boom.ml" },
  { src: "taalproto/ml/progs/lijsten.ml", dst: "taalproto/ml/progs/lijsten.ml" },
  { src: "taalproto/ml/progs/queens.ml", dst: "taalproto/ml/progs/queens.ml" },
  { src: "taalproto/ml/progs/vormen.ml", dst: "taalproto/ml/progs/vormen.ml" },
  { src: "taalproto/while/progs/collatz.while", dst: "taalproto/while/progs/collatz.while" },
  { src: "taalproto/while/progs/fib.while", dst: "taalproto/while/progs/fib.while" },
  { src: "taalproto/while/progs/ggd.while", dst: "taalproto/while/progs/ggd.while" },
  { src: "taalproto/while/progs/priemen.while", dst: "taalproto/while/progs/priemen.while" },
  { src: "taalproto/while/progs/priemen_groot.while", dst: "taalproto/while/progs/priemen_groot.while" },
];
// De vooraf gebouwde stukken van de REPL in Sapl (repl_sapl/build/modules/,
// build_mini_repl.sh): de hele map, zodat een nieuw stuk vanzelf meegaat.
for (const f of fs.readdirSync(path.join(REPO, "repl_sapl/build/modules")).sort()) {
  ENTRIES.push({ src: "repl_sapl/build/modules/" + f, dst: "repl_sapl/build/modules/" + f });
}


// Een .jvb (het binaire laadformaat, laadformaat/ANALYSE.md) hoort bij de
// .jmvm ernaast: zijn SRC-sectie bewaart hash en lengte van die tekst. In
// WebSapl staat die .jmvm er niet naast (de worker laadt alleen de .jvb), dus
// de VM kan het daar niet controleren: dit script doet het, en weigert een
// .jvb die niet (meer) bij zijn .jmvm hoort. Dezelfde hash als jvbHash in
// parser.cpp.
function jvbHash(buf) {
  const M = (1n << 64n) - 1n, P = 1099511628211n;
  let h = 1469598103934665603n;
  let i = 0;
  for (; i + 8 <= buf.length; i += 8) {
    h = ((h ^ buf.readBigUInt64LE(i)) * P) & M;
    h ^= h >> 29n;
  }
  for (; i < buf.length; i++) h = ((h ^ BigInt(buf[i])) * P) & M;
  return h ^ BigInt(buf.length);
}

// Een stuk van de REPL (repl_sapl/build/modules/, sinds 10 oktober 2026 als
// .jvb geschreven door de REPL zelf) heeft geen .jmvm ernaast en dus geen
// SRC-sectie: daar valt niets te controleren.
function checkJvbSource(src) {
  const jvb = fs.readFileSync(path.join(REPO, src));
  const jmvmPath = path.join(REPO, src.replace(/\.jvb$/, ".jmvm"));
  if (src.startsWith("repl_sapl/build/modules/") && !fs.existsSync(jmvmPath)) return;
  const fix = "(bash laadformaat/jvb_bijwerken.sh)";
  if (jvb.length < 16 || jvb.toString("latin1", 0, 4) !== "JVB0") throw new Error(`${src} is geen .jvb`);
  const ns = jvb.readUInt32LE(12);
  for (let k = 0; k < ns; k++) {
    if (jvb.readUInt32LE(16 + 12 * k) !== 7) continue;   // SRC
    const off = jvb.readUInt32LE(20 + 12 * k);
    const text = fs.readFileSync(jmvmPath);
    if (jvb.readBigUInt64LE(off + 8) !== BigInt(text.length) || jvb.readBigUInt64LE(off) !== jvbHash(text))
      throw new Error(`${src} hoort niet (meer) bij ${path.relative(REPO, jmvmPath)} ${fix}`);
    return;
  }
  throw new Error(`${src} heeft geen SRC-sectie ${fix}`);
}

function expected(entry) {
  if (entry.src.endsWith(".jvb")) checkJvbSource(entry.src);
  const buf = fs.readFileSync(path.join(REPO, entry.src));
  if (!entry.rewrite) return buf;
  let text = buf.toString("utf8");
  for (const [from, to] of entry.rewrite) {
    if (!text.includes(from)) {
      throw new Error(`${entry.src}: rewrite-patroon ${JSON.stringify(from)} komt niet (meer) voor`);
    }
    text = text.split(from).join(to);
  }
  return Buffer.from(text, "utf8");
}

function main() {
  const check = process.argv.includes("--check");
  let drift = 0;
  let written = 0;
  let errors = 0;   // een bron die niet gekopieerd mag worden (bv. een verouderde .jvb)
  for (const entry of ENTRIES) {
    const dst = path.join(WEBSAPL, entry.dst);
    let want;
    try {
      want = expected(entry);
    } catch (err) {
      console.error(`FOUT  ${err.message}`);
      drift++;
      errors++;
      continue;
    }
    const have = fs.existsSync(dst) ? fs.readFileSync(dst) : null;
    if (have && have.equals(want)) continue;
    drift++;
    const what = have ? "wijkt af" : "ontbreekt";
    if (check) {
      console.log(`${what.padEnd(9)} websapl/${entry.dst}  (bron: ${entry.src})`);
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, want);
      written++;
      console.log(`bijgewerkt websapl/${entry.dst}  (bron: ${entry.src}, ${what})`);
    }
  }
  if (check) {
    console.log(drift ? `${drift} van ${ENTRIES.length} kopieën lopen niet gelijk met hun bron.` : `Alle ${ENTRIES.length} kopieën in websapl/ zijn gelijk aan hun bron.`);
    process.exit(drift ? 1 : 0);
  }
  console.log(written ? `${written} bestand(en) bijgewerkt. Nieuw bestand erbij? Draai dan ook: node websapl/tools/build_manifest.js` : `Niets te doen: alle ${ENTRIES.length} kopieën zijn al gelijk.`);
  if (errors) process.exit(1);
}

main();
