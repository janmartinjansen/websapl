/**
 * WebSapl Dedicated Web Worker
 * Runs the JMVM WebAssembly runtime and the self-hosted Sapl compiler (saplcomp.jmvm).
 * Interacts with Emscripten VFS (MEMFS + IDBFS) and streams stdout/stderr/metrics.
 */

// In Web Worker context
let jmvmModule = null;
let isInitialized = false;
let isExecuting = false;

// Stdlib and compiler bytecode cache
let stdlibContent = "";
let compilerBytecode = null;

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
    // Ignore full-line || comments
    if (trimmed.startsWith("||")) {
      continue;
    }

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
          throw new Error(`Imported file not found: ${importPath} (${resolvedPath})`);
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
  if (isInitialized && jmvmModule) return;

  if (typeof importScripts === "function") {
    importScripts("./jmvm.js");
  }

  stdlibContent = data.stdlib || "";
  if (data.compilerBase64) {
    compilerBytecode = base64ToUint8Array(data.compilerBase64);
  }

  jmvmModule = await createJMVMModule({
    locateFile: (path, prefix) => {
      if (path.endsWith(".wasm")) return "./jmvm.wasm";
      return (prefix || "") + path;
    }
  });

  // Setup directory structure
  try {
    if (!jmvmModule.FS.analyzePath("/workspace").exists) jmvmModule.FS.mkdir("/workspace");
    if (!jmvmModule.FS.analyzePath("/lib").exists) jmvmModule.FS.mkdir("/lib");
    if (!jmvmModule.FS.analyzePath("/benchmarks").exists) jmvmModule.FS.mkdir("/benchmarks");
    if (!jmvmModule.FS.analyzePath("/examples").exists) jmvmModule.FS.mkdir("/examples");
    if (!jmvmModule.FS.analyzePath("/tmp").exists) jmvmModule.FS.mkdir("/tmp");
  } catch (e) {
    // Directories might exist
  }

  // Mount IDBFS for persistent /workspace if available in browser
  try {
    if (jmvmModule.FS.filesystems && jmvmModule.FS.filesystems.IDBFS) {
      jmvmModule.FS.mount(jmvmModule.FS.filesystems.IDBFS, {}, "/workspace");
      await new Promise((resolve) => {
        jmvmModule.FS.syncfs(true, (err) => {
          if (err) console.warn("IDBFS initial sync error:", err);
          resolve();
        });
      });
    }
  } catch (e) {
    console.warn("IDBFS mount not available, using MEMFS:", e.message);
  }

  // Write stdlib into /lib/stdlib.cfp
  if (stdlibContent) {
    jmvmModule.FS.writeFile("/lib/stdlib.cfp", stdlibContent);
  }

  // Write compiler into /saplcomp.jmvm
  if (compilerBytecode) {
    jmvmModule.FS.writeFile("/saplcomp.jmvm", compilerBytecode);
  }

  // Write pre-bundled benchmarks and examples into VFS
  if (data.benchmarks) {
    for (const b of data.benchmarks) {
      if (b.source) jmvmModule.FS.writeFile(`/benchmarks/${b.file}`, b.source);
      if (b.bytecode) jmvmModule.FS.writeFile(`/benchmarks/${b.jmvm}`, b.bytecode);
    }
  }

  if (data.examples) {
    for (const e of data.examples) {
      if (e.source) jmvmModule.FS.writeFile(`/examples/${e.file}`, e.source);
      if (e.bytecode) jmvmModule.FS.writeFile(`/examples/${e.jmvm}`, e.bytecode);
    }
  }

  isInitialized = true;
  postMessage({ type: "INIT_DONE" });
}

/**
 * Scan workspace files recursively
 */
function scanDir(dirPath) {
  const result = [];
  try {
    const entries = jmvmModule.FS.readdir(dirPath);
    for (const entry of entries) {
      if (entry === "." || entry === "..") continue;
      const fullPath = (dirPath === "/" ? "" : dirPath) + "/" + entry;
      const stat = jmvmModule.FS.stat(fullPath);
      const isDir = jmvmModule.FS.isDir(stat.mode);
      if (isDir) {
        result.push({
          name: entry,
          path: fullPath,
          isDir: true,
          children: scanDir(fullPath)
        });
      } else {
        result.push({
          name: entry,
          path: fullPath,
          isDir: false,
          size: stat.size,
          mtime: stat.mtime
        });
      }
    }
  } catch (e) {
    // Ignore error on reading
  }
  return result;
}

