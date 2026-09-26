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
 * Uitvoeren: de cellen worden één Sapl+-programma (generateProgram), met
 * lib/notebook_glue.cfp als uitvoerlaag.
 *
 * Herberekenen per cel (plan 3.5 stap 4): `dependents` bepaalt, op naam,
 * welke cellen van een gewijzigde cel afhangen. Een run neemt altijd alle
 * definitiecellen mee, maar alleen de gekozen expressiecellen; de uitvoer
 * van de andere cellen blijft staan.
 *
 * Speciale celtypen, in het bestand als commentaar (zodat het een geldig
 * Sapl+-bestand blijft, net als [markdown]):
 *   //%% [type]  -- elke regel een expressie; toont haar type
 *                   (generateTypeProgram, via de typechecker);
 *   //%% [lc]    -- pure lambda-calculus via lc_repl/lc_repl.jmvm; alle
 *                   lc-cellen samen vormen één sessie (lcInput/parseLcOutput).
 */
(function (root) {
  const MARK_RE = /^\/\/%%(.*)$/;

  function parseNotebook(text) {
    const cells = [];
    let cur = { kind: "code", lines: [] };
    let sawMarker = false;
    for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
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

  function serializeNotebook(cells) {
    const out = [];
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

  const HEADER = [
    "#import \"repl/stddyn.cfp\"",
    "#import \"lib/notebook_glue.cfp\"",
    "import \"lib/display.spp\" as D",
    "import \"grafisch/graphics.cfp\" as G",
  ];

  /**
   * Eén Sapl+-programma uit de cellen. Resultaat:
   *   { source, exprCells: [{ cell, n }], errors: { cellIndex: tekst } }
   * Cellen met een fout (classifyCell) gaan niet mee.
   */
  // `only` (optioneel): een Set celindexen; dan komen alleen die
  // expressiecellen in het programma (definitiecellen altijd allemaal).
  function generateProgram(cells, only) {
    const body = [...HEADER, ""];
    const exprCells = [];
    const errors = {};
    cells.forEach((c, i) => {
      if (c.kind !== "code") return;
      const cls = classifyCell(c.source);
      if (cls.error) { errors[i] = cls.error; return; }
      if (cls.kind === "def") body.push(c.source, "");
      else if (cls.kind === "expr" && (!only || only.has(i))) {
        const n = exprCells.length + 1;
        exprCells.push({ cell: i, n });
        body.push(`__cell${n} = ${c.source}`, "");
      }
    });
    const calls = exprCells.map((e) => `nbCell ${e.n} __cell${e.n}`);
    body.push(`start = ${[...calls, "0"].join(" <#> ")}`);
    return { source: body.join("\n") + "\n", exprCells, errors };
  }

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
      const kind = line.match(/^@@(value|text|markdown|table|graphics)$/);
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
        r.error = text || "De cel stopte zonder melding.";
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
   * Koppelt de typechecker-uitvoer (regels `naam: FOUT: melding`) aan
   * cellen: `__cellN` aan expressiecel N, een gedefinieerde naam aan zijn
   * definitiecel. Fouten in bibliotheken (stdlib, stddyn, modules) worden
   * genegeerd. Resultaat: { cellIndex: [melding, ...] }.
   */
  function cellErrorsFromTypecheck(report, cells, gen) {
    const owner = {};
    for (const e of gen.exprCells) owner[`__cell${e.n}`] = e.cell;
    cells.forEach((c, i) => {
      if (c.kind === "code" && classifyCell(c.source).kind === "def") {
        for (const n of definedNames(c.source)) owner[n] = i;
      }
    });
    const out = {};
    for (const line of String(report || "").split("\n")) {
      const m = line.match(/^(\S+): FOUT: (.*)$/);
      if (!m || owner[m[1]] === undefined) continue;
      let msg = m[2];
      if (msg.startsWith(m[1] + ": ")) msg = msg.slice(m[1].length + 2);
      const shown = m[1].startsWith("__cell") ? msg : `${m[1]}: ${msg}`;
      (out[owner[m[1]]] = out[owner[m[1]]] || []).push(shown);
    }
    return out;
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
      if (/^::/.test(l)) {
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

  // == type-cellen ==========================================================

  /**
   * Programma voor de typechecker: de kop, alle definitiecellen, en per
   * regel van een type-cel `__typeK = <expressie>`.
   * { source, typeLines: [{ cell, expr, name }] }
   */
  function generateTypeProgram(cells, only) {
    const body = [...HEADER, ""];
    const typeLines = [];
    cells.forEach((c, i) => {
      if (c.kind === "code" && classifyCell(c.source).kind === "def" && !classifyCell(c.source).error) body.push(c.source, "");
      if (c.kind === "type" && (!only || only.has(i))) {
        for (const expr of codeLines(c.source)) {
          const name = `__type${typeLines.length + 1}`;
          typeLines.push({ cell: i, expr: expr.trim(), name });
          body.push(`${name} = ${expr.trim()}`, "");
        }
      }
    });
    body.push("start = 0");
    return { source: body.join("\n") + "\n", typeLines };
  }

  /** { cellIndex: [{ expr, type } | { expr, error }] } uit het typecheckrapport. */
  function parseTypeReport(report, typeLines) {
    const byName = {};
    for (const line of String(report || "").split("\n")) {
      const ok = line.match(/^(__type\d+) :: (.*)$/);
      const bad = line.match(/^(__type\d+): FOUT: (?:__type\d+: )?(.*)$/);
      if (ok) byName[ok[1]] = { type: ok[2] };
      else if (bad) byName[bad[1]] = { error: bad[2] };
    }
    const out = {};
    for (const t of typeLines) {
      const r = byName[t.name] || { error: "geen type gevonden (voorbewerken mislukt?)" };
      (out[t.cell] = out[t.cell] || []).push({ expr: t.expr, ...r });
    }
    return out;
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

  const api = {
    parseNotebook, serializeNotebook, classifyCell, generateProgram, parseOutput, definedNames, cellErrorsFromTypecheck,
    referencedNames, providedNames, dependents, generateTypeProgram, parseTypeReport, lcInput, parseLcOutput,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SaplNotebook = api;
})(typeof window !== "undefined" ? window : globalThis);
