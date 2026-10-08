/**
 * WebSapl Dedicated Web Worker
 * Runs the JMVM WebAssembly runtime, the self-hosted Sapl compiler (saplcomp.jmvm),
 * and the Stage-4 Retag compiler (retagcomp.jmvm) completely client-side in the browser.
 */

let jmvmModule = null;
let isInitialized = false;
let isExecuting = false;

let stdlibContent = "";
let saplcompBytecode = null;
let retagcompBytecode = null;
let driverBytecode = null;
let lamliftBytecode = null;
// Hindley-Milner type-inferentie voor Sapl+ (typing/README.md), een
// losstaande tool -- géén desugar/codegen-stap, dus géén #import-
// afhankelijkheden van zichzelf nodig zoals driverBytecode hierboven
// (preprocess/typecheck.cfp's eigen #imports zijn al bij het bouwen van
// typecheck.jmvm ingebakken). Het GECHECKTE bestand kan uiteraard zelf wel
// `#import "lib/stdlib.cfp"` gebruiken -- vandaar dat typecheckSource()
// hieronder toch /lib/stdlib.cfp mount, dezelfde stdlibContent-string als
// preprocessSpp hierboven.
let typecheckBytecode = null;
// Modulegewijs compileren (docs/2026-09-13_modules_compileren_en_linken_
// gebruik.md, workbench's "modules"-backend): saplcomp_module.jmvm
// compileert één module tegen de defs/typedefs van zijn afhankelijkheden,
// retaglink.jmvm linkt+snoeit meerdere modules' retag-tekst samen vanaf
// een entry-functie. Zie buildModules() verderop in dit bestand.
let saplcompModuleBytecode = null;
let retaglinkBytecode = null;
// #import dependencies driver.jmvm's own expandImports (preprocess/
// importexpand.cfp) needs on disk to preprocess the bundled Sapl+ examples
// (websapl/benchmarks_saplplus/, websapl/parser_combinators/):
// VFS-absolute path -> file text, fetched once at init. Keyed by the SAME
// repo-root-relative path a `#import "..."` line
// names verbatim (expandImports calls `readFile` on that string directly,
// no /workspace/-prefixing -- unlike this worker's own resolveImports(),
// a separate, .cfp-specific JS reimplementation used for the "Compileer"
// button, see below).
let sppDeps = {};

function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function ensureDirFor(vfsPath) {
  const dir = vfsPath.slice(0, vfsPath.lastIndexOf("/"));
  if (!dir) return;
  const parts = dir.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur += "/" + part;
    if (!jmvmModule.FS.analyzePath(cur).exists) jmvmModule.FS.mkdir(cur);
  }
}

/**
 * Preprocess #import recursively using VFS and strip || comments for saplcomp
 */
async function resolveImports(source, currentFile = "/workspace/main.cfp", seen = new Set()) {
  if (seen.has(currentFile)) return "";
  seen.add(currentFile);

  const lines = source.split("\n");
  const outputLines = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("||")) continue;

    // Strip trailing || comments outside string literals
    let inStr = false;
    let cleanLine = "";
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"' && (i === 0 || line[i - 1] !== "\\")) {
        inStr = !inStr;
      }
      if (!inStr && line[i] === "|" && i + 1 < line.length && line[i + 1] === "|") {
        break;
      }
      cleanLine += line[i];
    }
    line = cleanLine;

    const match = line.trim().match(/^#import\s+"([^"]+)"/);
    if (match) {
      const importPath = match[1];
      let resolvedPath = importPath;
      if (!resolvedPath.startsWith("/")) {
        if (resolvedPath.startsWith("lib/")) {
          resolvedPath = "/" + resolvedPath;
        } else {
          resolvedPath = "/workspace/" + resolvedPath;
        }
      }

      let importedContent = "";
      try {
        if (jmvmModule && jmvmModule.FS.analyzePath(resolvedPath).exists) {
          importedContent = jmvmModule.FS.readFile(resolvedPath, { encoding: "utf8" });
        } else if (importPath === "lib/stdlib.cfp" || importPath === "/lib/stdlib.cfp") {
          importedContent = stdlibContent;
        } else if (importPath.includes("graphics.cfp")) {
          if (jmvmModule && jmvmModule.FS.analyzePath("/grafisch/graphics.cfp").exists) {
            importedContent = jmvmModule.FS.readFile("/grafisch/graphics.cfp", { encoding: "utf8" });
          }
        } else {
          // Nog niet in de VFS: een project-eigen bestand (bv. een ander
          // voorbeeld in dezelfde map) dat nooit apart geopend/gemount is.
          // Eenmalig ophalen zoals app.js's getFileContentForPath() ook
          // doet, en in de VFS cachen zodat een herhaalde #import (of een
          // tweede compilatie) niet opnieuw hoeft te fetchen.
          const fetchPath = importPath.startsWith("/") ? importPath.slice(1) : importPath;
          const res = await fetch("../" + fetchPath);
          if (res.ok) {
            importedContent = await res.text();
            if (jmvmModule) {
              ensureDirFor(resolvedPath);
              jmvmModule.FS.writeFile(resolvedPath, importedContent);
            }
          } else {
            throw new Error(`Imported file not found: ${importPath}`);
          }
        }
      } catch (err) {
        throw new Error(`Failed to resolve import "${importPath}": ${err.message}`);
      }

      const inlined = await resolveImports(importedContent, resolvedPath, seen);
      outputLines.push(inlined);
    } else {
      outputLines.push(line);
    }
  }

  return outputLines.join("\n") + "\n";
}

/**
 * Initialize the JMVM Module and VFS
 */
async function initEngine(data = {}) {
  if (isInitialized && jmvmModule) {
    postMessage({ type: "INIT_DONE" });
    return;
  }

  if (typeof importScripts === "function") {
    importScripts("./jmvm.js?v=" + Date.now());
  }

  stdlibContent = data.stdlib || "";
  if (!stdlibContent) {
    try {
      const res = await fetch("../lib/stdlib.cfp?v=" + Date.now());
      if (res.ok) stdlibContent = await res.text();
    } catch (_) {}
  }

  if (data.saplcompBase64) {
    saplcompBytecode = base64ToUint8Array(data.saplcompBase64);
  } else {
    try {
      const res = await fetch("./saplcomp.jmvm?v=" + Date.now());
      if (res.ok) {
        const buf = await res.arrayBuffer();
        saplcompBytecode = new Uint8Array(buf);
      }
    } catch (_) {}
  }

  if (data.retagcompBase64) {
    retagcompBytecode = base64ToUint8Array(data.retagcompBase64);
  } else {
    try {
      const res = await fetch("./retagcomp.jmvm?v=" + Date.now());
      if (res.ok) {
        const buf = await res.arrayBuffer();
        retagcompBytecode = new Uint8Array(buf);
      }
    } catch (_) {}
  }

  if (data.driverBase64) {
    driverBytecode = base64ToUint8Array(data.driverBase64);
  } else {
    try {
      const res = await fetch("./driver.jmvm?v=" + Date.now());
      if (res.ok) {
        const buf = await res.arrayBuffer();
        driverBytecode = new Uint8Array(buf);
      }
    } catch (_) {}
  }

  if (data.lamliftBase64) {
    lamliftBytecode = base64ToUint8Array(data.lamliftBase64);
  } else {
    try {
      const res = await fetch("./lamlift.jmvm?v=" + Date.now());
      if (res.ok) {
        const buf = await res.arrayBuffer();
        lamliftBytecode = new Uint8Array(buf);
      }
    } catch (_) {}
  }

  if (data.typecheckBase64) {
    typecheckBytecode = base64ToUint8Array(data.typecheckBase64);
  } else {
    try {
      const res = await fetch("./typecheck.jmvm?v=" + Date.now());
      if (res.ok) {
        const buf = await res.arrayBuffer();
        typecheckBytecode = new Uint8Array(buf);
      }
    } catch (_) {}
  }

  if (data.saplcompModuleBase64) {
    saplcompModuleBytecode = base64ToUint8Array(data.saplcompModuleBase64);
  } else {
    try {
      const res = await fetch("./saplcomp_module.jmvm?v=" + Date.now());
      if (res.ok) {
        const buf = await res.arrayBuffer();
        saplcompModuleBytecode = new Uint8Array(buf);
      }
    } catch (_) {}
  }

  if (data.retaglinkBase64) {
    retaglinkBytecode = base64ToUint8Array(data.retaglinkBase64);
  } else {
    try {
      const res = await fetch("./retaglink.jmvm?v=" + Date.now());
      if (res.ok) {
        const buf = await res.arrayBuffer();
        retaglinkBytecode = new Uint8Array(buf);
      }
    } catch (_) {}
  }

  // Sapl+ (.spp) #import dependencies -- see the sppDeps declaration above
  // for why these exact repo-root-relative VFS paths matter.
  const sppDepFiles = [
    { url: "../sapl_compiler/newparser_ast.cfp", vfsPath: "/sapl_compiler/newparser_ast.cfp" },
    { url: "../sapl_compiler/lexer2.cfp", vfsPath: "/sapl_compiler/lexer2.cfp" },
    { url: "../sapl_compiler/ast_helpers.cfp", vfsPath: "/sapl_compiler/ast_helpers.cfp" },
    { url: "../sapl_compiler/stage_dump.cfp", vfsPath: "/sapl_compiler/stage_dump.cfp" },
    // stage_dump.cfp #import't sinds 13 sep 2026 ook stage5_codegen.cfp
    // (escapeStr/primInstr/genFuncMetas voor de defs-/typedefs-uitvoer).
    { url: "../sapl_compiler/stage5_codegen.cfp", vfsPath: "/sapl_compiler/stage5_codegen.cfp" },
    { url: "../parser_combinators/parsecomb.spp", vfsPath: "/parser_combinators/parsecomb.spp" },
    { url: "../parser_combinators/saplParse.spp", vfsPath: "/parser_combinators/saplParse.spp" },
    { url: "../benchmarks_saplplus/prologlib.spp", vfsPath: "/benchmarks_saplplus/prologlib.spp" },
    { url: "../repl/stddyn.cfp", vfsPath: "/repl/stddyn.cfp" }
  ];
  for (const dep of sppDepFiles) {
    try {
      const res = await fetch(dep.url + "?v=" + Date.now());
      if (res.ok) sppDeps[dep.vfsPath] = await res.text();
    } catch (_) {}
  }

  jmvmModule = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm?v=" + Date.now() : (prefix || "") + p)
  });

  // Setup directory structure
  const dirs = ["/workspace", "/lib", "/grafisch", "/benchmarks", "/examples", "/paper_examples", "/tmp"];
  for (const d of dirs) {
    try {
      if (!jmvmModule.FS.analyzePath(d).exists) jmvmModule.FS.mkdir(d);
    } catch (_) {}
  }

  // Write stdlib into /lib/stdlib.cfp
  if (stdlibContent) {
    jmvmModule.FS.writeFile("/lib/stdlib.cfp", stdlibContent);
  }

  // Pre-load graphics.cfp into VFS
  try {
    const gRes = await fetch("../grafisch/graphics.cfp");
    if (gRes.ok) {
      const gContent = await gRes.text();
      jmvmModule.FS.writeFile("/grafisch/graphics.cfp", gContent);
      jmvmModule.FS.writeFile("/graphics.cfp", gContent);
    }
  } catch (_) {}

  // Write compiler into /saplcomp.jmvm
  if (saplcompBytecode) {
    jmvmModule.FS.writeFile("/saplcomp.jmvm", saplcompBytecode);
  }
  if (retagcompBytecode) {
    jmvmModule.FS.writeFile("/retagcomp.jmvm", retagcompBytecode);
  }

  await warmUpEngine();

  isInitialized = true;
  postMessage({ type: "INIT_DONE" });
}

