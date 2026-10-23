/**
 * notebook_core.js -- de logica van de Sapl-notebook, los van de pagina
 * (26 september 2026). Ontwerp: docs/2026-09-25_notebook_en_bibliotheken_plan.md,
 * deel 3. Gebruikt door notebook.html; ook in Node te laden voor tests.
 *
 * Bestandsformaat: een gewoon .spp-bestand met celmarkeringen in
 * commentaar (jupytext "percent"):
 *
 *   //%% [markdown]
 *   // # Titel
 *   //%%
 *   import "lib/list.spp" as L
 *   //%%
 *   L.sum (L.range 1 10)
 *
 * Een codecel is OF een blok definities OF precies één expressie:
 *   - definitie: een regel op kolom 0 die begint met `::`, `#`, `import `
 *     of `module `, of een `=` op het hoogste haakjesniveau (niet `==`,
 *     `<=`, `>=`, `!=`), behalve als de cel met `let` begint;
 *   - anders een expressie; die mag over meerdere regels lopen, zolang de
 *     vervolgregels ingesprongen zijn.
 *
 * Uitvoeren: de notebookmodus van de REPL in Sapl (`:nb`, generateNbInput
 * en parseNbOutput hieronder), met lib/notebook_glue.cfp als uitvoerlaag.
 * Tot 8 oktober 2026 werden de cellen één Sapl+-programma op een blijvend
 * beeld (generateProgram, ReplImage); zie
 * docs/2026-10-08_notebook_in_sapl_plan.md.
 *
 * Herberekenen per cel (plan 3.5 stap 4): `dependents` bepaalt, op naam,
 * welke cellen van een gewijzigde cel afhangen. Een run neemt altijd alle
 * definitiecellen mee, maar alleen de gekozen expressiecellen; de uitvoer
 * van de andere cellen blijft staan.
 *
 * Speciale celtypen, in het bestand als commentaar (zodat het een geldig
 * Sapl+-bestand blijft, net als [markdown]):
 *   //%% [type]  -- elke regel een expressie; toont haar type (in de
 *                   notebookmodus, getypeerd tegen de sessie);
 *   //%% [lc]    -- pure lambda-calculus via lc_repl/lc_repl.jmvm; alle
 *                   lc-cellen samen vormen één sessie (lcInput/parseLcOutput).
 */
