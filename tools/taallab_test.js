// Het taallab (websapl/taallab.html) in de WebSapl-worker, zonder browser:
// elke voorbeeldtaal compileren (PREPROCESS + COMPILE) en een paar
// programma's draaien (RUN met het programma als bestand), met dezelfde
// logica als de pagina (websapl/js/taallab_core.js). Verwacht: dezelfde
// uitkomsten als taalproto/run_tests.sh en taalproto/jit/run_jit.sh.
//
//   node websapl/tools/taallab_test.js        (vanuit de repo-root)
const fs = require("fs");
const path = require("path");
const { call, init, repo } = require("./worker_harness.js");
const TL = require("../js/taallab_core.js");

const web = (p) => fs.readFileSync(path.join(repo, "websapl", p), "utf8");

async function buildLang(langSrc) {
  const c = TL.composeSource(langSrc);
  if (c.error) return { error: c.error };
  const pp = await call({ type: "PREPROCESS", source: c.source, path: "/workspace/taal.spp" });
  if (!pp.success) return { error: pp.stdout || pp.stderr };
  const cfp = pp.files[0].content;
  const cc = await call({ type: "COMPILE", source: cfp, path: "/workspace/taal.cfp", stages: ["jmvm"] });
  if (!cc.success) return { error: cc.stderr };
  return { jmvm: cc.files.find((f) => f.name.endsWith(".jmvm")).content };
}

const run = (jmvm, program) => TL.runHybride(call, jmvm, program);
const runJit = (jmvm, program) => TL.runJit(call, jmvm, program, null);

(async () => {
  await init();
  let fail = 0;
  const check = (label, got, want) => {
    const ok = got === want;
    if (!ok) fail = 1;
    console.log(`${ok ? "ok  " : "FOUT"}  ${label}: ${got}${ok ? "" : `  (verwacht ${want})`}`);
  };
  const want = { "queens.tiny": "92", "primes.tiny": "669", "higher.tiny": "102", "fib.while": "832040",
    "ggd.while": "21", "lijsten.ml": "220", "queens.ml": "92", "voorbeeld.calc": "24" };
  for (const p of TL.PRESETS) {
    const t = Date.now();
    const b = await buildLang(web(p.lang));
    if (b.error) { fail = 1; console.log(`FOUT  ${p.id}: taal compileert niet: ${b.error}`); continue; }
    console.log(`      ${p.id}: taal gecompileerd in ${Date.now() - t} ms`);
    for (const prog of p.programs) {
      const name = typeof prog === "string" ? path.basename(prog) : prog.name;
      if (!(name in want)) continue;
      const text = typeof prog === "string" ? web(prog) : prog.text;
      const r = await run(b.jmvm, text);
      check(`${p.id} ${name} hybride (${r.ms} ms, ${r.instr} instr.)`, r.ok ? r.text : `fout: ${r.text}`, want[name]);
      const j = await runJit(b.jmvm, text);
      check(`${p.id} ${name} JIT (uitschrijven ${j.tWrite} ms, compileren ${j.tCompile} ms, draaien ${j.ms} ms, ${j.instr} instr.)`, j.ok ? j.text : `fout: ${j.text}`, want[name]);
    }
  }
  // fouten: syntaxis en scope, als melding (geen crash)
  const tiny = await buildLang(web("taalproto/tiny/tiny.spp"));
  const e1 = await run(tiny.jmvm, "fun main() = 1 +;");
  check("tiny syntaxfout", e1.ok ? "geen fout" : e1.text, "regel 1: verwacht '-', een getal, 'true', 'false', een naam, '[' of '(', maar zag ';'");
  const e2 = await run(tiny.jmvm, "fun main() = y;");
  check("tiny scopefout", e2.ok ? "geen fout" : e2.text, "onbekende naam y");
  const e4 = await runJit(tiny.jmvm, "fun main() = y;");
  check("tiny scopefout via JIT", e4.ok ? "geen fout" : e4.text, "onbekende naam y");
  // lijsten en booleans: de JIT-route toont ze zoals de hybride route
  const l1 = await run(tiny.jmvm, "fun main() = [1 < 2, false];"), l2 = await runJit(tiny.jmvm, "fun main() = [1 < 2, false];");
  check("tiny lijst via JIT gelijk aan hybride", l2.text, l1.text);
  // een taal zonder Lang-waarde
  const e3 = await buildLang("f x = x\n");
  check("geen taal", e3.error ? "fout" : "geen fout", "fout");
  process.exit(fail);
})();
