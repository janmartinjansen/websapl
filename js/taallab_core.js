/**
 * taallab_core.js -- de logica van het taallab (taallab.html), los van de
 * pagina, ook in Node te laden voor tests (websapl/tools/taallab_test.js).
 * Zie docs/2026-10-19_language_prototyping_guide.md: een taal is een .spp met
 * een waarde `naam = Lang ...` (taalproto/taal.spp). Het lab zet er een start
 * onder die het programma via de hybride route draait:
 *
 *   start = runLang <naam> (readFile "/workspace/programma.txt")
 *
 * Werkwijze (dezelfde berichten als de Workbench): PREPROCESS (.spp -> .cfp),
 * COMPILE (.cfp -> .jmvm), en RUN met het programma als bestand. De taal
 * wordt alleen opnieuw gecompileerd als haar tekst verandert; een ander
 * programma draait meteen.
 */
(function (root) {
  const PROGRAM_PATH = "workspace/programma.txt";

  // De voorbeeldtalen: de taal (een kopie van taalproto/ in websapl/) en de
  // programma's erbij. Een programma zonder pad is een tekst hier.
  const PRESETS = [
    { id: "tiny", label: "tiny (de taal van de handleiding)", lang: "taalproto/tiny/tiny.spp",
      programs: ["taalproto/tiny/progs/queens.tiny", "taalproto/tiny/progs/primes.tiny", "taalproto/tiny/progs/higher.tiny"] },
    { id: "calc", label: "calc (rekenmachine)", lang: "taalproto/calc/calc.spp",
      programs: [{ name: "voorbeeld.calc", text: "// operatoren, unaire min, let\nlet x = 3 * 4 in x - (2 - 1) * -x\n" },
                 { name: "macht.calc", text: "2 ^ 3 ^ 2 + -2 ^ 2\n" }] },
    { id: "while", label: "while (imperatief)", lang: "taalproto/while/while.spp",
      programs: ["taalproto/while/progs/fib.while", "taalproto/while/progs/ggd.while",
                 "taalproto/while/progs/priemen.while", "taalproto/while/progs/collatz.while"] },
    { id: "ml", label: "MiniML", lang: "taalproto/ml/ml.spp",
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
    return { name, source: withoutStart(langSrc) + `\n\nstart = runLang ${name} (readFile "/${PROGRAM_PATH}")\n` };
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

  // Een eenvoudige hash om een gecompileerde taal te herkennen.
  function hashText(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  const api = { PROGRAM_PATH, PRESETS, langName, withoutStart, composeSource, parseRunOutput, hashText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TaalLab = api;
})(typeof window !== "undefined" ? window : globalThis);
