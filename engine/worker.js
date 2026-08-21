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
async function initEngine(data) {
  if (isInitialized && jmvmModule) {
    postMessage({ type: "INIT_DONE" });
    return;
  }

  if (typeof importScripts === "function") {
    importScripts("./jmvm.js");
  }

  stdlibContent = data.stdlib || "";
  if (!stdlibContent) {
    try {
      const res = await fetch("../lib/stdlib.cfp");
      if (res.ok) stdlibContent = await res.text();
    } catch (_) {}
  }

  if (data.saplcompBase64) {
    saplcompBytecode = base64ToUint8Array(data.saplcompBase64);
  } else {
    try {
      const res = await fetch("./saplcomp.jmvm");
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
      const res = await fetch("./retagcomp.jmvm");
      if (res.ok) {
        const buf = await res.arrayBuffer();
        retagcompBytecode = new Uint8Array(buf);
      }
    } catch (_) {}
  }

  jmvmModule = await createJMVMModule({
    locateFile: (p, prefix) => (p.endsWith(".wasm") ? "./jmvm.wasm" : (prefix || "") + p)
  });

  // Setup directory structure
  const dirs = ["/workspace", "/lib", "/benchmarks", "/examples", "/paper_examples", "/tmp"];
  for (const d of dirs) {
    try {
      if (!jmvmModule.FS.analyzePath(d).exists) jmvmModule.FS.mkdir(d);
    } catch (_) {}
  }

  // Write stdlib into /lib/stdlib.cfp
  if (stdlibContent) {
    jmvmModule.FS.writeFile("/lib/stdlib.cfp", stdlibContent);
  }

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
 * Execute a compiled .jmvm file on JMVM WASM
 */
async function executeJmvm(contentOrPath, isPath = false, customStdin = "") {
  if (!isInitialized) throw new Error("JMVM engine is not initialized.");

  isExecuting = true;
  const targetPath = isPath ? contentOrPath : "/tmp/run.jmvm";

  let outText = "";
  let fullOutput = [];
  let stdinBuffer = (customStdin || "").split("");
  let stdinIndex = 0;

  const execInstance = await createJMVMModule({
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
  const dirs = ["/workspace", "/lib", "/benchmarks", "/examples", "/paper_examples", "/tmp"];
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

    case "RUN":
      try {
        await executeJmvm(msg.contentOrPath, msg.isPath, msg.stdin || "");
      } catch (err) {
        postMessage({ type: "STDERR", text: `VM Error: ${err.message}\n` });
        postMessage({
          type: "RUN_COMPLETE",
          metrics: { res: "Error", elapsed_time: "0", instr_executed: 0, calls: 0, creates: 0, gc_count: 0 },
          output: err.message
        });
      }
      break;

    default:
      console.warn("Unknown worker message type:", msg.type);
  }
};