/**
 * Compile a Sapl source code string to .jmvm bytecode
 */
async function compileSapl(sourceCode, srcPath = "/workspace/main.cfp") {
  if (!isInitialized) throw new Error("JMVM engine is not initialized yet.");

  postMessage({ type: "STDOUT", text: `[Compiler] Resolving imports and preprocessing...\n` });

  // 1. Resolve imports
  let flattenedSource;
  try {
    flattenedSource = resolveImports(sourceCode, srcPath);
  } catch (err) {
    postMessage({ type: "STDERR", text: `[Compiler Error] ${err.message}\n` });
    return { success: false, error: err.message };
  }

  // 2. Write flattened source to /tmp/compile_input.cfp
  jmvmModule.FS.writeFile("/tmp/compile_input.cfp", flattenedSource);
  try {
    jmvmModule.FS.unlink("/tmp/compile_output.jmvm");
  } catch (e) {}

  // 3. Create fresh instance or run compiler
  let compilerOutput = [];
  const stdinStr = "/tmp/compile_input.cfp\n/tmp/compile_output.jmvm\n";
  let stdinPos = 0;

  const compilerInstance = await createJMVMModule({
    locateFile: (path, prefix) => {
      if (path.endsWith(".wasm")) return "./jmvm.wasm";
      return (prefix || "") + path;
    },
    stdin: () => {
      if (stdinPos < stdinStr.length) return stdinStr.charCodeAt(stdinPos++);
      return null;
    },
    stdout: (charCode) => {
      compilerOutput.push(String.fromCharCode(charCode));
    },
    stderr: (charCode) => {
      compilerOutput.push(String.fromCharCode(charCode));
    }
  });

  // Mount existing VFS files into the compiler instance
  compilerInstance.FS.writeFile("/saplcomp.jmvm", compilerBytecode);
  compilerInstance.FS.writeFile("/tmp/compile_input.cfp", flattenedSource);

  const startTime = performance.now();
  postMessage({ type: "STDOUT", text: `[Compiler] Compiling via self-hosted saplcomp.jmvm...\n` });

  try {
    compilerInstance.callMain(["/saplcomp.jmvm"]);
  } catch (e) {
    // Normal exit throws
  }
  const compileTimeMs = performance.now() - startTime;
  const compilerText = compilerOutput.join("");

  const outExists = compilerInstance.FS.analyzePath("/tmp/compile_output.jmvm").exists;
  if (!outExists) {
    postMessage({ type: "STDERR", text: `[Compiler Error] Compilation failed:\n${compilerText}\n` });
    return { success: false, error: compilerText };
  }

  const jmvmBytecode = compilerInstance.FS.readFile("/tmp/compile_output.jmvm");
  postMessage({
    type: "STDOUT",
    text: `[Compiler] Success! Generated ${jmvmBytecode.length} bytes bytecode in ${compileTimeMs.toFixed(1)}ms.\n\n`
  });

  // Also store in main VFS
  jmvmModule.FS.writeFile("/tmp/compile_output.jmvm", jmvmBytecode);

  return {
    success: true,
    bytecode: jmvmBytecode,
    compileTimeMs
  };
}

/**
 * Execute a compiled .jmvm file or bytecode on JMVM WASM
 */
