/**
 * taallab_core.js -- de logica van het taallab (taallab.html), los van de
 * pagina, ook in Node te laden voor tests (websapl/tools/taallab_test.js).
 * Zie docs/2026-10-19_language_prototyping_guide.md: een taal is een .spp met
 * een waarde `naam = Lang ...` (taalproto/taal.spp). Het lab zet er een start
 * onder die het programma via de hybride route draait, of het als Sapl+
 * uitschrijft (taalproto/naar_sapl.spp, de JIT-route) -- welke van de twee
 * staat in een tweede bestand, zodat de taal maar een keer compileert:
 *
 *   start = taallab_start <naam> (readFile "/workspace/route.txt") (readFile "/workspace/programma.txt")
 *
 * De JIT-route compileert de uitgeschreven Sapl+ daarna met gen1 en draait die
 * (zoals taalproto/jit/jit.sh).
 *
 * Werkwijze (dezelfde berichten als de Workbench): PREPROCESS (.spp -> .cfp),
 * COMPILE (.cfp -> .jmvm), en RUN met het programma als bestand. De taal
 * wordt alleen opnieuw gecompileerd als haar tekst verandert; een ander
 * programma draait meteen.
 */
(function (root) {
  const PROGRAM_PATH = "workspace/programma.txt";
  const ROUTE_PATH = "workspace/route.txt";

  // De voorbeeldtalen: de taal (een kopie van taalproto/ in websapl/) en de
  // programma's erbij. Een programma zonder pad is een tekst hier.
  const PRESETS = [
    { id: "tiny", label: "tiny (de taal van de handleiding)", lang: "taalproto/tiny/tiny.spp", template: "fun main() = %;",
      programs: ["taalproto/tiny/progs/queens.tiny", "taalproto/tiny/progs/primes.tiny", "taalproto/tiny/progs/higher.tiny"] },
    { id: "calc", label: "calc (rekenmachine)", lang: "taalproto/calc/calc.spp", template: "",
      programs: [{ name: "voorbeeld.calc", text: "// operatoren, unaire min, let\nlet x = 3 * 4 in x - (2 - 1) * -x\n" },
                 { name: "macht.calc", text: "2 ^ 3 ^ 2 + -2 ^ 2\n" }] },
    { id: "while", label: "while (imperatief)", lang: "taalproto/while/while.spp", template: "",
      programs: ["taalproto/while/progs/fib.while", "taalproto/while/progs/ggd.while",
                 "taalproto/while/progs/priemen.while", "taalproto/while/progs/collatz.while"] },
    { id: "ml", label: "MiniML", lang: "taalproto/ml/ml.spp", template: "let main = %;",
      programs: ["taalproto/ml/progs/lijsten.ml", "taalproto/ml/progs/vormen.ml",
                 "taalproto/ml/progs/boom.ml", "taalproto/ml/progs/queens.ml"] },
  ];

  // De naam van de taalwaarde: de laatste definitie `naam = Lang ...` op kolom 0.
  function langName(src) {
    let name = null;
    for (const m of src.matchAll(/^([a-z][A-Za-z0-9_']*)\s*=\s*Lang\b/gm)) name = m[1];
    return name;
  }

  // Een eigen start in de taal zelf hindert: die gaat eruit (alleen een
  // definitie `start = ...` op kolom 0 met de vervolgregels die inspringen).
  function withoutStart(src) {
    const out = [];
    let skipping = false;
    for (const line of src.split("\n")) {
      if (/^start\s*=/.test(line)) { skipping = true; continue; }
      if (skipping && /^\s+\S/.test(line)) continue;
      skipping = false;
      out.push(line);
    }
    return out.join("\n");
  }

  function composeSource(langSrc) {
    const name = langName(langSrc);
    if (!name) return { error: "geen taal gevonden: zet in de taal een definitie  naam = Lang \"...\" grammatica controle vertaling" };
    return { name, source: `#import "taalproto/naar_sapl.spp"\n` + withoutStart(langSrc) +
      `\n\nstart = taallab_start ${name} (readFile "/${ROUTE_PATH}") (readFile "/${PROGRAM_PATH}")\n` +
      `taallab_start lang route src = if (strEqual route "jit") (printString (langSapl lang src)) (runLang lang src)\n` };
  }

  // Wat de JIT-route uitschrijft: de Sapl+-tekst, of een fout van de taal
  // (langSapl geeft dan een commentaarregel "// fout: ...").
  function parseJitText(raw) {
    const r = parseRunOutput(raw);
    if (!r.ok) return r;
    const m = r.text.match(/^\/\/ fout: ([\s\S]*)$/);
    return m ? { ok: false, text: m[1].trim() } : { ok: true, text: r.text + "\n" };
  }

  // Wat runLang afdrukt: de regels tussen "execution started" en de
  // statistieken van de VM.
  function parseRunOutput(raw) {
    const lines = String(raw || "").split("\n");
    const i = lines.findIndex((l) => l.indexOf("execution started") !== -1);
    const body = [];
    for (const l of lines.slice(i + 1)) {
      if (/^(res: |stop$|Elapsed time|nr gc|instr executed|calls: |creates: )/.test(l)) break;
      body.push(l);
    }
    while (body.length && body[body.length - 1] === "") body.pop();
    const text = body.join("\n").replace(/stop$/, "");
    const m = text.match(/^fout: ([\s\S]*)$/);
    return m ? { ok: false, text: m[1] } : { ok: true, text };
  }

  // De twee routes, met de berichten van de worker (call: bericht -> antwoord).
  // Gedeeld door de pagina en websapl/tools/taallab_test.js. `cache`: hash van
  // de uitgeschreven Sapl+ -> .jmvm (een Map, of null).
  async function runHybride(call, jmvm, program) {
    const t0 = now();
    const r = await call({ type: "RUN", contentOrPath: jmvm, isPath: false, files: { [PROGRAM_PATH]: program, [ROUTE_PATH]: "hybride" } });
    return { ...parseRunOutput(r.output), ms: Math.round(now() - t0), instr: instrOf(r) };
  }

  async function runJit(call, jmvm, program, cache) {
    const t0 = now();
    const w = await call({ type: "RUN", contentOrPath: jmvm, isPath: false, files: { [PROGRAM_PATH]: program, [ROUTE_PATH]: "jit" } });
    const sapl = parseJitText(w.output);
    const tWrite = Math.round(now() - t0);
    if (!sapl.ok) return { ok: false, text: sapl.text, tWrite };
    const key = hashText(sapl.text);
    let prog = cache && cache.get(key), tCompile = null;
    if (!prog) {
      const t1 = now();
      const pp = await call({ type: "PREPROCESS", source: sapl.text, path: "/workspace/programma_jit.spp" });
      if (!pp.success) return { ok: false, text: "de uitgeschreven Sapl+ is niet in orde (een fout in naar_sapl?):\n" + (pp.stdout || pp.stderr), sapl: sapl.text, tWrite };
      const cc = await call({ type: "COMPILE", source: pp.files[0].content, path: "/workspace/programma_jit.cfp", stages: ["jmvm"] });
      if (!cc.success) return { ok: false, text: "de uitgeschreven Sapl+ compileert niet (een fout in naar_sapl?):\n" + cc.stderr, sapl: sapl.text, tWrite };
      prog = cc.files.find((f) => f.name.endsWith(".jmvm")).content;
      if (cache) cache.set(key, prog);
      tCompile = Math.round(now() - t1);
    }
    const t2 = now();
    const r = await call({ type: "RUN", contentOrPath: prog, isPath: false });
    return { ...parseRunOutput(r.output), sapl: sapl.text, tWrite, tCompile, ms: Math.round(now() - t2), instr: instrOf(r) };
  }

  function instrOf(r) { return (r && r.metrics && r.metrics.instr_executed) || null; }
  function now() { return typeof performance !== "undefined" ? performance.now() : Date.now(); }

  // De REPL (de REPL in Sapl in de worker, RSAPL_EVAL): de taal komt als
  // bestand in de engine en wordt met :lang geladen (repl_sapl/mini_repl.spp,
  // taalproto/repl_taal.spp). Het sjabloon zegt hoe een expressie een
  // programma wordt (% is de plek); leeg: elke regel is een heel programma.
  const REPL_LANG_PATH = "workspace/taallab_taal.spp";
  function replLangCommand(name, template) {
    return `:lang "/${REPL_LANG_PATH}" ${name}` + (template ? ` "${template.replace(/"/g, "'")}"` : "");
  }

  // Een eenvoudige hash om een gecompileerde taal te herkennen.
  function hashText(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  const api = { PROGRAM_PATH, ROUTE_PATH, PRESETS, langName, withoutStart, composeSource, parseRunOutput, parseJitText, hashText, runHybride, runJit, REPL_LANG_PATH, replLangCommand };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TaalLab = api;
})(typeof window !== "undefined" ? window : globalThis);
