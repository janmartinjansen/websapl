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

  isInitialized = true;
  postMessage({ type: "INIT_DONE" });
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
const SPP_IMPORT_RE = /^(?:#import|import)\s+"([^"]+)"/;

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

async function preprocessSpp(source, srcPath) {
  if (!isInitialized) throw new Error("JMVM engine is not initialized.");
  if (!driverBytecode) throw new Error("Sapl+ preprocessor (driver.jmvm) kon niet geladen worden.");

  const startTime = performance.now();
  const baseName = srcPath.split("/").pop().replace(/\.spp$/, "");
  const outPath = `/tmp/${baseName}.cfp`;

  let compilerOutput = [];
  let stdinBuffer = `/tmp/in.spp\n${outPath}\n`.split("");
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
async function runSaplcompModuleStage(moduleSource, stage, outPath, defsContents, typedefsContents) {
  if (!saplcompModuleBytecode) throw new Error("saplcomp_module.jmvm kon niet geladen worden.");

  const defsPaths = defsContents.map((_, i) => `/tmp/deps/d${i}.defs.txt`);
  const typedefsPaths = typedefsContents.map((_, i) => `/tmp/deps/d${i}.typedefs.txt`);
  const stdinText = `/tmp/mod_in.cfp\n${outPath}\n${stage}\n${defsPaths.join(" ")}\n${typedefsPaths.join(" ")}\n`;
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

    const defsRes = await runCompilerStage(src, "defs", `/tmp/mods/${i}.defs.txt`);
    if (!defsRes.success) throw new Error(`defs-extractie mislukt voor ${mod}:\n${defsRes.output}`);
    defsCache[mod] = defsRes.content;

    const typedefsRes = await runCompilerStage(src, "typedefs", `/tmp/mods/${i}.typedefs.txt`);
    if (!typedefsRes.success) throw new Error(`typedefs-extractie mislukt voor ${mod}:\n${typedefsRes.output}`);
    typedefsCache[mod] = typedefsRes.content;

    const depMods = deps[mod];
    const defsContents = depMods.map((d) => defsCache[d]);
    const typedefsContents = depMods.map((d) => typedefsCache[d]);
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

/**
 * Sapl+ REPL, client-side poort van sapl_compiler/tools/repl_retag.py
 * (repl/README.md/docs/2026-09-13_repl_via_retag_
 * linking_plan.md) -- de C++-poort (vm.cpp's REPL_HOST/repl-host) was al
 * een tweede, gedrag-identieke implementatie op dezelfde ontwerp; dit is
 * een DERDE, met dezelfde sessie-logica maar dan tegen de WASM-VM-
 * instanties hierboven i.p.v. een los resident proces of per-regel
 * subprocessen. Elke turn hergebruikt precies de vijf primitieven die
 * ook de "modules"-backend hierboven al gebruikt: runCompilerStage
 * (defs/typedefs/retag van de VOLLEDIGE sessie, één plat bestand -- een
 * sessie heeft geen aparte modules, dus GEEN saplcomp_module.jmvm
 * hiervoor nodig), runSaplcompModuleStage (de éne turn-regel compileren
 * TEGEN de sessie se defs/typedefs, alsof de sessie zijn enige
 * afhankelijkheid is), runRetagLinkStage (sessie+turn retag-tekst
 * samenvoegen vanaf "start"), runRetagCompStage (naar bytecode), en een
 * nieuwe runJmvmCapture (de bytecode draaien en de volledige uitvoer in
 * één keer teruggeven, i.p.v. executeJmvm's regel-voor-regel
 * postMessage-streaming voor de "Run"-knop).
 *
 * BEWUST GEEN aparte "start"/"stop": de WASM-engine is hier altijd al
 * klaar (initEngine() bij het laden van de pagina), dus er is geen los
 * proces om te starten zoals Workbench's repl-host -- de sessie leeft
 * gewoon in `replSession` hieronder, zolang het tabblad/de pagina open
 * blijft.
 */
let replSession = null;

const REPL_RESERVED_NAMES = new Set(["start"]);

function replSplitDefinitions(text) {
  const defs = [];
  let current = null;
  for (const raw of text.split("\n")) {
    const stripped = raw.trim();
    if (stripped === "" || stripped.startsWith("//")) continue;
    const indented = raw.length > 0 && (raw[0] === " " || raw[0] === "\t");
    if (!indented) {
      if (current !== null) defs.push(current);
      current = raw;
    } else {
      if (current === null) throw new Error(`onverwachte inspringing zonder voorgaande regel: ${raw}`);
      current += "\n" + raw;
    }
  }
  if (current !== null) defs.push(current);
  return defs;
}

function replExtractDefName(text) {
  const stripped = text.trim();
  let m = stripped.match(/^::\s*([A-Za-z_][A-Za-z0-9_]*)/);
  if (m) return "::" + m[1];
  m = stripped.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  if (m) return m[1];
  throw new Error(`:def kon geen naam vinden in: ${JSON.stringify(text)}`);
}

// Zelfde normalisatie als repl_retag.py's normalize_for_compare/vm.cpp's
// normalizeForCompareH: elke run witruimte plat tot precies één spatie
// vóór de identiek-aan-de-prelude-vergelijking, zodat een louter
// cosmetisch verschil (bv. dubbele spatie) een onterechte harde `:load`-
// fout niet kan veroorzaken.
function replNormalizeForCompare(text) {
  return text.trim().replace(/\s+/g, " ");
}

function replJoinEntries(entries) {
  return entries.map((e) => e.text).join("\n") + (entries.length ? "\n" : "");
}

async function replInit() {
  if (replSession) return;
  if (!isInitialized) throw new Error("JMVM engine is not initialized.");

  // repl/repl_prelude.cfp is BEWUST zelfstandig (geen #import) gemaakt
  // (zie dat bestand se eigen headercommentaar) precies om dit soort
  // hergebruik triviaal te maken -- geen resolveImports() nodig zoals
  // stdlib.cfp elders in dit bestand wél nodig heeft.
  let prelude = "";
  try {
    const res = await fetch("../repl/repl_prelude.cfp?v=" + Date.now());
    if (res.ok) prelude = await res.text();
  } catch (_) {}
  if (!prelude) throw new Error("kon repl/repl_prelude.cfp niet laden.");

  const preludeDefs = {};
  const preludeNames = new Set();
  for (const d of replSplitDefinitions(prelude)) {
    const name = replExtractDefName(d);
    preludeDefs[name] = d;
    preludeNames.add(name);
  }

  replSession = {
    entries: [],
    resCounter: 0,
    history: [],
    prelude,
    preludeDefs,
    preludeNames,
    defs: "",
    typedefs: "",
    retag: ""
  };

  await replAtomicRebuild([], 0);
}

/**
 * Bouwt en compileert `newEntries` (vóórafgegaan door de vaste prelude)
 * als kandidaat-sessie; pas bij volledig succes wordt dat gepromoveerd.
 * Zelfde alles-of-niets-garantie als repl_retag.py's
 * Session._atomic_rebuild/vm.cpp's ReplSession::atomicRebuild -- een
 * mislukte regel raakt de sessie dus nooit.
 */
async function replAtomicRebuild(newEntries, newResCounter) {
  const oldSnapshot = { entries: replSession.entries, resCounter: replSession.resCounter };
  const sessionText = replSession.prelude + "\n" + replJoinEntries(newEntries);

  const defsRes = await runCompilerStage(sessionText, "defs", "/tmp/repl_session.defs.txt");
  if (!defsRes.success) throw new Error(`sessie-defs mislukt:\n${defsRes.output}`);
  const typedefsRes = await runCompilerStage(sessionText, "typedefs", "/tmp/repl_session.typedefs.txt");
  if (!typedefsRes.success) throw new Error(`sessie-typedefs mislukt:\n${typedefsRes.output}`);
  const retagRes = await runCompilerStage(sessionText, "retag", "/tmp/repl_session.retag.txt");
  if (!retagRes.success) throw new Error(`sessie-retag mislukt:\n${retagRes.output}`);

  replSession.history.push(oldSnapshot);
  replSession.entries = newEntries;
  replSession.resCounter = newResCounter;
  replSession.defs = defsRes.content;
  replSession.typedefs = typedefsRes.content;
  replSession.retag = retagRes.content;
}

async function replSetEntries(updates, newResCounter) {
  for (const [name] of updates) {
    if (replSession.preludeNames.has(name)) {
      throw new Error(`'${name}' is al gedefinieerd in de prelude -- kies een andere naam`);
    }
    if (REPL_RESERVED_NAMES.has(name)) {
      throw new Error(`'${name}' is gereserveerd voor de REPL zelf (elke beurt se interne entry point) -- kies een andere naam`);
    }
  }
  let newEntries = replSession.entries.slice();
  for (const [name, text] of updates) {
    newEntries = newEntries.filter((e) => e.name !== name);
    newEntries.push({ name, text });
  }
  await replAtomicRebuild(newEntries, newResCounter === undefined ? replSession.resCounter : newResCounter);
}

async function replUndo() {
  if (replSession.history.length === 0) throw new Error("niets om ongedaan te maken");
  const prev = replSession.history.pop();
  await replAtomicRebuild(prev.entries, prev.resCounter);
}

async function replReset() {
  await replAtomicRebuild([], 0);
}

/**
 * :load -- content/pad komen al opgehaald+eventueel op een .cfp-sibling
 * teruggevallen mee van de hoofdthread (zie app.js's replLoad(), dat
 * dezelfde bestandsresolutie hergebruikt als de "modules"-backend); hier
 * alleen nog de sessie-logica: splitsen, prelude-botsingen (identiek-
 * tekst: overslaan; anders: harde fout via replSetEntries), `start`
 * altijd overslaan.
 */
async function replLoadContent(content, notes) {
  const defs = replSplitDefinitions(content);
  if (defs.length === 0) throw new Error(":load: geen top-level definities gevonden");

  const updates = [];
  for (const d of defs) {
    const name = replExtractDefName(d);
    if (REPL_RESERVED_NAMES.has(name)) {
      notes.push(`'${name}' is gereserveerd voor de REPL zelf -- overgeslagen (roep de functies die je wil verkennen rechtstreeks aan).`);
      continue;
    }
    if (replSession.preludeNames.has(name) && replNormalizeForCompare(d) === replNormalizeForCompare(replSession.preludeDefs[name])) {
      notes.push(`'${name}' staat al (woordelijk gelijk) in de prelude -- overgeslagen.`);
      continue;
    }
    updates.push([name, d]);
  }
  if (updates.length > 0) await replSetEntries(updates);
  return updates.map(([name]) => name);
}

/**
 * `:type <expr>` (25 sep 2026): de huidige sessie (mét prelude) plus
 * `__type = <expr>` door typecheckSource(), zonder de sessie te wijzigen.
 * Zelfde gedrag en meldingen als repl_retag.py's Session.type_of/
 * parse_typecheck_output en vm.cpp's ReplSession::typeOf: een typefout in
 * een eigen sessiedefinitie geeft een notitie (types die ervan afhangen
 * kunnen te algemeen zijn), fouten in de bewust dynamische prelude niet.
 */
async function replTypeOf(expr) {
  const source = replSession.prelude + "\n" + replJoinEntries(replSession.entries) + `__type = ${expr}\n`;
  const result = await typecheckSource(source, "/tmp/repl_type_query.cfp");
  const raw = result.stdout || "";
  const lines = raw.split("\n");
  const userNames = new Set(replSession.entries.map((e) => e.name));

  const okLine = lines.find((l) => l.startsWith("__type :: "));
  if (okLine) {
    const failed = lines
      .filter((l) => l.includes(": FOUT: ") && userNames.has(l.split(":")[0]))
      .map((l) => l.split(":")[0]);
    const notes = failed.length
      ? [`let op: typefout in ${failed.join(", ")} -- een type dat daarvan afhangt kan te algemeen zijn`]
      : [];
    return { inferredType: okLine.slice("__type :: ".length).trim(), notes };
  }
  const errPrefix = "__type: FOUT: __type: ";
  const errLine = lines.find((l) => l.startsWith(errPrefix));
  if (errLine) throw new Error(errLine.slice(errPrefix.length).trim());
  // Geen __type-regel: de parser van de typechecker faalde; de melding
  // staat tussen `execution started` en vm.cpp's `stop`.
  const startMarker = raw.match(/execution started, progsize=\d+\r?\n?/);
  let body = startMarker ? raw.slice(startMarker.index + startMarker[0].length) : raw;
  const stopIdx = body.indexOf("stop");
  if (stopIdx >= 0) body = body.slice(0, stopIdx);
  body = body.trim();
  throw new Error(body || "typechecker gaf geen uitvoer");
}

function replFuncs() {
  if (!replSession.defs) return [];
  return replSession.defs
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !replSession.preludeNames.has(l.split(" ")[0]));
}

/** Draait een gecompileerd .jmvm-programma en geeft de VOLLEDIGE stdout
 * in één keer terug (geen live per-regel postMessage zoals executeJmvm,
 * die is voor de "Run"-knop se terminal-streaming) -- nodig om printVal's
 * eigen uitvoer achteraf uit de vaste vm.cpp-banner (`VM starting for
 * .../execution started.../res: <code>/stop/...`) te kunnen isoleren. */
async function runJmvmCapture(jmvmContent) {
  let output = [];
  const instance = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p),
    stdin: () => null,
    stdout: (c) => output.push(String.fromCharCode(c)),
    stderr: (c) => output.push(String.fromCharCode(c))
  });
  instance.FS.writeFile("/tmp/repl_turn.jmvm", jmvmContent);
  try {
    instance.callMain(["/tmp/repl_turn.jmvm"]);
  } catch (e) {
    // normal VM exit throws in Emscripten
  }
  return output.join("");
}