(function (root) {
  const MARK_RE = /^\/\/%%(.*)$/;

  // Instellingen van het notebook (8 oktober 2026): een regel
  // `//%% [instellingen] volgorde=boven-naar-beneden`. Alleen wat afwijkt van
  // de standaard komt in het bestand ("in elke volgorde" is de standaard),
  // zodat bestaande notebooks niet veranderen.
  const SETTINGS_RE = /^\/\/%% \[instellingen\](.*)$/;

  /** { order: "any" | "top" } */
  function parseSettings(text) {
    const settings = { order: "any" };
    for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
      const m = line.match(SETTINGS_RE);
      if (m && /\bvolgorde=boven-naar-beneden\b/.test(m[1])) settings.order = "top";
    }
    return settings;
  }

  function parseNotebook(text) {
    const cells = [];
    let cur = { kind: "code", lines: [] };
    let sawMarker = false;
    for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
      if (SETTINGS_RE.test(line)) continue;
      const m = line.match(MARK_RE);
      if (m) {
        if (sawMarker || cur.lines.some((l) => l.trim() !== "")) cells.push(cur);
        sawMarker = true;
        cur = { kind: markerKind(m[1]), lines: [] };
      } else {
        cur.lines.push(line);
      }
    }
    cells.push(cur);
    return cells.map((c) => ({
      kind: c.kind,
      source: trimBlankEdges(COMMENTED.includes(c.kind) ? c.lines.map(unComment) : c.lines).join("\n"),
    }));
  }

  // Celsoorten die in het bestand als commentaar staan.
  const COMMENTED = ["markdown", "lc", "type"];

  function markerKind(rest) {
    const m = rest.match(/\[(markdown|lc|type)\]/);
    return m ? m[1] : "code";
  }

  function unComment(line) {
    if (line.startsWith("// ")) return line.slice(3);
    if (line.startsWith("//")) return line.slice(2);
    return line;
  }

  function trimBlankEdges(lines) {
    let a = 0, b = lines.length;
    while (a < b && lines[a].trim() === "") a++;
    while (b > a && lines[b - 1].trim() === "") b--;
    return lines.slice(a, b);
  }

  function serializeNotebook(cells, settings) {
    const out = [];
    if (settings && settings.order === "top") out.push("//%% [instellingen] volgorde=boven-naar-beneden");
    for (const c of cells) {
      out.push(c.kind === "code" ? "//%%" : `//%% [${c.kind}]`);
      const lines = c.source.split("\n");
      if (COMMENTED.includes(c.kind)) out.push(...lines.map((l) => (l === "" ? "//" : "// " + l)));
      else out.push(...lines);
    }
    return out.join("\n") + "\n";
  }

  // Code zonder commentaarregels; `//` binnen een regel laten we staan (de
  // preprocessor haalt dat zelf weg, en het kan in een string staan).
  function codeLines(source) {
    return source.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("//"));
  }

  function hasTopLevelEquals(text) {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        i++;
        while (i < text.length && text[i] !== '"') { if (text[i] === "\\") i++; i++; }
      } else if (c === "'") {
        i++;
        while (i < text.length && text[i] !== "'") i++;
      } else if (c === "/" && text[i + 1] === "/") {
        while (i < text.length && text[i] !== "\n") i++;
      } else if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === "=" && depth === 0) {
        const prev = text[i - 1], next = text[i + 1];
        if (!"=<>!".includes(prev) && next !== "=" && next !== ">") return true;
      }
    }
    return false;
  }

  /** { kind: "empty" | "def" | "expr", error?: string } */
  function classifyCell(source) {
    const lines = codeLines(source);
    if (lines.length === 0) return { kind: "empty" };
    const col0 = lines.filter((l) => !/^\s/.test(l));
    if (col0.some((l) => /^(::|#|import |module )/.test(l))) return checkDef(col0);
    const text = lines.join("\n");
    if (!/^let\b/.test(lines[0].trim()) && hasTopLevelEquals(text)) return checkDef(col0);
    if (/^\s/.test(lines[0])) return { kind: "expr", error: "Een expressie moet op kolom 0 beginnen." };
    if (col0.length > 1) {
      return { kind: "expr", error: "Eén expressie per cel (vervolgregels inspringen), of alleen definities." };
    }
    return { kind: "expr" };
  }

  function checkDef(col0) {
    if (col0.some((l) => /^start\b/.test(l))) {
      return { kind: "def", error: "`start` is gereserveerd: de notebook maakt die zelf." };
    }
    return { kind: "def" };
  }

  const NO_MESSAGE = "De cel stopte zonder melding.";

  const VM_TRAILER_RE = /^(res: |Elapsed time|nr gc|instr executed|calls: |creates: )/;

  /**
   * Leest de uitvoer van een run: per celnummer n
   *   { blocks: [{ kind, content }], ended: bool, error?: string }
   * kind is value/text/markdown/table/graphics, of "print" voor uitvoer die
   * de cel zelf met print/printString schreef. Een cel zonder @@end is
   * gestopt; wat er nog aan tekst stond (de melding van `error`) komt in
   * `error`.
   */
  function parseOutput(raw) {
    const lines = raw.split("\n");
    const startIdx = lines.findIndex((l) => l.startsWith("execution started"));
    const body = startIdx === -1 ? lines : lines.slice(startIdx + 1);
    const result = {};
    let cur = null;
    let block = null;
    let loose = [];
    for (const line of body) {
      const begin = line.match(/^@@begin (\d+)$/);
      const end = line.match(/^@@end (\d+)$/);
      const kind = line.match(/^@@(value|text|markdown|table|graphics|form|interactive)$/);
      if (begin) {
        cur = { blocks: [], ended: false };
        result[+begin[1]] = cur;
        block = null;
      } else if (end && cur) {
        cur.ended = true;
        cur = null;
        block = null;
      } else if (kind && cur) {
        block = { kind: kind[1], lines: [] };
        cur.blocks.push(block);
      } else if (cur) {
        if (!block) { block = { kind: "print", lines: [] }; cur.blocks.push(block); }
        block.lines.push(line);
      } else if (line !== "" && !VM_TRAILER_RE.test(line) && line !== "stop") {
        loose.push(line);
      }
    }
    for (const n of Object.keys(result)) {
      const r = result[n];
      for (const b of r.blocks) {
        while (b.lines.length && b.lines[b.lines.length - 1] === "") b.lines.pop();
        b.content = b.lines.join("\n");
        delete b.lines;
      }
      if (!r.ended) {
        // De laatste regels bevatten de foutmelding, met de VM-afsluiting
        // (`stop`, statistieken) erachter geplakt.
        const text = r.blocks.map((b) => b.content).join("\n")
          .split("\n").filter((l) => !VM_TRAILER_RE.test(l)).join("\n")
          .replace(/stop\s*$/, "").trim();
        r.error = text || NO_MESSAGE;
        r.blocks = [];
      }
    }
    return { cells: result, loose: loose.join("\n") };
  }

  /** Namen die een definitiecel op kolom 0 definieert (functies, operators). */
  function definedNames(source) {
    const names = [];
    for (const l of codeLines(source)) {
      if (/^\s/.test(l) || /^(::|#|import |module )/.test(l)) continue;
      const m = l.match(/^\(([^)\s]+)\)/) || l.match(/^([A-Za-z_][A-Za-z0-9_']*)/);
      if (m && !names.includes(m[1])) names.push(m[1]);
    }
    return names;
  }

  /**
   * Namen van definities zonder argumenten met `=` (niet `=:`) waarvan de
   * body meer is dan een kaal getal, string of teken: die rekent elk gebruik
   * opnieuw uit. Het notebook toont daarvoor een korte hint naar `=:` (CAF,
   * gedeeld; docs/sapl_programmeer_regels.md §15). Alleen de eerste regel
   * van een definitie telt; een vervolgregel begint met een spatie.
   */
  function cafHintNames(source) {
    const names = [];
    for (const l of codeLines(source)) {
      if (/^\s/.test(l) || /^(::|#|import |module )/.test(l)) continue;
      const m = l.match(/^([a-z_][A-Za-z0-9_']*)\s*=(?![=:])(.*)$/);
      if (!m || m[1] === "start") continue;
      if (/^\s*(-?\d+(\.\d+)?|"[^"]*"|'.'|True|False)?\s*$/.test(m[2])) continue;
      // Een constructor met alleen letterlijke waarden (`golf = Golf 1.0 3
      // True`, zoals een formulier ze schrijft): ook niets uit te rekenen.
      if (isLiteralCon(m[2].replace(/\s*\/\/.*$/, ""))) continue;
      if (!names.includes(m[1])) names.push(m[1]);
    }
    return names;
  }

  const LITERAL_RE = /^(-?\d+(\.\d+)?|\((0|0\.0) - \d+(\.\d+)?\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])'|True|False)$/;

  function isLiteralCon(rhs) {
    const parts = splitArgs(rhs.trim());
    return parts.length > 1 && /^[A-Z]/.test(parts[0]) && parts.slice(1).every((p) => LITERAL_RE.test(p));
  }

  // == Afhankelijkheden ======================================================

  const KEYWORDS = new Set(["let", "in", "case", "if", "then", "else", "import", "as", "module", "nomatch", "try", "throw", "otherwise"]);

  function stripLiterals(text) {
    return text.replace(/"(?:\\.|[^"\\])*"/g, " ").replace(/'(?:\\.|[^'\\])'/g, " ").replace(/\/\/.*$/gm, " ");
  }

  /** Namen die een cel gebruikt; `L.map` telt als gebruik van `L`. */
  function referencedNames(source) {
    const refs = new Set();
    for (const m of stripLiterals(source).matchAll(/[A-Za-z_][A-Za-z0-9_']*/g)) {
      if (!KEYWORDS.has(m[0])) refs.add(m[0]);
    }
    return refs;
  }

  /**
   * Wat een definitiecel aanbiedt: functies en operators, constructors uit
   * `::`-regels, en import-aliassen. Een haak `render_X`/`show_X` telt als
   * aanbod van `X`: wie een X toont, hangt van die haak af. `global`: de cel
   * heeft een `#import` (tekstueel, onbekend wat erin zit): alles hangt ervan af.
   */
  function providedNames(source) {
    const names = new Set(definedNames(source));
    let global = false;
    for (const l of codeLines(source)) {
      if (/^#import\b/.test(l)) global = true;
      const imp = l.match(/^import\s+"[^"]*"\s+as\s+([A-Z][A-Za-z0-9_]*)/);
      if (imp) names.add(imp[1]);
      const rec = l.match(/^::\s*([A-Z][A-Za-z0-9_]*)\s*=\s*\{([^}]*)\}?/);
      if (rec) {
        // Een record: de constructor (de typenaam) en per veld een getter en
        // een setter (preprocess/records.cfp).
        names.add(rec[1]);
        for (const f of rec[2].split(",")) {
          const m = f.trim().match(/^!?\s*([a-z_][A-Za-z0-9_']*)/);
          if (m) { names.add(m[1]); names.add("set" + m[1][0].toUpperCase() + m[1].slice(1)); }
        }
      } else if (/^::/.test(l)) {
        const rhs = l.split("=").slice(1).join("=");
        for (const alt of rhs.split("|")) {
          const c = alt.trim().match(/^([A-Z][A-Za-z0-9_]*)/);
          if (c) names.add(c[1]);
        }
      }
    }
    for (const n of [...names]) {
      const h = n.match(/^(?:render|show)_(.+)$/);
      if (h) names.add(h[1]);
    }
    return { names, global };
  }

  /**
   * Alle cellen die (via definities, transitief) van cel `start` afhangen,
   * inclusief `start` zelf. Alleen code- en type-cellen; lc-cellen vormen
   * hun eigen sessie (zie lcInput).
   */
  function dependents(cells, start) {
    const result = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const d = queue.shift();
      const c = cells[d];
      if (!c || c.kind !== "code" || classifyCell(c.source).kind !== "def") continue;
      const { names, global } = providedNames(c.source);
      cells.forEach((other, i) => {
        if (result.has(i) || (other.kind !== "code" && other.kind !== "type")) return;
        const refs = referencedNames(other.source);
        if (global || [...names].some((n) => refs.has(n))) { result.add(i); queue.push(i); }
      });
    }
    return result;
  }

  // == lc-cellen ============================================================

  /** Alle regels van alle lc-cellen, in volgorde: één lc_repl-sessie. */
  function lcInput(cells) {
    const lines = [];
    cells.forEach((c, i) => {
      if (c.kind !== "lc") return;
      for (const l of c.source.split("\n")) {
        if (l.trim() !== "" && !l.trim().startsWith("--")) lines.push({ cell: i, text: l.trim() });
      }
    });
    return { lines, stdin: lines.map((l) => l.text).concat(["quit"]).join("\n") + "\n" };
  }

  /**
   * lc_repl schrijft vóór elke invoerregel "lc> ". De k-de prompt hoort bij
   * regel k; stopt lc_repl op een fout (Sapl's `error` stopt de VM), dan
   * hebben de regels daarna geen prompt meer.
   * { cellIndex: [{ line, output } | { line, error } | { line, notRun }] }
   */
  function parseLcOutput(raw, lines) {
    const startIdx = raw.indexOf("execution started");
    let body = startIdx === -1 ? raw : raw.slice(raw.indexOf("\n", startIdx) + 1);
    const chunks = body.split("lc> ");
    const out = {};
    let stopped = false;
    lines.forEach((l, k) => {
      let entry;
      const chunk = chunks[k + 1];
      if (stopped || chunk === undefined) entry = { line: l.text, notRun: true };
      else {
        const isLast = k + 1 === chunks.length - 1;
        let text = chunk.replace(/\n?(res: .*|Elapsed time.*|nr gc.*|instr executed.*|calls: .*|creates: .*)$/gm, "").replace(/stop\s*$/, "").trimEnd();
        if (isLast) { stopped = true; entry = { line: l.text, error: text || "lc_repl stopte op deze regel" }; }
        else entry = { line: l.text, output: text };
      }
      (out[l.cell] = out[l.cell] || []).push(entry);
    });
    return out;
  }

  // == De notebookmodus van de REPL in Sapl (8 oktober 2026) ===============
  // docs/2026-10-08_notebook_in_sapl_plan.md: de cellen gaan als één
  // bestand naar `:nb pad` (repl_sapl/mini_repl.spp), dat zelf bepaalt wat
  // er opnieuw gecompileerd moet worden. Alle definitiecellen gaan mee, de
  // expressie- en type-cellen alleen als ze in `only` staan (of alles zonder
  // `only`).
  // mode: "any" (in elke volgorde, één letrec) of "top" (van boven naar
  // beneden). Resultaat: { input, exprCells: [{ cell, n }], errors }; errors:
  // cellen die classifyCell afwijst.
  function generateNbInput(cells, only, mode) {
    const out = [`@@mode ${mode === "top" ? "top" : "any"}`];
    // Het definitiepaneel: de REPL stuurt alleen de regels van opnieuw
    // gecompileerde cellen (`@@defsame <cel>` voor de rest). Heeft een
    // definitiecel nog geen paneel (eerste run op deze pagina), dan alles.
    if (cells.some((c) => c.kind === "code" && classifyCell(c.source).kind === "def" && !(c.output && c.output.defs))) out.push("@@defsall");
    const exprCells = [];
    const errors = {};
    cells.forEach((c, i) => {
      // Een type-cel: elke regel een expressie, getypeerd tegen de sessie.
      if (c.kind === "type" && (!only || only.has(i))) out.push(`@@type ${i}`, c.source);
      if (c.kind !== "code") return;
      const cls = classifyCell(c.source);
      if (cls.error) { errors[i] = cls.error; return; }
      if (cls.kind === "def") out.push(`@@def ${i}`, c.source);
      else if (cls.kind === "expr" && (!only || only.has(i))) {
        const n = exprCells.length + 1;
        exprCells.push({ cell: i, n });
        out.push(`@@expr ${i} ${n}`, c.source);
      }
    });
    return { input: out.join("\n") + "\n", exprCells, errors };
  }

  /**
   * De uitvoer van `:nb`: de cellen zoals parseOutput, plus
   * defErrors { cellIndex: melding } (een definitiecel met een fout, of die
   * afhangt van zo'n cel; cel -1 is de uitvoerlaag zelf), error (een fout
   * buiten de cellen), types { cellIndex: [{ expr, type } | { expr, error }] }
   * (de type-cellen), typeWarnings { cellIndex: [melding] } (typefouten in
   * definitiecellen; de code draait wel), defs { cellIndex: [{ name, type }] }
   * (wat een definitiecel definieert, met het type als dat er is; sinds 10
   * oktober 2026), defsSame [cellIndex] (cellen die niet opnieuw
   * gecompileerd zijn: houd hun vorige defs) en done (de regel @@nbdone kwam).
   */
  function parseNbOutput(raw) {
    const defErrors = {};
    const types = {};
    const typeWarnings = {};
    const defs = {};
    const defsSame = [];
    const stale = [];
    const general = [];
    const rest = [];
    let done = false;
    for (const line of raw.split("\n")) {
      const d = line.match(/^@@deferror (-?\d+) (.*)$/);
      const e = line.match(/^@@error (.*)$/);
      const tok = line.match(/^@@typeok (\d+) (.*) :: (.*)$/);
      const terr = line.match(/^@@typeerr (\d+) (.*?) @@ (.*)$/);
      const tw = line.match(/^@@typewarn (-?\d+) (.*)$/);
      const df = line.match(/^@@def (-?\d+) (\S+)(?: :: (.*))?$/);
      const ds = line.match(/^@@defsame (-?\d+)$/);
      const st = line.match(/^@@stale (\S+)$/);
      if (st) stale.push(st[1]);
      else if (df) (defs[+df[1]] = defs[+df[1]] || []).push({ name: df[2], type: df[3] || "" });
      else if (ds) defsSame.push(+ds[1]);
      else if (tw) (typeWarnings[+tw[1]] = typeWarnings[+tw[1]] || []).push(tw[2]);
      else if (tok) (types[+tok[1]] = types[+tok[1]] || []).push({ expr: tok[2], type: tok[3] });
      else if (terr) (types[+terr[1]] = types[+terr[1]] || []).push({ expr: terr[2], error: terr[3] });
      else if (d) defErrors[+d[1]] = defErrors[+d[1]] ? defErrors[+d[1]] + "\n" + d[2] : d[2];
      else if (e) general.push(e[1]);
      else if (line === "@@nbdone") done = true;
      else rest.push(line);
    }
    const parsed = parseOutput(rest.join("\n"));
    if (defErrors[-1]) general.unshift("uitvoerlaag: " + defErrors[-1]);
    return { cells: parsed.cells, loose: parsed.loose, defErrors, types, typeWarnings, defs, defsSame, stale, error: general.join("\n"), done };
  }

  // == Formulieren (fase C van docs/2026-10-15_notebook_integraal_plan.md) ==
  // Een expressiecel `D.form x` / `D.slider lo hi x` / `D.choice opties x`
  // toont een formulier (@@form, lib/display.spp). Een wijziging schrijft de
  // pagina terug in de definitie `x = ...` (brontekst), en draait die cel
  // opnieuw met wat ervan afhangt.

  function unescapeField(s) {
    return s.replace(/\\(\\|t|n)/g, (_, c) => (c === "t" ? "\t" : c === "n" ? "\n" : "\\"));
  }

  /** Het @@form-blok als object; null als het niet te lezen is. */
  function parseForm(content) {
    const rows = content.split("\n").filter((l) => l !== "").map((l) => l.split("\t").map(unescapeField));
    if (!rows.length) return null;
    const [head, ...rest] = rows;
    const fields = rest.filter((r) => r[0] === "field").map((r) => ({ name: r[1], type: r[2], value: r[3], opts: optList(r[4]) }));
    if (head[0] === "record") return { kind: "record", con: head[1], fields };
    if (head[0] === "sum") {
      // Een somtype: per constructor (`alt`) de velden met naam, soort,
      // opties en een standaardwaarde (Sapl-tekst, "" als er geen is).
      const alts = rest.filter((r) => r[0] === "alt").map((r) => {
        const fs = [];
        for (let i = 2; i + 2 < r.length; i += 4) fs.push({ name: r[i], type: r[i + 1], opts: optList(r[i + 2]), dflt: r[i + 3] || "" });
        return { con: r[1], fields: fs };
      });
      return { kind: "sum", con: head[1], type: head[2], alts, fields };
    }
    if (head[0] === "value") return { kind: "value", type: head[1], value: head[2] };
    if (head[0] === "slider") return { kind: "slider", type: head[1], value: head[2], lo: head[3], hi: head[4] };
    if (head[0] === "choice") return { kind: "choice", type: "str", value: head[1], options: head.slice(2) };
    return null;
  }

  function optList(s) { return s ? s.split(" ").filter((x) => x) : []; }

  // == Somtypen (23 oktober 2026) ==========================================
  // Een andere constructor kiezen: de nieuwe waarde als Sapl-tekst. Een veld
  // met dezelfde naam en soort als in de huidige constructor houdt zijn
  // waarde (de tekst uit de definitie); de rest krijgt de standaardwaarde.
  // null als een veld geen van beide heeft (een typevariabele, een lijst).
  function switchLiteral(form, altCon, oldArgs) {
    const alt = form.alts.find((a) => a.con === altCon);
    if (!alt) return null;
    const args = [];
    for (const f of alt.fields) {
      const k = form.fields.findIndex((g) => g.name === f.name && g.type === f.type);
      let lit = null;
      if (k >= 0 && oldArgs && oldArgs[k] !== undefined) lit = oldArgs[k];
      else if (k >= 0 && f.type !== "other") lit = saplLiteral(f.type, form.fields[k].value);
      if (lit === null || lit === "") lit = f.dflt || (f.type === "con" && f.opts.length ? f.opts[0] : null);
      if (lit === null || lit === "") return null;
      args.push(lit);
    }
    return [alt.con, ...args].join(" ");
  }

  /** Kan een interactieve cel naar constructor `altCon` (Sh.input in de sessie
   * houdt velden met dezelfde naam en soort, de rest krijgt een standaardwaarde)? */
  function canSwitch(form, altCon) {
    const alt = form.alts.find((a) => a.con === altCon);
    return !!alt && alt.fields.every((f) => form.fields.some((g) => g.name === f.name && g.type === f.type) || f.dflt || (f.type === "con" && f.opts.length));
  }

  /** De argumenten van `name = Con a b c` in de brontekst (zonder Con), of null. */
  function definitionArgs(source, name) {
    const lines = source.split("\n");
    const re = defLineRe(name);
    const k = lines.findIndex((l) => re.test(l));
    if (k < 0) return null;
    let end = k + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end]) && !/^\s*\/\//.test(lines[end])) end++;
    const m = lines[k].match(re);
    let inner = [m[2], ...lines.slice(k + 1, end).map((l) => l.trim())].join(" ").replace(/\s*\/\/.*$/, "").trim();
    while (/^\(.*\)$/.test(inner) && splitArgs(inner).length === 1 && balancedOuter(inner)) inner = inner.slice(1, -1).trim();
    const parts = splitArgs(inner);
    return parts.length && /^[A-Z]/.test(parts[0]) ? parts.slice(1) : null;
  }

  // == Interactieve cellen (fase E, 23 oktober 2026) ======================
  // `D.interactive model update view` (lib/display.spp): de cel begint met een
  // blok @@interactive met "<sleutel> <ms>", daarna de weergave van view. Een
  // gebeurtenis gaat als `:nbmsg <sleutel> <gebeurtenis>` naar de sessie;
  // het antwoord is weer zo'n cel (of `@@stale <sleutel>`).

  /** Het @@interactive-blok: { tok, ms }; null als het niet te lezen is. */
  function parseInteractive(content) {
    const m = String(content).trim().match(/^(\d+_\d+) (\d+)$/);
    return m ? { tok: m[1], ms: +m[2] } : null;
  }

  function escapeField(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n");
  }

  /** Een gebeurtenis als regel: soort en velden gescheiden door een tab
   * (lib/notebook_glue.cfp, nbEvent): click x y, key naam, tick ms, input veld waarde. */
  function eventLine(kind, ...fields) {
    return [kind, ...fields].map(escapeField).join("\t");
  }

  /** De naam die een formuliercel bewerkt: het laatste argument, als dat een kale naam is. */
  function formBinding(source) {
    const text = codeLines(source).join(" ").trim();
    const m = text.match(/^D\.(form|slider|choice)\b.*?\s([a-z_][A-Za-z0-9_']*)$/);
    return m ? m[2] : null;
  }

  // De regel `naam = ...` (of `naam =: ...`) op kolom 0, met de vervolgregels.
  function defLineRe(name) {
    return new RegExp("^" + name.replace(/'/g, "\\'") + "\\s*(=:|=)(?![=>])\\s*(.*)$");
  }

  /** De definitiecel van `name` (een definitie zonder argumenten): { cell } of null. */
  function findDefinition(cells, name) {
    const re = defLineRe(name);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.kind !== "code" || classifyCell(c.source).kind !== "def") continue;
      if (c.source.split("\n").some((l) => re.test(l))) return { cell: i };
    }
    return null;
  }

  /** Een waarde uit een invoerveld als Sapl-tekst; null als ze niet past. */
  function saplLiteral(type, raw) {
    const t = String(raw).trim();
    if (type === "int") {
      if (!/^-?\d+$/.test(t)) return null;
      const n = parseInt(t, 10);
      return n < 0 ? `(0 - ${-n})` : String(n);
    }
    if (type === "float") {
      if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
      const x = parseFloat(t);
      let a = String(Math.abs(x));
      if (/e/i.test(a)) a = Math.abs(x).toFixed(12).replace(/0+$/, "").replace(/\.$/, ".0");
      if (!a.includes(".")) a += ".0";
      return x < 0 ? `(0.0 - ${a})` : a;
    }
    if (type === "bool") return raw === true || t === "True" ? "True" : "False";
    if (type === "char") return t.length === 1 ? (t === "'" || t === "\\" ? `'\\${t}'` : `'${t}'`) : null;
    if (type === "con") return /^[A-Z][A-Za-z0-9_']*$/.test(t) ? t : null;
    if (type === "str") return '"' + String(raw).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
    return null;
  }

  // De argumenten op het hoogste niveau van `Con a (b c) "d e" [1, 2]`.
  function splitArgs(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (i >= text.length) break;
      const start = i;
      let depth = 0;
      while (i < text.length && (depth > 0 || !/\s/.test(text[i]))) {
        const c = text[i];
        if (c === '"' || c === "'") {
          i++;
          while (i < text.length && text[i] !== c) { if (text[i] === "\\") i++; i++; }
        } else if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        i++;
      }
      out.push(text.slice(start, i));
    }
    return out;
  }

  /**
   * Zet in `source` de definitie van `name` op `literal` (field null) of
   * vervangt alleen argument `field` van de constructor (`x = Con a b c`).
   * Geeft { source } of { error }.
   */
  function rewriteDefinition(source, name, field, literal) {
    const lines = source.split("\n");
    const re = defLineRe(name);
    const k = lines.findIndex((l) => re.test(l));
    if (k < 0) return { error: `geen definitie ${name} = ... gevonden` };
    let end = k + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end]) && !/^\s*\/\//.test(lines[end])) end++;
    const m = lines[k].match(re);
    const head = lines[k].slice(0, lines[k].length - m[2].length);
    let rhs = [m[2], ...lines.slice(k + 1, end).map((l) => l.trim())].join(" ").replace(/\s*\/\/.*$/, "").trim();
    if (field === null || field === undefined) rhs = literal;
    else {
      let inner = rhs;
      while (/^\(.*\)$/.test(inner) && splitArgs(inner).length === 1 && balancedOuter(inner)) inner = inner.slice(1, -1).trim();
      const parts = splitArgs(inner);
      if (parts.length < 2 || !/^[A-Z]/.test(parts[0]) || field + 1 >= parts.length) {
        return { error: `${name} is geen constructor met argumenten (${rhs}); schrijf ${name} = Constructor veld1 veld2 ...` };
      }
      parts[field + 1] = literal;
      rhs = parts.join(" ");
    }
    lines.splice(k, end - k, head + rhs);
    return { source: lines.join("\n") };
  }

  // `(a) (b)` begint en eindigt met haakjes, maar die horen niet bij elkaar.
  function balancedOuter(text) {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"' || c === "'") { i++; while (i < text.length && text[i] !== c) { if (text[i] === "\\") i++; i++; } continue; }
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0 && i < text.length - 1) return false; }
    }
    return true;
  }

  const api = {
    generateNbInput, parseNbOutput, parseSettings, NO_MESSAGE,
    parseNotebook, serializeNotebook, classifyCell, parseOutput, definedNames, cafHintNames,
    referencedNames, providedNames, dependents, lcInput, parseLcOutput,
    parseForm, formBinding, findDefinition, saplLiteral, splitArgs, rewriteDefinition,
    parseInteractive, eventLine, switchLiteral, definitionArgs, canSwitch,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SaplNotebook = api;
})(typeof window !== "undefined" ? window : globalThis);