/**
 * Opwarmrun (29 september 2026). V8 (Chrome, Edge) kan een wasm-functie die
 * al draait niet halverwege omzetten naar geoptimaliseerde code. De
 * interpreterlus van de engine blijft daardoor de hele eerste run op de
 * basiscompiler (Liftoff) staan: de eerste zware run van een sessie was ~2x
 * trager dan alle latere (primes 1,13 s tegen 0,57 s, een compilatie van gen1
 * 1,57 s tegen 0,90 s). Een piepkleine run hier start de optimalisatie
 * alvast; die loopt op de achtergrond (~50 ms nodig) terwijl de gebruiker nog
 * typt, en elke latere instantie van dezelfde jmvm.wasm krijgt de
 * geoptimaliseerde code. Kost ~5 ms. In Safari (JavaScriptCore) is er geen
 * verschil tussen koud en warm, daar doet dit niets. Gemeten met
 * websapl/wasm_test/opwarm/; zie wasm_compiler/README.md §8.
 */
const WARMUP_JMVM = `start_lazy start nfib_lazy nfib nfib_then #
            call 1
            print 4
            stop
0           jmp 1
1           push 18
            tailcall 0 3
2           load 0
            eval
            store 0
3           ifltlv 0 2 4
            loadadd 0 -1
            call 3
            loadadd 0 -2
            call 3
            add
            inc
            return 1
4           return_const 1 1
`;

async function warmUpEngine() {
  try {
    const inst = await createJMVMModule({
      noInitialRun: true,
      locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
      stdin: () => null,
      stdout: () => {},
      stderr: () => {}
    });
    inst.FS.writeFile("/tmp/warmup.jmvm", WARMUP_JMVM);
    try { inst.callMain(["/tmp/warmup.jmvm"]); } catch (_) {}
  } catch (_) {
    // Opwarmen is alleen een versnelling; een fout hier mag het laden niet breken.
  }
}

/**
 * Run compiler instance for a specific stage
 */
async function runCompilerStage(flattenedSource, stageFlag, outPath) {
  let compilerOutput = [];
  let stdinBuffer = `/tmp/in.cfp\n${outPath}\n${stageFlag}\n`.split("");
  let stdinIndex = 0;

  const instance = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
    stdin: () => {
      if (stdinIndex < stdinBuffer.length) {
        return stdinBuffer[stdinIndex++].charCodeAt(0);
      }
      return null;
    },
    stdout: (charCode) => {
      compilerOutput.push(String.fromCharCode(charCode));
    },
    stderr: (charCode) => {
      compilerOutput.push(String.fromCharCode(charCode));
    }
  });

  // Mount files
  instance.FS.writeFile("/saplcomp.jmvm", saplcompBytecode);
  instance.FS.writeFile("/tmp/in.cfp", flattenedSource);

  // Ensure output dir exists
  const parts = outPath.split("/");
  parts.pop();
  const dir = parts.join("/") || "/tmp";
  try {
    if (!instance.FS.analyzePath(dir).exists) instance.FS.mkdir(dir);
  } catch (_) {}

  try {
    instance.callMain(["/saplcomp.jmvm"]);
  } catch (e) {
    // normal VM exit throws in Emscripten
  }

  const outExists = instance.FS.analyzePath(outPath).exists;
  let content = "";
  if (outExists) {
    content = instance.FS.readFile(outPath, { encoding: "utf8" });
    try {
      if (!jmvmModule.FS.analyzePath(dir).exists) jmvmModule.FS.mkdir(dir);
    } catch (_) {}
    jmvmModule.FS.writeFile(outPath, content);
  }

  return {
    success: outExists,
    content: content,
    output: compilerOutput.join("")
  };
}

/**
 * Compile Sapl Source across requested stages
 */
async function compileSapl(source, srcPath, stages, strictness) {
  if (!isInitialized) throw new Error("JMVM engine is not initialized.");

  const startTime = performance.now();
  let flattenedSource = "";
  try {
    flattenedSource = await resolveImports(source, srcPath);
  } catch (err) {
    return {
      success: false,
      error: `Import resolution failed: ${err.message}`,
      files: []
    };
  }

  const baseName = srcPath.split("/").pop().replace(/(\.cfp|\.cfp_retag|\.jmvm)$/, "");
  const outDir = "/tmp";
  const generatedFiles = [];
  let combinedStdout = "";
  let combinedStderr = "";
  let allSuccess = true;

  for (const stage of stages) {
    let outFileName;
    if (stage === "jmvm") {
      outFileName = `${baseName}.jmvm`;
    } else {
      outFileName = `${baseName}.cfp_${stage}`;
    }
    const targetPath = `${outDir}/${outFileName}`;

    let stageFlag = stage;
    if (!strictness) {
      if (stage === "jmvm") stageFlag = "jmvm_nostrict";
      else if (["bool", "lazytag", "lift", "retag"].includes(stage)) stageFlag = `${stage}_nostrict`;
    }

    const res = await runCompilerStage(flattenedSource, stageFlag, targetPath);
    combinedStdout += `[Stage: ${stage}]\n${res.output}\n`;

    if (res.success) {
      generatedFiles.push({
        stage: stage,
        name: outFileName,
        path: targetPath,
        content: res.content,
        size: res.content.length
      });
    } else {
      allSuccess = false;
      combinedStderr += `[Stage: ${stage} Failed]\n${res.output}\n`;
    }
  }

  const durationMs = Math.round(performance.now() - startTime);

  return {
    success: allSuccess,
    files: generatedFiles,
    durationMs: durationMs,
    stdout: combinedStdout,
    stderr: combinedStderr
  };
}

/**
 * Compile Stage-4 Retag source code directly to .jmvm bytecode using retagcomp.jmvm
 */
async function compileRetag(source, srcPath) {
  if (!isInitialized) throw new Error("JMVM engine is not initialized.");

  const startTime = performance.now();
  const baseName = srcPath.split("/").pop().replace(/(\.cfp_retag|\.cfp_decompiled|\.cfp)$/, "");
  const outPath = `/tmp/${baseName}.jmvm`;

  let compilerOutput = [];
  let stdinBuffer = `/tmp/in_retag.cfp\n${outPath}\n`.split("");
  let stdinIndex = 0;

  const instance = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
    stdin: () => {
      if (stdinIndex < stdinBuffer.length) {
        return stdinBuffer[stdinIndex++].charCodeAt(0);
      }
      return null;
    },
    stdout: (charCode) => {
      compilerOutput.push(String.fromCharCode(charCode));
    },
    stderr: (charCode) => {
      compilerOutput.push(String.fromCharCode(charCode));
    }
  });

  instance.FS.writeFile("/retagcomp.jmvm", retagcompBytecode);
  instance.FS.writeFile("/tmp/in_retag.cfp", source);

  try {
    instance.callMain(["/retagcomp.jmvm"]);
  } catch (e) {
    // normal exit throws
  }

  const durationMs = Math.round(performance.now() - startTime);
  const outExists = instance.FS.analyzePath(outPath).exists;
  let content = "";

  if (outExists) {
    content = instance.FS.readFile(outPath, { encoding: "utf8" });
    jmvmModule.FS.writeFile(outPath, content);
  }

  return {
    success: outExists,
    files: outExists ? [{
      stage: "jmvm",
      name: `${baseName}.jmvm`,
      path: outPath,
      content: content,
      size: content.length
    }] : [],
    durationMs: durationMs,
    stdout: compilerOutput.join(""),
    stderr: outExists ? "" : "Retag compilation failed"
  };
}

/**
 * Preprocess a Sapl+ (.spp) source into plain Sapl (.cfp) text, using
 * preprocess/driver.jmvm -- itself an ordinary compiled .jmvm program (the
 * preprocessor is self-hosted, written in Sapl, see preprocess/PLAN.md
 * section 1), so it runs on the exact same WASM VM as saplcomp.jmvm/
 * retagcomp.jmvm above, just with a different bytecode file mounted.
 * Same fresh-instance-per-call pattern as runCompilerStage/compileRetag
 * (each createJMVMModule() call gets its own independent virtual
 * filesystem, so every dependency has to be re-mounted here).
 */
