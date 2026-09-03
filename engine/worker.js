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

/**
 * Preprocess #import recursively using VFS and strip || comments for saplcomp
 */
function resolveImports(source, currentFile = "/workspace/main.cfp", seen = new Set()) {
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
          throw new Error(`Imported file not found: ${importPath}`);
        }
      } catch (err) {
        throw new Error(`Failed to resolve import "${importPath}": ${err.message}`);
      }

      const inlined = resolveImports(importedContent, resolvedPath, seen);
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

  // Sapl+ (.spp) #import dependencies -- see the sppDeps declaration above
  // for why these exact repo-root-relative VFS paths matter.
  const sppDepFiles = [
    { url: "../sapl_compiler/newparser_ast.cfp", vfsPath: "/sapl_compiler/newparser_ast.cfp" },
    { url: "../sapl_compiler/lexer2.cfp", vfsPath: "/sapl_compiler/lexer2.cfp" },
    { url: "../sapl_compiler/ast_helpers.cfp", vfsPath: "/sapl_compiler/ast_helpers.cfp" },
    { url: "../sapl_compiler/stage_dump.cfp", vfsPath: "/sapl_compiler/stage_dump.cfp" },
    { url: "../parser_combinators/parsecomb.spp", vfsPath: "/parser_combinators/parsecomb.spp" },
    { url: "../parser_combinators/saplParse.spp", vfsPath: "/parser_combinators/saplParse.spp" },
    { url: "../benchmarks_saplplus/prologlib.spp", vfsPath: "/benchmarks_saplplus/prologlib.spp" }
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
    flattenedSource = resolveImports(source, srcPath);
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
  const depDirs = ["/lib", "/sapl_compiler", "/parser_combinators", "/benchmarks_saplplus"];
  for (const d of depDirs) {
    try {
      if (!instance.FS.analyzePath(d).exists) instance.FS.mkdir(d);
    } catch (_) {}
  }
  instance.FS.writeFile("/lib/stdlib.cfp", stdlibContent);
  for (const [path, content] of Object.entries(sppDeps)) {
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
        const result = await preprocessSpp(msg.source, msg.path);
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

    default:
      console.warn("Unknown worker message type:", msg.type);
  }
};