// Vindt de door printVal geschreven tekst in de VOLLEDIGE callMain-output.
// `callMain` gaat door de gewone main() (dezelfde als de native ./run-
// binary), dus staat er EERST nog een vaste "VM starting for .../Reading
// file .../execution started, progsize=..."-banner vóór het programma se
// eigen uitvoer -- anders dan vm.cpp's REPL_HOST/repl-host, die run()
// rechtstreeks aanroept zonder die wrapper. Zelfde twee-staps-aanpak als
// repl_retag.py's extract_output (die via een echt `./run`-subprocess
// loopt en dus dezelfde banner ziet): eerst alles vóór en op de vaste
// "execution started"-regel overslaan, dan pas de LAATSTE letterlijke
// `res: `-marker zoeken (printVal schrijft geen eigen afsluitende
// newline, dus de weergegeven waarde staat zonder scheidingsteken vóór
// `res: <code>`, bv. `Just(5)res: 0`).
function replExtractOutput(out) {
  const lines = out.split("\n");
  const startIdx = lines.findIndex((l) => l.startsWith("execution started"));
  if (startIdx === -1) return "";
  const body = lines.slice(startIdx + 1).join("\n");
  const markerIdx = body.lastIndexOf("res: ");
  if (markerIdx === -1) return "";
  return body.slice(0, markerIdx).trim();
}