/**
 * Verzamelt (recursief) elk bestand achter een `#import "pad"` of een
 * Sapl+-module-import `import "pad" as Naam` (preprocess/modules.cfp) dat
 * niet al in de vaste sppDeps-lijst staat, zodat driver.jmvm het in zijn
 * verse instantie kan `readFile`-en. Tot 26 september 2026 vond een .spp in
 * WebSapl alleen die vaste lijst. Bronnen, in volgorde: de eigen VFS van
 * deze worker (op "/pad" of "/workspace/pad", waar geopende en eerder
 * opgehaalde bestanden staan), anders één keer ophalen van de server (zoals
 * resolveImports hierboven). Resultaat: VFS-pad ("/pad") -> tekst.
 */
// Notebook: gecompileerde programma's per bron (NOTEBOOK_RUN), en de
// lc_repl-bytecode voor lc-cellen (LC_RUN).
const notebookCache = new Map();
let lcReplBytecode = null;
// Vooraf gecompileerde bibliotheekdelen van notebookprogramma's, per sleutel
// (zie notebookLibUnit).
const notebookLibCache = new Map();

const SPP_IMPORT_RE = /^(?:#import|import(?:\s+extern)?)\s+"([^"]+)"/;

async function collectSppImports(source, found = {}) {
  for (const line of source.split("\n")) {
    const m = line.match(SPP_IMPORT_RE);
    if (!m) continue;
    const rel = m[1].startsWith("/") ? m[1].slice(1) : m[1];
    const vfsPath = "/" + rel;
    if (vfsPath === "/lib/stdlib.cfp" || sppDeps[vfsPath] !== undefined || found[vfsPath] !== undefined) continue;
    let content = null;
    for (const cand of [vfsPath, "/workspace/" + rel]) {
      if (jmvmModule && jmvmModule.FS.analyzePath(cand).exists) {
        content = jmvmModule.FS.readFile(cand, { encoding: "utf8" });
        break;
      }
    }
    if (content === null) {
      try {
        const res = await fetch("../" + rel);
        if (res.ok) {
          content = await res.text();
          if (jmvmModule) {
            ensureDirFor(vfsPath);
            jmvmModule.FS.writeFile(vfsPath, content);
          }
        }
      } catch (_) {}
    }
    // Niet gevonden: niets mounten; de preprocessor meldt dan zelf
    // "import: bestand niet gevonden of leeg: <pad>".
    if (content === null) continue;
    found[vfsPath] = content;
    await collectSppImports(content, found);
  }
  return found;
}

/**
 * Databestanden voor een notebook: elke string-literal in de bron die op
 * een datapad lijkt ("notebooks/data/fruit.csv", ook via C.read "..."), uit
 * de eigen VFS of van de server, op hetzelfde pad (relatief aan "/") in de
 * run-instantie. Zonder dit ziet readFile in de notebook niets.
 */
const DATA_PATH_RE = /"([^"\n]+\.(?:csv|tsv|txt|dat|json))"/g;

async function collectDataFiles(source) {
  const files = {};
  for (const m of source.matchAll(DATA_PATH_RE)) {
    const rel = m[1].startsWith("/") ? m[1].slice(1) : m[1];
    const vfsPath = "/" + rel;
    if (files[vfsPath] !== undefined) continue;
    let content = null;
    for (const cand of [vfsPath, "/workspace/" + rel]) {
      if (jmvmModule && jmvmModule.FS.analyzePath(cand).exists) {
        content = jmvmModule.FS.readFile(cand);
        break;
      }
    }
    if (content === null) {
      try {
        const res = await fetch("../" + rel);
        if (res.ok) content = new Uint8Array(await res.arrayBuffer());
      } catch (_) {}
    }
    if (content !== null) files[vfsPath] = content;
  }
  return files;
}

function mkdirsFor(fs, filePath) {
  const parts = filePath.split("/").filter(Boolean);
  parts.pop();
  let cur = "";
  for (const p of parts) {
    cur += "/" + p;
    try {
      if (!fs.analyzePath(cur).exists) fs.mkdir(cur);
    } catch (_) {}
  }
}

// `tag`: unit-tag voor verse namen (preprocess/genstate.cfp); alleen de
// REPL-turn geeft er een mee.
async function preprocessSpp(source, srcPath, tag = "") {
  if (!isInitialized) throw new Error("JMVM engine is not initialized.");
  if (!driverBytecode) throw new Error("Sapl+ preprocessor (driver.jmvm) kon niet geladen worden.");

  const startTime = performance.now();
  const baseName = srcPath.split("/").pop().replace(/\.spp$/, "");
  const outPath = `/tmp/${baseName}.cfp`;

  let compilerOutput = [];
  let stdinBuffer = `/tmp/in.spp\n${outPath}\n${tag}\n`.split("");
  let stdinIndex = 0;

  const instance = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
    stdin: () => {
      if (stdinIndex < stdinBuffer.length) {
        return stdinBuffer[stdinIndex++].charCodeAt(0);
      }
      return null;
    },
    stdout: (charCode) => {
      compilerOutput.push(String.fromCharCode(charCode));
    },
    stderr: (charCode) => {
      compilerOutput.push(String.fromCharCode(charCode));
    }
  });

  instance.FS.writeFile("/driver.jmvm", driverBytecode);

  // Mount every #import dependency at the SAME repo-root-relative path
  // driver.jmvm's own expandImports (preprocess/importexpand.cfp) will
  // `readFile` verbatim -- see the sppDeps declaration up top.
  const depDirs = ["/lib", "/sapl_compiler", "/parser_combinators", "/benchmarks_saplplus", "/repl"];
  for (const d of depDirs) {
    try {
      if (!instance.FS.analyzePath(d).exists) instance.FS.mkdir(d);
    } catch (_) {}
  }
  instance.FS.writeFile("/lib/stdlib.cfp", stdlibContent);
  for (const [path, content] of Object.entries(sppDeps)) {
    instance.FS.writeFile(path, content);
  }
  const extraDeps = await collectSppImports(source);
  for (const [path, content] of Object.entries(extraDeps)) {
    mkdirsFor(instance.FS, path);
    instance.FS.writeFile(path, content);
  }

  instance.FS.writeFile("/tmp/in.spp", source);

  try {
    instance.callMain(["/driver.jmvm"]);
  } catch (e) {
    // normal VM exit throws in Emscripten
  }

  const durationMs = Math.round(performance.now() - startTime);
  const outExists = instance.FS.analyzePath(outPath).exists;
  let content = "";

  if (outExists) {
    content = instance.FS.readFile(outPath, { encoding: "utf8" });
    jmvmModule.FS.writeFile(outPath, content);
  }

  return {
    success: outExists,
    files: outExists ? [{
      stage: "cfp",
      name: `${baseName}.cfp`,
      path: outPath,
      content: content,
      size: content.length
    }] : [],
    durationMs: durationMs,
    stdout: compilerOutput.join(""),
    stderr: outExists ? "" : "Preprocessing (.spp -> .cfp) mislukt -- zie uitvoer hierboven."
  };
}

/**
 * Preprocess a .lfp source (Sapl + kale, onbeperkte lambda's) into plain
 * Sapl (.cfp) text, using lamlift/lamlift.jmvm -- same self-hosted-Sapl-
 * program pattern as preprocessSpp above, just a different bytecode file.
 * Unlike driver.jmvm, lamlift.cfp's own preprocessFile does no runtime
 * #import expansion on its input (its own #import "lib/stdlib.cfp" was
 * already resolved at COMPILE time, when lamlift.cfp was built into
 * lamlift.jmvm) -- so no dependency-mounting step is needed here, just the
 * input file itself.
 */
async function preprocessLfp(source, srcPath) {
  if (!isInitialized) throw new Error("JMVM engine is not initialized.");
  if (!lamliftBytecode) throw new Error(".lfp preprocessor (lamlift.jmvm) kon niet geladen worden.");

  const startTime = performance.now();
  const baseName = srcPath.split("/").pop().replace(/\.lfp$/, "");
  const outPath = `/tmp/${baseName}.cfp`;

  let compilerOutput = [];
  let stdinBuffer = `/tmp/in.lfp\n${outPath}\n`.split("");
  let stdinIndex = 0;

  const instance = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
    stdin: () => {
      if (stdinIndex < stdinBuffer.length) {
        return stdinBuffer[stdinIndex++].charCodeAt(0);
      }
      return null;
    },
    stdout: (charCode) => {
      compilerOutput.push(String.fromCharCode(charCode));
    },
    stderr: (charCode) => {
      compilerOutput.push(String.fromCharCode(charCode));
    }
  });

  instance.FS.writeFile("/lamlift.jmvm", lamliftBytecode);
  instance.FS.writeFile("/tmp/in.lfp", source);

  try {
    instance.callMain(["/lamlift.jmvm"]);
  } catch (e) {
    // normal VM exit throws in Emscripten
  }

  const durationMs = Math.round(performance.now() - startTime);
  const outExists = instance.FS.analyzePath(outPath).exists;
  let content = "";

  if (outExists) {
    content = instance.FS.readFile(outPath, { encoding: "utf8" });
    jmvmModule.FS.writeFile(outPath, content);
  }

  return {
    success: outExists,
    files: outExists ? [{
      stage: "cfp",
      name: `${baseName}.cfp`,
      path: outPath,
      content: content,
      size: content.length
    }] : [],
    durationMs: durationMs,
    stdout: compilerOutput.join(""),
    stderr: outExists ? "" : "Lambda-lifting (.lfp -> .cfp) mislukt -- zie uitvoer hierboven."
  };
}

/**
 * Hindley-Milner type-inferentie voor Sapl+ (preprocess/typecheck.jmvm,
 * zie typing/README.md) tegen één bronbestand -- géén desugar/codegen,
 * dus géén outputbestand: de uitvoer is puur het tekstuele rapport
 * ("naam :: type" per topniveaufunctie, of "naam: FOUT: ..."). Zelfde
 * fresh-instance/stdin-feed/stdout-capture patroon als preprocessSpp/
 * preprocessLfp hierboven, maar zonder hun eigen #import-afhankelijkheden
 * (typecheck.cfp's eigen #imports zijn al bij het bouwen van typecheck.jmvm
 * ingebakken) -- alleen /lib/stdlib.cfp plus dezelfde vaste depDirs/sppDeps
 * als preprocessSpp worden gemount, voor het geval het GECHECKTE bestand
 * zelf #import-regels heeft.
 */
