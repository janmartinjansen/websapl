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
 * benchmarks_saplplus/). Voeg je een nieuwe kopie toe: zet hem in ENTRIES
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
  { src: "contracts/contracts.cfp", dst: "contracts/contracts.cfp" },
  { src: "contracts/phantom_types.cfp", dst: "contracts/phantom_types.cfp" },
  { src: "contracts/voorbeeld_precondities.cfp", dst: "contracts/voorbeeld_precondities.cfp" },
  { src: "contracts/voorbeeld_precondities_fout.cfp", dst: "contracts/voorbeeld_precondities_fout.cfp" },
  { src: "contracts/voorbeeld_refine.cfp", dst: "contracts/voorbeeld_refine.cfp" },
  { src: "contracts/voorbeeld_safe_makeconstr.cfp", dst: "contracts/voorbeeld_safe_makeconstr.cfp" },
  { src: "contracts/voorbeeld_safe_makeconstr_fout.cfp", dst: "contracts/voorbeeld_safe_makeconstr_fout.cfp" },
  { src: "workbench/css/codemirror.min.css", dst: "css/codemirror.min.css" },
  { src: "dict/dict_basic.cfp", dst: "dict/dict_basic.cfp" },
  { src: "dict/dict_basic.jmvm", dst: "dict/dict_basic.jmvm" },
  { src: "docs/main.pdf", dst: "docs/main.pdf" },
  { src: "preprocess/driver.jmvm", dst: "engine/driver.jmvm" },
  { src: "lamlift/lamlift.jmvm", dst: "engine/lamlift.jmvm" },
  { src: "sapl_compiler/retagcomp.jmvm", dst: "engine/retagcomp.jmvm" },
  { src: "sapl_compiler/retaglink.jmvm", dst: "engine/retaglink.jmvm" },
  { src: "sapl_compiler/saplcomp.jmvm", dst: "engine/saplcomp.jmvm" },
  { src: "sapl_compiler/saplcomp_module.jmvm", dst: "engine/saplcomp_module.jmvm" },
  { src: "preprocess/typecheck.jmvm", dst: "engine/typecheck.jmvm" },
  { src: "examples/curryvb.cfp", dst: "examples/curryvb.cfp" },
  { src: "examples/curryvbns.cfp", dst: "examples/curryvbns.cfp" },
  { src: "examples/fac.cfp", dst: "examples/fac.cfp" },
  { src: "examples/fib1.cfp", dst: "examples/fib1.cfp" },
  { src: "examples/fib43.cfp", dst: "examples/fib43.cfp" },
  { src: "examples/hanoi.cfp", dst: "examples/hanoi.cfp" },
  { src: "io/iotest.cfp", dst: "examples/iotest.cfp" },
  { src: "io/lazy_io_test.cfp", dst: "examples/lazy_io_test.cfp" },
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
  { src: "notebooks/data_verkennen.spp", dst: "notebooks/data_verkennen.spp" },
  { src: "notebooks/data/fruit.csv", dst: "notebooks/data/fruit.csv" },
  { src: "notebooks/kennismaking.spp", dst: "notebooks/kennismaking.spp" },
  { src: "lib/eqnum.spp", dst: "lib/eqnum.spp" },
  { src: "lib/stdlib.cfp", dst: "lib/stdlib.cfp" },
  { src: "docs/main.pdf", dst: "paper_examples/main.pdf" },
  { src: "parser_combinators/calc_demo.spp", dst: "parser_combinators/calc_demo.spp" },
  { src: "parser_combinators/parsecomb.spp", dst: "parser_combinators/parsecomb.spp" },
  { src: "parser_combinators/saplParse.spp", dst: "parser_combinators/saplParse.spp" },
  { src: "parser_combinators/saplParse_demo.spp", dst: "parser_combinators/saplParse_demo.spp" },
  { src: "records/records_showcase.spp", dst: "records/records_showcase.spp" },
  { src: "repl/repl_prelude.cfp", dst: "repl/repl_prelude.cfp" },
  { src: "repl/stddyn.cfp", dst: "repl/stddyn.cfp" },
  { src: "benchmarks/fib.cfp", dst: "repl_examples/fib.cfp" },
  { src: "benchmarks/hamming.cfp", dst: "repl_examples/hamming.cfp" },
  { src: "benchmarks/primes.cfp", dst: "repl_examples/primes.cfp" },
  { src: "benchmarks/queens.cfp", dst: "repl_examples/queens.cfp" },
  { src: "benchmarks/twice.cfp", dst: "repl_examples/twice.cfp" },
  { src: "sapl_compiler/ast_helpers.cfp", dst: "sapl_compiler/ast_helpers.cfp" },
  { src: "sapl_compiler/lexer2.cfp", dst: "sapl_compiler/lexer2.cfp" },
  { src: "sapl_compiler/newparser_ast.cfp", dst: "sapl_compiler/newparser_ast.cfp" },
  { src: "sapl_compiler/stage5_codegen.cfp", dst: "sapl_compiler/stage5_codegen.cfp" },
  { src: "sapl_compiler/stage_dump.cfp", dst: "sapl_compiler/stage_dump.cfp" },
  { src: "sapl_plus_demo/sapl_plus_showcase.spp", dst: "sapl_plus_demo/sapl_plus_showcase.spp" },
  { src: "saplsimple_direct/examples/list_demo.fp", dst: "selfinter/examples/list_demo.fp" },
  { src: "saplsimple_direct/examples/minimal_primes.fp", dst: "selfinter/examples/minimal_primes.fp" },
  { src: "saplsimple_direct/examples/self_interpreter.fp", dst: "selfinter/examples/self_interpreter.fp" },
  { src: "saplsimple_direct/examples/sieve.fp", dst: "selfinter/examples/sieve.fp" },
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
];

function expected(entry) {
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
  for (const entry of ENTRIES) {
    const dst = path.join(WEBSAPL, entry.dst);
    let want;
    try {
      want = expected(entry);
    } catch (err) {
      console.error(`FOUT  ${err.message}`);
      drift++;
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
}

main();