async function executeJmvm(bytecodeOrPath, isPath = false) {
  if (!isInitialized) throw new Error("JMVM engine is not initialized.");

  isExecuting = true;
  const targetPath = isPath ? bytecodeOrPath : "/tmp/run.jmvm";

  let outText = "";
  let fullOutput = [];
  let metrics = {
    res: null,
    elapsedSec: 0,
    elapsedMs: 0,
    instructions: 0,
    calls: 0,
    creates: 0,
    gcCount: 0
  };

  const execInstance = await createJMVMModule({
    locateFile: (path, prefix) => {
      if (path.endsWith(".wasm")) return "./jmvm.wasm";
      return (prefix || "") + path;
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

  // Ensure base directories exist in execution instance
  const baseDirs = ["/workspace", "/lib", "/benchmarks", "/examples", "/tmp"];
  for (const dir of baseDirs) {
    try {
      if (!execInstance.FS.analyzePath(dir).exists) {
        execInstance.FS.mkdir(dir);
      }
    } catch (_) {}
  }

  // Copy /workspace and /tmp files to the execution instance
  function copyVfsTree(srcFs, destFs, path) {
    try {
      const entries = srcFs.readdir(path);
      for (const e of entries) {
        if (e === "." || e === "..") continue;
        const sub = (path === "/" ? "" : path) + "/" + e;
        const stat = srcFs.stat(sub);
        if (srcFs.isDir(stat.mode)) {
          try {
            if (!destFs.analyzePath(sub).exists) destFs.mkdir(sub);
          } catch (_) {}
          copyVfsTree(srcFs, destFs, sub);
        } else {
          try {
            const data = srcFs.readFile(sub);
            destFs.writeFile(sub, data);
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  copyVfsTree(jmvmModule.FS, execInstance.FS, "/workspace");
  copyVfsTree(jmvmModule.FS, execInstance.FS, "/lib");
  copyVfsTree(jmvmModule.FS, execInstance.FS, "/benchmarks");
  copyVfsTree(jmvmModule.FS, execInstance.FS, "/examples");

  if (!isPath) {
    execInstance.FS.writeFile(targetPath, bytecodeOrPath);
  } else if (typeof bytecodeOrPath === "string" && !execInstance.FS.analyzePath(targetPath).exists) {
    if (jmvmModule.FS.analyzePath(targetPath).exists) {
      execInstance.FS.writeFile(targetPath, jmvmModule.FS.readFile(targetPath));
    }
  }

  const startTime = performance.now();
  postMessage({ type: "STDOUT", text: `[VM] Starting execution for ${targetPath}...\n` });

  try {
    execInstance.callMain([targetPath]);
  } catch (e) {
    // Normal exit terminates with exception
  }

  if (outText.length > 0) {
    postMessage({ type: "STDOUT", text: outText + "\n" });
  }

  const totalTimeMs = performance.now() - startTime;
  const rawOutput = fullOutput.join("");

  // Parse statistics from JMVM output
  const resMatch = rawOutput.match(/res:\s*([^\n\r]+)/);
  if (resMatch) metrics.res = resMatch[1].trim();

  const timeMatch = rawOutput.match(/Elapsed time:\s*([0-9.]+)\s*secs/);
  if (timeMatch) metrics.elapsedSec = parseFloat(timeMatch[1]);
  metrics.elapsedMs = totalTimeMs;

  const instrMatch = rawOutput.match(/instr executed:\s*([0-9]+)/);
  if (instrMatch) metrics.instructions = parseInt(instrMatch[1], 10);

  const callsMatch = rawOutput.match(/calls:\s*([0-9]+)/);
  if (callsMatch) metrics.calls = parseInt(callsMatch[1], 10);

  const createsMatch = rawOutput.match(/creates:\s*([0-9]+)/);
  if (createsMatch) metrics.creates = parseInt(createsMatch[1], 10);

  const gcMatch = rawOutput.match(/nr gc:\s*([0-9]+)/);
  if (gcMatch) metrics.gcCount = parseInt(gcMatch[1], 10);

  // Sync any newly created files in workspace back to main VFS and IndexedDB
  copyVfsTree(execInstance.FS, jmvmModule.FS, "/workspace");
  try {
    // Also copy files written in current directory
    const rootEntries = execInstance.FS.readdir("/");
    for (const re of rootEntries) {
      if (re === "." || re === ".." || re === "workspace" || re === "lib" || re === "tmp" || re === "benchmarks" || re === "examples" || re === "dev" || re === "proc") continue;
      const stat = execInstance.FS.stat("/" + re);
      if (!execInstance.FS.isDir(stat.mode)) {
        const data = execInstance.FS.readFile("/" + re);
        jmvmModule.FS.writeFile("/workspace/" + re, data);
      }
    }
  } catch (_) {}

  // Sync IDBFS if present
  try {
    jmvmModule.FS.syncfs(false, () => {});
  } catch (_) {}

  isExecuting = false;
  postMessage({
    type: "RUN_COMPLETE",
    metrics,
    output: rawOutput,
    fileTree: scanDir("/workspace")
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

    case "GET_FILE_TREE":
      postMessage({
        type: "FILE_TREE",
        workspace: scanDir("/workspace"),
        benchmarks: scanDir("/benchmarks"),
        examples: scanDir("/examples"),
        lib: scanDir("/lib")
      });
      break;

    case "READ_FILE":
      try {
        const content = jmvmModule.FS.readFile(msg.path, { encoding: "utf8" });
        postMessage({ type: "FILE_CONTENT", path: msg.path, content });
      } catch (err) {
        postMessage({ type: "ERROR", message: `Cannot read file ${msg.path}: ${err.message}` });
      }
      break;

    case "WRITE_FILE":
      try {
        jmvmModule.FS.writeFile(msg.path, msg.content);
        if (msg.path.startsWith("/workspace")) {
          jmvmModule.FS.syncfs(false, () => {});
        }
        postMessage({
          type: "FILE_WRITTEN",
          path: msg.path,
          fileTree: scanDir("/workspace")
        });
      } catch (err) {
        postMessage({ type: "ERROR", message: `Cannot write file ${msg.path}: ${err.message}` });
      }
      break;

    case "DELETE_FILE":
      try {
        jmvmModule.FS.unlink(msg.path);
        jmvmModule.FS.syncfs(false, () => {});
        postMessage({
          type: "FILE_DELETED",
          path: msg.path,
          fileTree: scanDir("/workspace")
        });
      } catch (err) {
        postMessage({ type: "ERROR", message: `Cannot delete file ${msg.path}: ${err.message}` });
      }
      break;

    case "COMPILE":
      try {
        const srcPath = msg.path || "/workspace/main.cfp";
        const compRes = await compileSapl(msg.source, srcPath);
        if (compRes.success) {
          let outPath = null;
          if (srcPath.endsWith(".cfp")) {
            outPath = srcPath.substring(0, srcPath.length - 4) + ".jmvm";
            jmvmModule.FS.writeFile(outPath, compRes.bytecode);
            if (outPath.startsWith("/workspace")) {
              jmvmModule.FS.syncfs(false, () => {});
            }
          }
          postMessage({
            type: "COMPILE_COMPLETE",
            path: outPath,
            bytecodeText: new TextDecoder().decode(compRes.bytecode),
            size: compRes.bytecode.length,
            compileTimeMs: compRes.compileTimeMs,
            fileTree: scanDir("/workspace")
          });
        } else {
          postMessage({ type: "COMPILE_FAILED", error: compRes.error });
        }
      } catch (err) {
        postMessage({ type: "ERROR", message: err.message });
      }
      break;

    case "COMPILE_AND_RUN":
      try {
        const compRes = await compileSapl(msg.source, msg.path || "/workspace/main.cfp");
        if (compRes.success) {
          await executeJmvm(compRes.bytecode, false);
        } else {
          postMessage({ type: "COMPILE_FAILED", error: compRes.error });
        }
      } catch (err) {
        postMessage({ type: "ERROR", message: err.message });
      }
      break;

    case "RUN_BYTECODE":
      try {
        if (msg.path) {
          await executeJmvm(msg.path, true);
        } else if (msg.bytecode) {
          await executeJmvm(msg.bytecode, false);
        }
      } catch (err) {
        postMessage({ type: "ERROR", message: err.message });
      }
      break;

    case "SYNC_FS":
      try {
        jmvmModule.FS.syncfs(false, (err) => {
          postMessage({ type: "SYNC_DONE", error: err ? err.message : null });
        });
      } catch (err) {
        postMessage({ type: "SYNC_DONE", error: err.message });
      }
      break;

    default:
      console.warn("Unknown worker message type:", msg.type);
  }
};