async function typecheckSource(source, srcPath) {
  if (!isInitialized) throw new Error("JMVM engine is not initialized.");
  if (!typecheckBytecode) throw new Error("Typechecker (typecheck.jmvm) kon niet geladen worden.");

  const startTime = performance.now();

  let compilerOutput = [];
  let stdinBuffer = `/tmp/in.cfp\n`.split("");
  let stdinIndex = 0;

  const instance = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
    stdin: () => {
      if (stdinIndex < stdinBuffer.length) {
        return stdinBuffer[stdinIndex++].charCodeAt(0);
      }
      return null;
    },
    stdout: (charCode) => {
      compilerOutput.push(String.fromCharCode(charCode));
    },
    stderr: (charCode) => {
      compilerOutput.push(String.fromCharCode(charCode));
    }
  });

  instance.FS.writeFile("/typecheck.jmvm", typecheckBytecode);

  const depDirs = ["/lib", "/sapl_compiler", "/parser_combinators", "/benchmarks_saplplus", "/repl"];
  for (const d of depDirs) {
    try {
      if (!instance.FS.analyzePath(d).exists) instance.FS.mkdir(d);
    } catch (_) {}
  }
  instance.FS.writeFile("/lib/stdlib.cfp", stdlibContent);
  for (const [depPath, content] of Object.entries(sppDeps)) {
    instance.FS.writeFile(depPath, content);
  }
  // Zelfde aanvulling als in preprocessSpp: modules achter `import "..."`.
  const extraDeps = await collectSppImports(source);
  for (const [depPath, content] of Object.entries(extraDeps)) {
    mkdirsFor(instance.FS, depPath);
    instance.FS.writeFile(depPath, content);
  }

  instance.FS.writeFile("/tmp/in.cfp", source);

  try {
    instance.callMain(["/typecheck.jmvm"]);
  } catch (e) {
    // normal VM exit throws in Emscripten
  }

  const durationMs = Math.round(performance.now() - startTime);
  const rawOutput = compilerOutput.join("");

  // Strip the JMVM runner's own startup/shutdown banner ("VM starting
  // for...", "execution started, progsize=N", trailing "res: N"/"stop"/
  // "Elapsed time:"/etc.) -- printed for every .jmvm run regardless of
  // program, never part of the actual report. Same approach as
  // workbench/server.js's extractJmvmReport.
  const startMarker = rawOutput.match(/execution started, progsize=\d+\r?\n?/);
  let report = startMarker ? rawOutput.slice(startMarker.index + startMarker[0].length) : rawOutput;
  const endMarker = report.match(/\n(?:res: |stop\r?\n)/);
  if (endMarker) report = report.slice(0, endMarker.index);
  report = report.replace(/^\n+/, "").replace(/\n+$/, "");

  return {
    success: true,
    report: report,
    stdout: rawOutput,
    durationMs: durationMs
  };
}

/**
 * Modulegewijs compileren (docs/2026-09-13_modules_compileren_en_linken_
 * gebruik.md #"Bouwvolgorde automatiseren"): een JS-poort van
 * sapl_compiler/tools/build_modules.py's orkestratie -- leest een
 * expliciet manifest, sorteert topologisch, en roept per module in de
 * juiste volgorde saplcomp.jmvm (--emit=defs/typedefs, via de al
 * bestaande runCompilerStage hierboven -- een module heeft zelf geen
 * #import-regels, dus resolveImports() overslaan is hier veilig/nodig)
 * en saplcomp_module.jmvm (--emit=retag tegen de afhankelijkheden' defs/
 * typedefs) aan, gevolgd door retaglink.jmvm (linken+snoeien vanaf de
 * entry-functie) en retagcomp.jmvm (naar echte bytecode).
 *
 * BEWUST GEEN staleness/make-achtige overslaan-als-ongewijzigd zoals de
 * CLI-versie (mtime-vergelijking tegen een bestaand .retag.txt) -- er is
 * hier geen persistente "laatst gebouwde versie op schijf" tussen
 * paginaherladingen, en elke module opnieuw bouwen is in WASM goedkoop
 * genoeg voor de kleine, samenhorende module-mapjes waar dit spoor voor
 * bedoeld is (zelfde schaal-aanname als suggest_manifest.py hieronder in
 * de UI-laag). `moduleSources` (path -> broncode) komt van de hoofdthread
 * mee -- de worker heeft geen eigen bestandssysteem met de gebruiker se
 * bestanden, alleen de gedeelde `jmvmModule.FS` voor compiler-artefacten.
 */
function parseManifestText(text) {
  const deps = {};
  const lines = text.split("\n");
  for (const raw of lines) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) throw new Error(`ongeldige manifestregel (geen ':' gevonden): ${raw}`);
    const mod = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trim();
    deps[mod] = rest ? rest.split(/\s+/) : [];
  }
  return deps;
}

function topoOrderModules(deps, entry) {
  const order = [];
  const visiting = new Set();
  const visited = new Set();
  function visit(mod, stack) {
    if (visited.has(mod)) return;
    if (visiting.has(mod)) {
      throw new Error(`circulaire afhankelijkheid: ${stack.concat([mod]).join(" -> ")}`);
    }
    if (!(mod in deps)) {
      throw new Error(`'${mod}' wordt als afhankelijkheid genoemd maar staat niet in het manifest`);
    }
    visiting.add(mod);
    for (const dep of deps[mod]) visit(dep, stack.concat([mod]));
    visiting.delete(mod);
    visited.add(mod);
    order.push(mod);
  }
  visit(entry, []);
  return order;
}

/**
 * Eén module compileren tegen de defs/typedefs van zijn afhankelijkheden
 * (saplcomp_module.jmvm's 5-regelige stdin-protocol: bron, doel, stage,
 * defs-paden (spatie-gescheiden), typedefs-paden). Elke afhankelijkheid'
 * defs/typedefs-TEKST (al elders gegenereerd) wordt hier naar een eigen
 * tijdelijk VFS-pad geschreven, puur om aan het protocol te voldoen --
 * saplcomp_module.jmvm leest ze zelf weer in als gewone bestanden.
 */
async function runSaplcompModuleStage(moduleSource, stage, outPath, defsContents, typedefsContents, extraLine = null) {
  if (!saplcompModuleBytecode) throw new Error("saplcomp_module.jmvm kon niet geladen worden.");

  const defsPaths = defsContents.map((_, i) => `/tmp/deps/d${i}.defs.txt`);
  const typedefsPaths = typedefsContents.map((_, i) => `/tmp/deps/d${i}.typedefs.txt`);
  const stdinText = `/tmp/mod_in.cfp\n${outPath}\n${stage}\n${defsPaths.join(" ")}\n${typedefsPaths.join(" ")}\n` + (extraLine !== null ? extraLine + "\n" : "");
  let stdinBuffer = stdinText.split("");
  let stdinIndex = 0;
  let compilerOutput = [];

  const instance = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
    stdin: () => (stdinIndex < stdinBuffer.length ? stdinBuffer[stdinIndex++].charCodeAt(0) : null),
    stdout: (c) => compilerOutput.push(String.fromCharCode(c)),
    stderr: (c) => compilerOutput.push(String.fromCharCode(c))
  });

  instance.FS.writeFile("/saplcomp_module.jmvm", saplcompModuleBytecode);
  instance.FS.writeFile("/tmp/mod_in.cfp", moduleSource);
  try { if (!instance.FS.analyzePath("/tmp/deps").exists) instance.FS.mkdir("/tmp/deps"); } catch (_) {}
  defsContents.forEach((c, i) => instance.FS.writeFile(defsPaths[i], c));
  typedefsContents.forEach((c, i) => instance.FS.writeFile(typedefsPaths[i], c));

  const outParts = outPath.split("/");
  outParts.pop();
  const outDir = outParts.join("/") || "/tmp";
  try { if (!instance.FS.analyzePath(outDir).exists) instance.FS.mkdir(outDir); } catch (_) {}

  try {
    instance.callMain(["/saplcomp_module.jmvm"]);
  } catch (e) {
    // normal VM exit throws in Emscripten
  }

  const outExists = instance.FS.analyzePath(outPath).exists;
  const content = outExists ? instance.FS.readFile(outPath, { encoding: "utf8" }) : "";
  return { success: outExists, content, output: compilerOutput.join("") };
}

/**
 * Meerdere modules' retag-tekst linken+snoeien vanaf een entry-functie
 * (retaglink.jmvm's 3-regelige stdin-protocol: bestanden spatie-
 * gescheiden, doelbestand, entry-naam).
 */
