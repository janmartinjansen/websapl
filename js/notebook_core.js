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
 * Uitvoeren: alle cellen worden één Sapl+-programma (generateProgram), met
 * lib/notebook_glue.cfp als uitvoerlaag. Elke keer het hele notebook: er is
 * nog geen incrementele herberekening (plan 3.4).
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
        cur = { kind: /\[markdown\]/.test(m[1]) ? "markdown" : "code", lines: [] };
      } else {
        cur.lines.push(line);
      }
    }
    cells.push(cur);
    return cells.map((c) => ({
      kind: c.kind,
      source: trimBlankEdges(c.kind === "markdown" ? c.lines.map(unComment) : c.lines).join("\n"),
    }));
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
      out.push(c.kind === "markdown" ? "//%% [markdown]" : "//%%");
      const lines = c.source.split("\n");
      if (c.kind === "markdown") out.push(...lines.map((l) => (l === "" ? "//" : "// " + l)));
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
  function generateProgram(cells) {
    const body = [...HEADER, ""];
    const exprCells = [];
    const errors = {};
    cells.forEach((c, i) => {
      if (c.kind !== "code") return;
      const cls = classifyCell(c.source);
      if (cls.error) { errors[i] = cls.error; return; }
      if (cls.kind === "def") body.push(c.source, "");
      else if (cls.kind === "expr") {
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

  const api = { parseNotebook, serializeNotebook, classifyCell, generateProgram, parseOutput };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SaplNotebook = api;
})(typeof window !== "undefined" ? window : globalThis);