async function replEvalLine(line) {
  const turnSource = `start = printVal (${line})\n`;

  const turnRes = await runSaplcompModuleStage(turnSource, "retag", "/tmp/repl_turn.retag.txt", [replSession.defs], [replSession.typedefs]);
  if (!turnRes.success) throw new Error(turnRes.output);

  const linkRes = await runRetagLinkStage([replSession.retag, turnRes.content], "/tmp/repl_linked.retag.txt", "start");
  if (!linkRes.success) throw new Error(`retaglink.jmvm mislukt:\n${linkRes.output}`);

  const compRes = await runRetagCompStage(linkRes.content, "/tmp/repl_linked.jmvm");
  if (!compRes.success) throw new Error(`retagcomp.jmvm mislukt:\n${compRes.output}`);

  const rawOutput = await runJmvmCapture(compRes.content);
  const shown = replExtractOutput(rawOutput);
  return shown || "(geen uitvoer)";
}

async function replCommit(line) {
  const name = `res${replSession.resCounter}`;
  await replSetEntries([[name, `${name} = ${line}`], ["it", `it = ${name}`]], replSession.resCounter + 1);
  return name;
}

async function replDefine(defText) {
  const name = replExtractDefName(defText);
  await replSetEntries([[name, defText]]);
  return name;
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
        const pre = await preprocessSpp(msg.source, "/workspace/notebook.spp");
        if (!pre.success) {
          postMessage({ type: "NOTEBOOK_RESULT", id: msg.id, success: false, stage: "preprocess", error: pre.stdout });
          break;
        }
        const comp = await compileSapl(pre.files[0].content, "/tmp/notebook.cfp", ["jmvm"], true);
        const jm = comp.success && comp.files.find((f) => f.name.endsWith(".jmvm"));
        if (!jm) {
          postMessage({ type: "NOTEBOOK_RESULT", id: msg.id, success: false, stage: "compile", error: comp.error || comp.stderr || comp.stdout });
          break;
        }
        // runJmvmCapture levert één teken per byte; een notebook toont
        // gewone tekst (°, emoji), dus als UTF-8 terugdecoderen.
        const raw = await runJmvmCapture(jm.content);
        const output = new TextDecoder().decode(Uint8Array.from(raw, (ch) => ch.charCodeAt(0) & 255));
        postMessage({ type: "NOTEBOOK_RESULT", id: msg.id, success: true, output });
      } catch (err) {
        postMessage({ type: "NOTEBOOK_RESULT", id: msg.id, success: false, stage: "worker", error: err.message });
      }
      break;

    case "REPL_INIT":
      try {
        await replInit();
        postMessage({ type: "REPL_RESULT", id: msg.id, success: true, kind: "init" });
      } catch (err) {
        postMessage({ type: "REPL_RESULT", id: msg.id, success: false, error: err.message });
      }
      break;

    case "REPL_EVAL":
      try {
        if (!replSession) await replInit();
        let payload = {};
        switch (msg.cmd) {
          case "eval": {
            const output = await replEvalLine(msg.line);
            const name = await replCommit(msg.line);
            payload = { output, name };
            break;
          }
          case "def": {
            const name = await replDefine(msg.text);
            payload = { name };
            break;
          }
          case "history":
            payload = { entries: replSession.entries.map((e) => ({ name: e.name, text: e.text })) };
            break;
          case "undo":
            await replUndo();
            break;
          case "reset":
            await replReset();
            break;
          case "funcs":
            payload = { funcs: replFuncs() };
            break;
          case "type":
            payload = await replTypeOf(msg.expr);
            break;
          case "load": {
            const notes = [];
            const names = await replLoadContent(msg.content, notes);
            payload = { names, notes };
            break;
          }
          case "save":
            payload = { content: replJoinEntries(replSession.entries) };
            break;
          default:
            throw new Error(`onbekend REPL-commando: ${msg.cmd}`);
        }
        postMessage({ type: "REPL_RESULT", id: msg.id, success: true, cmd: msg.cmd, ...payload });
      } catch (err) {
        postMessage({ type: "REPL_RESULT", id: msg.id, success: false, cmd: msg.cmd, error: err.message });
      }
      break;

    default:
      console.warn("Unknown worker message type:", msg.type);
  }
};