async function runRetagLinkStage(retagContents, outPath, entryFunc) {
  if (!retaglinkBytecode) throw new Error("retaglink.jmvm kon niet geladen worden.");

  const retagPaths = retagContents.map((_, i) => `/tmp/retag/m${i}.retag.txt`);
  const stdinText = `${retagPaths.join(" ")}\n${outPath}\n${entryFunc || ""}\n`;
  let stdinBuffer = stdinText.split("");
  let stdinIndex = 0;
  let compilerOutput = [];

  const instance = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
    stdin: () => (stdinIndex < stdinBuffer.length ? stdinBuffer[stdinIndex++].charCodeAt(0) : null),
    stdout: (c) => compilerOutput.push(String.fromCharCode(c)),
    stderr: (c) => compilerOutput.push(String.fromCharCode(c))
  });

  instance.FS.writeFile("/retaglink.jmvm", retaglinkBytecode);
  try { if (!instance.FS.analyzePath("/tmp/retag").exists) instance.FS.mkdir("/tmp/retag"); } catch (_) {}
  retagContents.forEach((c, i) => instance.FS.writeFile(retagPaths[i], c));

  // Elke createJMVMModule()-aanroep krijgt zijn EIGEN, verse, lege VFS --
  // een map die een eerdere instantie (bv. runCompilerStage/
  // runSaplcompModuleStage hierboven, voor dezelfde outPath-boom) al
  // aanmaakte bestaat hier dus niet vanzelf. Zonder deze aanmaak faalde
  // `outPath` binnen een niet-standaard map (alles buiten kaal `/tmp`
  // zelf, bv. `/tmp/mods/...`) stilzwijgend: retaglink.jmvm meldde zelf
  // "success" op stdout, maar schreef feitelijk niets weg omdat de
  // doelmap ontbrak (gevonden tijdens het testen, zie
  // buildModules()'s eigen toelichting).
  const outParts = outPath.split("/");
  outParts.pop();
  const outDir = outParts.join("/") || "/tmp";
  try { if (!instance.FS.analyzePath(outDir).exists) instance.FS.mkdir(outDir); } catch (_) {}

  try {
    instance.callMain(["/retaglink.jmvm"]);
  } catch (e) {
    // normal VM exit throws in Emscripten
  }

  const outExists = instance.FS.analyzePath(outPath).exists;
  const content = outExists ? instance.FS.readFile(outPath, { encoding: "utf8" }) : "";
  return { success: outExists, content, output: compilerOutput.join("") };
}

/**
 * Gelinkte retag-tekst naar echte .jmvm-bytecode (retagcomp.jmvm's
 * 2-regelige stdin-protocol: bronbestand, doelbestand) -- zelfde
 * onderliggende programma als compileRetag() hierboven, maar met een
 * expliciete `outPath` (build_modules.py's derde CLI-argument) i.p.v.
 * een van `srcPath` afgeleide bestandsnaam.
 */
async function runRetagCompStage(retagText, outPath) {
  if (!retagcompBytecode) throw new Error("retagcomp.jmvm kon niet geladen worden.");

  const stdinText = `/tmp/linked.retag.txt\n${outPath}\n`;
  let stdinBuffer = stdinText.split("");
  let stdinIndex = 0;
  let compilerOutput = [];

  const instance = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
    stdin: () => (stdinIndex < stdinBuffer.length ? stdinBuffer[stdinIndex++].charCodeAt(0) : null),
    stdout: (c) => compilerOutput.push(String.fromCharCode(c)),
    stderr: (c) => compilerOutput.push(String.fromCharCode(c))
  });

  instance.FS.writeFile("/retagcomp.jmvm", retagcompBytecode);
  instance.FS.writeFile("/tmp/linked.retag.txt", retagText);

  // Zelfde reden als runRetagLinkStage hierboven: een verse VFS per
  // instantie, dus de doelmap van een niet-standaard `outPath` bestaat
  // hier niet vanzelf.
  const outParts = outPath.split("/");
  outParts.pop();
  const outDir = outParts.join("/") || "/tmp";
  try { if (!instance.FS.analyzePath(outDir).exists) instance.FS.mkdir(outDir); } catch (_) {}

  try {
    instance.callMain(["/retagcomp.jmvm"]);
  } catch (e) {
    // normal VM exit throws in Emscripten
  }

  const outExists = instance.FS.analyzePath(outPath).exists;
  const content = outExists ? instance.FS.readFile(outPath, { encoding: "utf8" }) : "";
  return { success: outExists, content, output: compilerOutput.join("") };
}

/**
 * Orkestreert de volledige modulegewijze build -- de kern van
 * build_modules.py, hierboven in JS herschreven (zie de toelichting bij
 * parseManifestText/topoOrderModules).
 */
async function buildModules(manifestText, entryModule, entryFunc, moduleSources, outPath) {
  if (!isInitialized) throw new Error("JMVM engine is not initialized.");

  const startTime = performance.now();
  const deps = parseManifestText(manifestText);
  if (!(entryModule in deps)) {
    throw new Error(`entry-module '${entryModule}' staat niet in het manifest`);
  }
  const order = topoOrderModules(deps, entryModule);

  const defsCache = {};
  const typedefsCache = {};
  const retagCache = {};
  let log = "";

  for (let i = 0; i < order.length; i++) {
    const mod = order[i];
    const src = moduleSources[mod];
    if (src === undefined) {
      throw new Error(`geen broncode gevonden voor module '${mod}' -- is dat bestand geopend (of aanwezig) in de bestandsboom?`);
    }
    log += `build_modules: bouw ${mod} ...\n`;

    const depMods = deps[mod];
    const defsContents = depMods.map((d) => defsCache[d]);
    const typedefsContents = depMods.map((d) => typedefsCache[d]);

    // De defs van een module MET afhankelijkheden tegen die afhankelijkheden
    // maken (saplcomp_module, stage defs): los bleef een kale verwijzing naar
    // een externe naam zonder argumenten (bv. een CAF uit een andere module)
    // een onbekende variabele ("findArgStrict: unknown variable"). Zelfde
    // fix als build_modules.py, 5 oktober 2026; test: tools/modules_test.js.
    const defsRes = depMods.length
      ? await runSaplcompModuleStage(src, "defs", `/tmp/mods/${i}.defs.txt`, defsContents, typedefsContents)
      : await runCompilerStage(src, "defs", `/tmp/mods/${i}.defs.txt`);
    if (!defsRes.success) throw new Error(`defs-extractie mislukt voor ${mod}:\n${defsRes.output}`);
    defsCache[mod] = defsRes.content;

    const typedefsRes = await runCompilerStage(src, "typedefs", `/tmp/mods/${i}.typedefs.txt`);
    if (!typedefsRes.success) throw new Error(`typedefs-extractie mislukt voor ${mod}:\n${typedefsRes.output}`);
    typedefsCache[mod] = typedefsRes.content;
    const retagRes = await runSaplcompModuleStage(src, "retag", `/tmp/mods/${i}.retag.txt`, defsContents, typedefsContents);
    log += retagRes.output;
    if (!retagRes.success) throw new Error(`retag-compilatie mislukt voor ${mod}:\n${retagRes.output}`);
    retagCache[mod] = retagRes.content;
  }

  log += `build_modules: linken (${order.length} module(s), entry-functie '${entryFunc}') ...\n`;
  const retagContents = order.map((m) => retagCache[m]);
  const linkRes = await runRetagLinkStage(retagContents, "/tmp/mods/_linked.retag.txt", entryFunc);
  log += linkRes.output;
  if (!linkRes.success) throw new Error(`linken mislukt:\n${linkRes.output}`);

  const compRes = await runRetagCompStage(linkRes.content, outPath);
  if (!compRes.success) throw new Error(`retagcomp mislukt:\n${compRes.output}`);
  log += `build_modules: klaar -- ${outPath}\n`;

  if (compRes.content) {
    try {
      const parts = outPath.split("/");
      parts.pop();
      const dir = parts.join("/") || "/tmp";
      if (!jmvmModule.FS.analyzePath(dir).exists) jmvmModule.FS.mkdir(dir);
      jmvmModule.FS.writeFile(outPath, compRes.content);
    } catch (_) {}
  }

  const durationMs = Math.round(performance.now() - startTime);
  return {
    success: true,
    files: [{
      stage: "jmvm",
      name: outPath.split("/").pop(),
      path: outPath,
      content: compRes.content,
      size: compRes.content.length
    }],
    durationMs: durationMs,
    stdout: log,
    stderr: ""
  };
}

/**
 * Execute a compiled .jmvm file on JMVM WASM
 */
async function executeJmvm(contentOrPath, isPath = false, customStdin = "", runId = null) {
  if (!isInitialized) throw new Error("JMVM engine is not initialized.");

  isExecuting = true;
  const targetPath = isPath ? contentOrPath : "/tmp/run.jmvm";

  let outText = "";
  let fullOutput = [];
  let stdinBuffer = (customStdin || "").split("");
  let stdinIndex = 0;

  const execInstance = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
    stdin: () => {
      if (stdinIndex < stdinBuffer.length) {
        return stdinBuffer[stdinIndex++].charCodeAt(0);
      }
      return null;
    },
    stdout: (charCode) => {
      const char = String.fromCharCode(charCode);
      outText += char;
      fullOutput.push(char);
      if (char === "\n") {
        postMessage({ type: "STDOUT", text: outText });
        outText = "";
      }
    },
    stderr: (charCode) => {
      const char = String.fromCharCode(charCode);
      postMessage({ type: "STDERR", text: char });
    }
  });

  // Ensure base dirs exist
  const dirs = ["/workspace", "/lib", "/grafisch", "/benchmarks", "/examples", "/paper_examples", "/tmp"];
  for (const d of dirs) {
    try {
      if (!execInstance.FS.analyzePath(d).exists) execInstance.FS.mkdir(d);
    } catch (_) {}
  }

  if (!isPath) {
    execInstance.FS.writeFile(targetPath, contentOrPath);
  } else if (jmvmModule.FS.analyzePath(targetPath).exists) {
    execInstance.FS.writeFile(targetPath, jmvmModule.FS.readFile(targetPath));
  }

  const startTime = performance.now();
  postMessage({ type: "STDOUT", text: `[VM] Starting execution for ${targetPath}...\n` });

  try {
    execInstance.callMain([targetPath]);
  } catch (e) {
    // Normal exit throws in Emscripten
  }

  if (outText.length > 0) {
    postMessage({ type: "STDOUT", text: outText + "\n" });
  }

  const totalTimeMs = Math.round(performance.now() - startTime);
  const rawOutput = fullOutput.join("");

  // Parse statistics
  const metrics = {
    res: null,
    elapsed_time: (totalTimeMs / 1000).toFixed(2),
    instr_executed: null,
    calls: null,
    creates: null,
    gc_count: null
  };

  const resMatch = rawOutput.match(/res:\s*([^\n\r]+)/);
  if (resMatch) metrics.res = resMatch[1].trim();

  const timeMatch = rawOutput.match(/Elapsed time:\s*([0-9.]+)\s*secs/);
  if (timeMatch) metrics.elapsed_time = parseFloat(timeMatch[1]).toFixed(2);

  const instrMatch = rawOutput.match(/instr executed:\s*([0-9]+)/);
  if (instrMatch) metrics.instr_executed = parseInt(instrMatch[1], 10);

  const callsMatch = rawOutput.match(/calls:\s*([0-9]+)/);
  if (callsMatch) metrics.calls = parseInt(callsMatch[1], 10);

  const createsMatch = rawOutput.match(/creates:\s*([0-9]+)/);
  if (createsMatch) metrics.creates = parseInt(createsMatch[1], 10);

  const gcMatch = rawOutput.match(/nr gc:\s*([0-9]+)/);
  if (gcMatch) metrics.gc_count = parseInt(gcMatch[1], 10);

  isExecuting = false;
  postMessage({
    type: "RUN_COMPLETE",
    id: runId,
    metrics,
    output: rawOutput,
    durationMs: totalTimeMs
  });
}

// De REPL draait sinds 8 oktober 2026 als de REPL in Sapl (rsEval hieronder,
// repl_sapl/). De vorige JavaScript-REPL (replSession, replEvalLine, ...)
// is weggehaald; zie git-geschiedenis vóór die datum.

// De imports als `import extern` (notebook): namen oplossen, de
// modulecode zit al in de bibliotheekunit (preprocess/modules.cfp).
// Alleen de imports die `code` nodig heeft (zelfde regel als
// de vroegere Python-REPL): `Alias.` komt erin voor, of de import
// heeft een open lijst (`as L (sum)`, `(..)`). Elke `import extern` laat de
// preprocessor het modulebestand parsen, ook als niemand het gebruikt.
function importNeeded(importText, code) {
  const m = importText.trim().match(/^import\s+(?:extern\s+)?"[^"]+"\s+as\s+([A-Z][A-Za-z0-9_]*)/);
  if (!m || importText.trim().slice(m[0].length).includes("(")) return true;
  return new RegExp("(^|[^A-Za-z0-9_])" + m[1] + "\\.").test(code);
}















/** Draait een gecompileerd .jmvm-programma en geeft de VOLLEDIGE stdout
 * in één keer terug (geen live per-regel postMessage zoals executeJmvm,
 * die is voor de "Run"-knop se terminal-streaming) -- nodig om printVal's
 * eigen uitvoer achteraf uit de vaste vm.cpp-banner (`VM starting for
 * .../execution started.../res: <code>/stop/...`) te kunnen isoleren. */
// onProgress (optioneel): krijgt de nieuwe uitvoer telkens als er een regel
// `@@begin N`/`@@end N` (lib/notebook_glue.cfp) af is -- de notebook weet zo
// welke cel bezig is, en houdt bij een tijdslimiet de al klare cellen.
// Het blijvende beeld (notebookplan §6.2, 6 oktober 2026): één wasm-
// exemplaar dat tussen notebook-runs blijft bestaan, met de code en de heap
// (vm.cpp's ReplImage, ingang jmvm_image_run). Een run laadt alleen wat er
// nog niet is; bij een herdefinitie begint de code opnieuw, maar CAF-waarden
// die er niet van afhangen blijven (een dure `rijen =: C.read ...` wordt
// niet opnieuw ingelezen). Weigert het beeld (-1), dan draait het programma
// zoals vroeger in een vers exemplaar. Stopt de VM met een fout (exit), dan
// is het exemplaar onbruikbaar en begint de volgende run met een nieuw.
// Veranderen de databestanden, dan begint het beeld schoon (een CAF die een
// bestand las, zou anders de oude inhoud houden).
// Eén exemplaar per gebruik ("notebook", "repl"), zodat hun namen elkaar
// niet in de weg zitten.
// == De REPL in Sapl (stap 6 van docs/2026-10-07_repl_in_sapl_plan.md) ======
// Eén Sapl-programma (repl_sapl/build/mini_repl.jmvm: preprocessor,
// compiler en typechecker als modules, plus de sessie) in een EIGEN
// wasm-exemplaar, dat tussen de regels gepauzeerd staat bij readLine
// (jmvm_rs_start/jmvm_rs_feed in vm.cpp). Dat exemplaar wordt voor niets
// anders gebruikt: de gepauzeerde run bezit alle globale toestand van de VM.
// Sterft het (een wasm-trap, bv. 1 / 0), dan speelt de worker alle eerder
// verwerkte regels opnieuw af in een vers exemplaar (rsJournal, rsReplay):
// de sessie komt terug, met `resN` opnieuw berekend; wijkt een uitkomst af
// (bv. door readFile), dan wordt dat gemeld.
let rsInstance = null;
let rsOutput = [];
// De regels die de engine verwerkte (zonder de regel die de trap gaf), met
// de eerste uitvoerregel om na het opnieuw afspelen te vergelijken.
let rsJournal = [];
const RS_FILES = ["repl_sapl/build/mini_repl.jmvm", "repl_sapl/build/prelude/prelude.cfp",
  "repl_sapl/build/prelude/prelude.pp.cfp", "repl_sapl/build/prelude/prelude.defs.txt"];

function rsText() {
  return new TextDecoder().decode(Uint8Array.from(rsOutput));
}

async function rsStart() {
  const inst = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
    stdin: () => null,
    stdout: (c) => rsOutput.push(c & 255),
    stderr: () => {}
  });
  for (const rel of RS_FILES) {
    const res = await fetch("../" + rel + "?v=" + Date.now());
    if (!res.ok) throw new Error("REPL in Sapl: " + rel + " niet gevonden");
    mkdirsFor(inst.FS, "/" + rel);
    inst.FS.writeFile("/" + rel, new Uint8Array(await res.arrayBuffer()));
  }
  mkdirsFor(inst.FS, "/lib/stdlib.cfp");
  inst.FS.writeFile("/lib/stdlib.cfp", stdlibContent);
  for (const [p, c] of Object.entries(sppDeps)) { mkdirsFor(inst.FS, p); inst.FS.writeFile(p, c); }
  mkdirsFor(inst.FS, "/repl_sapl/gen/x");
  inst.FS.chdir("/");
  rsOutput = [];
  const st = inst.ccall("jmvm_rs_start", "number", ["string"], ["repl_sapl/build/mini_repl.jmvm"]);
  if (st !== 1) throw new Error("REPL in Sapl startte niet: " + rsText());
  rsInstance = inst;
}

// Bestanden die een regel nodig heeft vóór hij naar de VM gaat: bij
// `:import "pad" as X` de module en (transitief) haar imports, bij `:load
// pad` het bestand en zijn imports. De VM kan in een worker niet zelf
// ophalen.
async function rsPrepare(line) {
  let src = "";
  const mi = line.match(/^:import\s+(.*)$/);
  if (mi) src = "import " + mi[1].trim();
  const ml = line.match(/^:load\s+(\S+)/);
  if (ml) {
    const rel = ml[1].startsWith("/") ? ml[1].slice(1) : ml[1];
    let content = null;
    for (const cand of ["/" + rel, "/workspace/" + rel]) {
      if (jmvmModule && jmvmModule.FS.analyzePath(cand).exists) { content = jmvmModule.FS.readFile(cand, { encoding: "utf8" }); break; }
    }
    if (content === null) {
      try { const res = await fetch("../" + rel); if (res.ok) content = await res.text(); } catch (_) {}
    }
    if (content !== null) { mkdirsFor(rsInstance.FS, "/" + rel); rsInstance.FS.writeFile("/" + rel, content); src = content; }
  }
  // `:nb pad` (de notebookmodus): het bestand staat al in het
  // bestandssysteem van de engine (RSAPL_EVAL's `files`); daarbij de
  // uitvoerlaag met haar imports, de imports van de cellen en de
  // databestanden die de cellen noemen.
  const mn = line.match(/^:nb\s+(\S+)/);
  if (mn) {
    const vp = "/" + mn[1].replace(/^\//, "");
    const nb = rsInstance.FS.analyzePath(vp).exists ? rsInstance.FS.readFile(vp, { encoding: "utf8" }) : "";
    if (!rsInstance.FS.analyzePath("/lib/notebook_glue.cfp").exists) {
      const res = await fetch("../lib/notebook_glue.cfp");
      if (!res.ok) throw new Error("lib/notebook_glue.cfp niet gevonden");
      mkdirsFor(rsInstance.FS, "/lib/notebook_glue.cfp");
      rsInstance.FS.writeFile("/lib/notebook_glue.cfp", await res.text());
    }
    src = 'import "lib/display.spp" as D\nimport "grafisch/graphics.cfp" as G\n' + nb;
    const data = await collectDataFiles(nb);
    for (const [p, c] of Object.entries(data)) { mkdirsFor(rsInstance.FS, p); rsInstance.FS.writeFile(p, c); }
  }
  // Databestanden die de regel noemt (`C.read "notebooks/data/fruit.csv"`),
  // zoals het notebook (collectDataFiles); anders leest readFile niets.
  const data = await collectDataFiles(line);
  for (const [p, c] of Object.entries(data)) { mkdirsFor(rsInstance.FS, p); rsInstance.FS.writeFile(p, c); }
  if (!src) return;
  const found = await collectSppImports(src);
  for (const [p, c] of Object.entries(found)) { mkdirsFor(rsInstance.FS, p); rsInstance.FS.writeFile(p, c); }
}

function rsFirstLine(text) {
  const t = text.endsWith("repl> ") ? text.slice(0, -6) : text;
  return t.split("\n")[0];
}

// Eén invoerregel: de uitvoer van de REPL tot de volgende prompt.
async function rsEval(line) {
  if (!rsInstance) await rsStart();
  await rsPrepare(line);
  rsOutput = [];
  let st;
  try {
    st = rsInstance.ccall("jmvm_rs_feed", "number", ["string"], [line]);
  } catch (e) {
    rsInstance = null;
    const replay = await rsReplay();
    return { output: "", restarted: true, replay };
  }
  const text = rsText();
  if (st !== 1) { rsInstance = null; rsJournal = []; }   // het programma stopte (quit)
  else rsJournal.push({ line, first: rsFirstLine(text) });
  return { output: text.endsWith("repl> ") ? text.slice(0, -6) : text, restarted: false };
}

// Na een trap: een vers exemplaar en alle verwerkte regels opnieuw.
async function rsReplay() {
  const lines = rsJournal;
  const differ = [];
  try {
    await rsStart();
    for (const j of lines) {
      await rsPrepare(j.line);
      rsOutput = [];
      rsInstance.ccall("jmvm_rs_feed", "number", ["string"], [j.line]);
      if (rsFirstLine(rsText()) !== j.first) differ.push(j.line);
    }
  } catch (e) {
    rsInstance = null;
    rsJournal = [];
    return { ok: false, n: lines.length, differ };
  }
  return { ok: true, n: lines.length, differ };
}

function rsTrapMessage(replay) {
  if (!replay || !replay.ok) return "de REPL-engine stopte (bv. 1 / 0), en opnieuw opbouwen lukte niet: de sessie is weg";
  let m = "de REPL-engine stopte (bv. 1 / 0); de sessie is opnieuw opgebouwd";
  if (replay.n > 0) m += ` (${replay.n} eerdere regel${replay.n === 1 ? "" : "s"} opnieuw uitgevoerd, resN opnieuw berekend)`;
  if (replay.differ.length) m += `; andere uitkomst dan eerst bij: ${replay.differ.join(" | ")}`;
  return m;
}

const imageInstances = {};
const imageDataKeys = {};
let imageOutput = null;
let imageLast = null;

async function imageGet(kind = "notebook") {
  if (!imageInstances[kind]) {
    const imageInstance = await createJMVMModule({
      noInitialRun: true,
      locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
      stdin: () => null,
      stdout: (c) => imageOutput && imageOutput(c),
      stderr: (c) => imageOutput && imageOutput(c)
    });
    imageInstance.ccall("jmvm_image_init", null, [], []);
    imageInstances[kind] = imageInstance;
    imageDataKeys[kind] = null;
  }
  return imageInstances[kind];
}

function imageCall(kind, name, ret = null, types = [], args = []) {
  const inst = imageInstances[kind];
  return inst ? inst.ccall(name, ret, types, args) : null;
}

function dataFilesKey(files) {
  return Object.keys(files).sort().map((p) => {
    const c = files[p];
    let h = 0;
    for (let i = 0; i < c.length; i++) h = (h * 31 + c[i]) | 0;
    return p + ":" + c.length + ":" + h;
  }).join("|");
}

// Zoals runJmvmCapture, maar op het beeld; null als het beeld weigert.
// `chunk`: jmvmContent is een los stuk met open labels (saplcomp_module's
// jmvm-stap); weigert het beeld (iets staat er nog niet in), dan null.
async function runOnImage(jmvmContent, extraFiles = {}, onProgress = null, chunk = false, kind = "notebook") {
  const inst = await imageGet(kind);
  const key = dataFilesKey(extraFiles);
  if (imageDataKeys[kind] !== null && key !== imageDataKeys[kind]) inst.ccall("jmvm_image_reset", null, [], []);
  imageDataKeys[kind] = key;
  const output = [];
  let lineStart = 0, flushed = 0;
  imageOutput = (c) => {
    output.push(String.fromCharCode(c));
    if (c === 10 && onProgress) {
      const line = output.slice(lineStart, lineStart + 7).join("");
      lineStart = output.length;
      if (line.startsWith("@@begin") || line.startsWith("@@end")) {
        onProgress(output.slice(flushed).join(""));
        flushed = output.length;
      }
    }
  };
  inst.FS.writeFile("/tmp/image_run.jmvm", jmvmContent);
  for (const [p, content] of Object.entries(extraFiles)) {
    mkdirsFor(inst.FS, p);
    inst.FS.writeFile(p, content);
  }
  let rc;
  try {
    rc = inst.ccall("jmvm_image_run", "number", ["string", "number"], ["/tmp/image_run.jmvm", chunk ? 1 : 0]);
  } catch (e) {
    // De VM stopte met een fout (exit, of een wasm-trap zoals bij 1 / 0):
    // de uitvoer tot dan is het resultaat. Het exemplaar is weg, en met
    delete imageInstances[kind];
    imageLast = { event: "exemplaar gestopt", error: true };
    imageOutput = null;
    return output.join("");
  }
  imageOutput = null;
  imageLast = {
    event: inst.UTF8ToString(inst.ccall("jmvm_image_event", "number", [], [])),
    newCode: inst.ccall("jmvm_image_new_code", "number", [], []),
    cafs: inst.ccall("jmvm_image_cafs", "number", [], []),
    calls: inst.ccall("jmvm_image_calls", "number", [], []),
    chunk
  };
  if (rc !== 0) return null;
  return output.join("");
}

async function runJmvmCapture(jmvmContent, extraFiles = {}, stdinText = "", onProgress = null) {
  let output = [];
  let lineStart = 0;
  let flushed = 0;
  const stdinBytes = new TextEncoder().encode(stdinText);
  let stdinPos = 0;
  const instance = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
    stdin: () => (stdinPos < stdinBytes.length ? stdinBytes[stdinPos++] : null),
    stdout: (c) => {
      output.push(String.fromCharCode(c));
      if (c === 10 && onProgress) {
        const line = output.slice(lineStart, lineStart + 7).join("");
        lineStart = output.length;
        if (line.startsWith("@@begin") || line.startsWith("@@end")) {
          onProgress(output.slice(flushed).join(""));
          flushed = output.length;
        }
      }
    },
    stderr: (c) => output.push(String.fromCharCode(c))
  });
  instance.FS.writeFile("/tmp/repl_turn.jmvm", jmvmContent);
  for (const [path, content] of Object.entries(extraFiles)) {
    mkdirsFor(instance.FS, path);
    instance.FS.writeFile(path, content);
  }
  try {
    instance.callMain(["/tmp/repl_turn.jmvm"]);
  } catch (e) {
    // normal VM exit throws in Emscripten
  }
  return output.join("");
}





// Wat het beeld bij de laatste REPL-regel deed (voor tests).
// Draaide de laatste regel op het beeld (dan is `resN` een momentopname daar).

// De resN die als momentopname in het repl-exemplaar staan, en die verliepen
// doordat het exemplaar zelf stierf (een wasm-trap, 7 oktober 2026: na `5`,
// `1 / 0` gaf `res0 + 1` stil een opnieuw berekende waarde). Het nieuwe
// exemplaar weet daar niets van, dus houdt de worker het bij.





/**
 * Notebook in twee delen (27 september 2026, zelfde opzet als de REPL): de
 * `#import`/`import`-regels op kolom 0 (de vaste kop van notebook_core.js
 * plus de importcellen) vormen een bibliotheekdeel dat één keer
 * gecompileerd wordt (notebookLibUnit); de eigen cellen worden daartegen
 * gecompileerd (saplcomp_module) en met retaglink erbij gelinkt. Daarvoor
 * werden repl/stddyn.cfp (met de hele stdlib), de glue, Display, Graphics en
 * elke geïmporteerde module bij elke run opnieuw gecompileerd.
 *
 * Resultaat: { jmvm } of { stage, error } (stage "preprocess"/"compile").
 */
const NB_LIB_LINE_RE = /^(?:#import|import)\s+"/;

async function notebookLibUnit(importLines) {
  const libText = importLines.join("\n") + "\n";
  const deps = await collectSppImports(libText);
  const key = libText + "\0" + Object.keys(deps).sort().map((p) => p + "\0" + deps[p]).join("\0");
  const cached = notebookLibCache.get(key);
  if (cached) return cached;
  const pre = await preprocessSpp(libText, "/workspace/notebook_lib.spp", "l");
  if (!pre.success) return { stage: "preprocess", error: pre.stdout };
  const lib = {};
  for (const stage of ["defs", "typedefs", "retag"]) {
    const r = await runCompilerStage(pre.files[0].content, stage, `/tmp/notebook_lib.${stage}.txt`);
    if (!r.success) return { stage: "compile", error: r.output };
    lib[stage] = r.content;
  }
  notebookLibCache.set(key, lib);
  if (notebookLibCache.size > 4) notebookLibCache.delete(notebookLibCache.keys().next().value);
  return lib;
}

// Voorbewerken: de bibliotheekunit en de eigen tekst als Sapl.
async function notebookPrepare(source) {
  const lines = source.split("\n");
  const importLines = lines.filter((l) => NB_LIB_LINE_RE.test(l));
  const lib = await notebookLibUnit(importLines);
  if (lib.stage) return lib;
  const own = lines.filter((l) => !NB_LIB_LINE_RE.test(l));
  const ownText = own.join("\n");
  const externs = importLines.filter((l) => l.startsWith("import ") && importNeeded(l, ownText)).map((l) => l.replace("import ", "import extern "));
  const pre = await preprocessSpp([...externs, ...own].join("\n"), "/workspace/notebook.spp");
  if (!pre.success) return { stage: "preprocess", error: pre.stdout };
  return { lib, pre };
}

// Stap 3 voor het notebook (notebookplan §6.2): alleen de eigen cellen
// compileren, als los stuk tegen de bibliotheek die al in het beeld staat
// (retaglink + retagcomp van de hele bibliotheek, ~70% van een run, valt
// weg). null als het niet lukt; dan de volledige weg.
async function notebookCompileChunk(prep) {
  const imageInstance = imageInstances.notebook;
  if (!imageInstance || imageInstance.ccall("jmvm_image_size", "number", [], []) === 0) return null;
  const cafs = imageInstance.UTF8ToString(imageInstance.ccall("jmvm_image_caf_names", "number", [], []));
  const r = await runSaplcompModuleStage(prep.pre.files[0].content, "jmvm", "/tmp/notebook.chunk.jmvm", [prep.lib.defs], [prep.lib.typedefs], cafs);
  return r.success ? r.content : null;
}

async function notebookCompile(source, prepared = null) {
  const prep = prepared || await notebookPrepare(source);
  if (prep.stage) return prep;
  const { lib, pre } = prep;
  const retag = await runSaplcompModuleStage(pre.files[0].content, "retag", "/tmp/notebook.retag.txt", [lib.defs], [lib.typedefs]);
  if (!retag.success) return { stage: "compile", error: retag.output };
  const link = await runRetagLinkStage([lib.retag, retag.content], "/tmp/notebook_linked.retag.txt", "start");
  if (!link.success) return { stage: "compile", error: link.output };
  const comp = await runRetagCompStage(link.content, "/tmp/notebook.jmvm");
  if (!comp.success) return { stage: "compile", error: comp.output };
  return { jmvm: comp.content };
}


/**
 * Handle messages from the UI thread
 */
self.onmessage = async function (e) {
  const msg = e.data;
  switch (msg.type) {
    case "INIT":
      await initEngine(msg);
      break;

    case "COMPILE":
      try {
        const result = await compileSapl(msg.source, msg.path, msg.stages || ["jmvm"], msg.strictness !== false);
        postMessage({
          type: "COMPILE_COMPLETE",
          id: msg.id,
          ...result
        });
      } catch (err) {
        postMessage({
          type: "COMPILE_COMPLETE",
          id: msg.id,
          success: false,
          error: err.message,
          files: []
        });
      }
      break;

    case "COMPILE_RETAG":
      try {
        const result = await compileRetag(msg.source, msg.path);
        postMessage({
          type: "COMPILE_COMPLETE",
          id: msg.id,
          ...result
        });
      } catch (err) {
        postMessage({
          type: "COMPILE_COMPLETE",
          id: msg.id,
          success: false,
          error: err.message,
          files: []
        });
      }
      break;

    case "PREPROCESS":
      try {
        const result = msg.kind === "lfp"
          ? await preprocessLfp(msg.source, msg.path)
          : await preprocessSpp(msg.source, msg.path);
        postMessage({
          type: "COMPILE_COMPLETE",
          id: msg.id,
          ...result
        });
      } catch (err) {
        postMessage({
          type: "COMPILE_COMPLETE",
          id: msg.id,
          success: false,
          error: err.message,
          files: []
        });
      }
      break;

    case "TYPECHECK":
      try {
        const result = await typecheckSource(msg.source, msg.path);
        postMessage({
          type: "COMPILE_COMPLETE",
          id: msg.id,
          ...result
        });
      } catch (err) {
        postMessage({
          type: "COMPILE_COMPLETE",
          id: msg.id,
          success: false,
          error: err.message
        });
      }
      break;

    case "BUILD_MODULES":
      try {
        const result = await buildModules(msg.manifest, msg.entryModule, msg.entryFunc || "start", msg.moduleSources || {}, msg.outPath);
        postMessage({
          type: "COMPILE_COMPLETE",
          id: msg.id,
          ...result
        });
      } catch (err) {
        postMessage({
          type: "COMPILE_COMPLETE",
          id: msg.id,
          success: false,
          error: err.message,
          stderr: err.message,
          files: []
        });
      }
      break;

    case "RUN":
      try {
        await executeJmvm(msg.contentOrPath, msg.isPath, msg.stdin || "", msg.id);
      } catch (err) {
        postMessage({ type: "STDERR", text: `VM Error: ${err.message}\n` });
        postMessage({
          type: "RUN_COMPLETE",
          id: msg.id,
          metrics: { res: "Error", elapsed_time: "0", instr_executed: 0, calls: 0, creates: 0, gc_count: 0 },
          output: err.message
        });
      }
      break;

    case "NOTEBOOK_RUN":
      // Notebook (notebook.html): het door notebook.js gegenereerde
      // Sapl+-programma preprocessen, compileren en draaien, en de volledige
      // uitvoer teruggeven; notebook.js leest daar de @@begin/@@end-blokken
      // van lib/notebook_glue.cfp uit.
      try {
        // Zelfde programma als een eerdere run (bv. opnieuw "Alles
        // uitvoeren" zonder wijziging): voorbewerken en compileren overslaan.
        const bytesToText = (raw) => new TextDecoder().decode(Uint8Array.from(raw, (ch) => ch.charCodeAt(0) & 255));
        const progress = (raw) => postMessage({ type: "NOTEBOOK_PROGRESS", id: msg.id, text: bytesToText(raw) });
        let jmCached = notebookCache.get(msg.source);
        // Wat een mislukte poging als los stuk al deed (bv. "code opnieuw"
        // na een herdefinitie), komt vóór de melding van de volledige run.
        let earlierEvent = "";
        const runNb = async (jmvm) => {
          const files = await collectDataFiles(msg.source);
          imageLast = null;
          const onImage = msg.noImage ? null : await runOnImage(jmvm, files, progress);
          if (imageLast && earlierEvent) imageLast.event = earlierEvent + imageLast.event;
          return onImage !== null ? onImage : await runJmvmCapture(jmvm, files, "", progress);
        };
        if (jmCached) {
          const raw = await runNb(jmCached);
          const output = new TextDecoder().decode(Uint8Array.from(raw, (ch) => ch.charCodeAt(0) & 255));
          postMessage({ type: "NOTEBOOK_RESULT", id: msg.id, success: true, output, cached: true, image: imageLast });
          break;
        }
        // Eerst als los stuk op het beeld; lukt dat niet, de volledige weg.
        let prep = null;
        if (!msg.noImage && !msg.noChunk) {
          prep = await notebookPrepare(msg.source);
          if (prep.stage) {
            postMessage({ type: "NOTEBOOK_RESULT", id: msg.id, success: false, stage: prep.stage, error: prep.error });
            break;
          }
          const chunk = await notebookCompileChunk(prep);
          if (chunk) {
            imageLast = null;
            const rawC = await runOnImage(chunk, await collectDataFiles(msg.source), progress, true);
            if (rawC !== null) {
              const output = new TextDecoder().decode(Uint8Array.from(rawC, (ch) => ch.charCodeAt(0) & 255));
              postMessage({ type: "NOTEBOOK_RESULT", id: msg.id, success: true, output, image: imageLast });
              break;
            }
            if (imageLast) earlierEvent = imageLast.event || "";
          }
        }
        const built = await notebookCompile(msg.source, prep);
        if (!built.jmvm) {
          postMessage({ type: "NOTEBOOK_RESULT", id: msg.id, success: false, stage: built.stage, error: built.error });
          break;
        }
        const jm = { content: built.jmvm };
        notebookCache.set(msg.source, jm.content);
        if (notebookCache.size > 8) notebookCache.delete(notebookCache.keys().next().value);
        // runJmvmCapture levert één teken per byte; een notebook toont
        // gewone tekst (°, emoji), dus als UTF-8 terugdecoderen.
        const raw = await runNb(jm.content);
        const output = new TextDecoder().decode(Uint8Array.from(raw, (ch) => ch.charCodeAt(0) & 255));
        postMessage({ type: "NOTEBOOK_RESULT", id: msg.id, success: true, output, image: imageLast });
      } catch (err) {
        postMessage({ type: "NOTEBOOK_RESULT", id: msg.id, success: false, stage: "worker", error: err.message });
      }
      break;

    case "IMAGE_RESET":
      // Het blijvende beeld leegmaken (alle bewaarde CAF-waarden weg).
      for (const k of Object.keys(imageInstances)) imageCall(k, "jmvm_image_reset");
      postMessage({ type: "IMAGE_RESET_DONE", id: msg.id });
      break;

    case "LC_RUN":
      // lc-cellen van de notebook: lc_repl/lc_repl.jmvm met alle lc-regels
      // als stdin (notebook_core.js's lcInput/parseLcOutput).
      try {
        if (!lcReplBytecode) {
          const res = await fetch("../lc_repl/lc_repl.jmvm");
          if (!res.ok) throw new Error("lc_repl/lc_repl.jmvm niet gevonden");
          lcReplBytecode = await res.text();
        }
        const raw = await runJmvmCapture(lcReplBytecode, {}, msg.stdin);
        const output = new TextDecoder().decode(Uint8Array.from(raw, (ch) => ch.charCodeAt(0) & 255));
        postMessage({ type: "LC_RESULT", id: msg.id, success: true, output });
      } catch (err) {
        postMessage({ type: "LC_RESULT", id: msg.id, success: false, error: err.message });
      }
      break;

    case "RSAPL_EVAL":
      // De REPL in Sapl (rsEval hierboven). `files`: bestanden die de
      // interface al heeft (bv. :load van een open tabblad), eerst in het
      // bestandssysteem van de engine.
      try {
        if (msg.files) {
          if (!rsInstance) await rsStart();
          for (const [p, c] of Object.entries(msg.files)) { const vp = "/" + p.replace(/^\//, ""); mkdirsFor(rsInstance.FS, vp); rsInstance.FS.writeFile(vp, c); }
        }
        const r = await rsEval(msg.line);
        postMessage({ type: "RSAPL_RESULT", id: msg.id, success: !r.restarted, output: r.output,
          error: r.restarted ? rsTrapMessage(r.replay) : undefined });
      } catch (err) {
        postMessage({ type: "RSAPL_RESULT", id: msg.id, success: false, error: err.message });
      }
      break;

    case "RSAPL_SAVE":
      // :save: de REPL in Sapl schrijft de sessie in zijn eigen
      // bestandssysteem; de tekst gaat terug (de interface opent hem als
      // nieuw tabblad, zoals bij de huidige REPL).
      try {
        const path = "repl_sapl/gen/websapl_save.cfp";
        const r = await rsEval(":save " + path);
        if (r.restarted || !rsInstance) throw new Error("opslaan mislukt");
        const content = rsInstance.FS.readFile("/" + path, { encoding: "utf8" });
        postMessage({ type: "RSAPL_RESULT", id: msg.id, success: true, content });
      } catch (err) {
        postMessage({ type: "RSAPL_RESULT", id: msg.id, success: false, error: err.message });
      }
      break;

    case "RSAPL_RESET":
      rsInstance = null;
      rsJournal = [];
      postMessage({ type: "RSAPL_RESULT", id: msg.id, success: true, output: "" });
      break;

    default:
      console.warn("Unknown worker message type:", msg.type);
  }
};
