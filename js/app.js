/**
 * WebSapl Main Application Coordinator
 */

document.addEventListener("DOMContentLoaded", () => {
  const app = new WebSaplApp();
  app.init();
});

class WebSaplApp {
  constructor() {
    this.worker = null;
    this.editor = null;
    this.fileTree = null;
    this.terminal = null;
    this.metrics = null;
    this.benchmarkSuite = null;

    this.currentTheme = localStorage.getItem("websapl_theme") || "light";
    this.currentView = "editor"; // "editor" | "benchmarks"
    this.isFocusMode = false;
    this.isRunning = false;
  }

  async init() {
    this.initDOM();
    this.initComponents();
    this.setTheme(this.currentTheme);
    this.initWorker();
    this.initShortcuts();
  }

  initDOM() {
    // Toolbar elements
    this.btnRun = document.getElementById("btn-run");
    this.btnCompile = document.getElementById("btn-compile");
    this.btnSave = document.getElementById("btn-save");
    this.btnNew = document.getElementById("btn-new");
    this.btnFocusMode = document.getElementById("btn-focus-mode");
    this.btnViewEditor = document.getElementById("btn-view-editor");
    this.btnViewBenchmarks = document.getElementById("btn-view-benchmarks");
    this.selectExample = document.getElementById("select-example");
    this.btnThemeToggle = document.getElementById("btn-theme-toggle");
    this.themeIcon = document.getElementById("theme-icon");
    this.themeText = document.getElementById("theme-text");
    this.statusIndicator = document.getElementById("status-indicator");
    this.statusText = document.getElementById("status-text");

    // Views
    this.viewEditor = document.getElementById("view-editor");
    this.viewBenchmarks = document.getElementById("view-benchmarks");

    // Toolbar Listeners
    this.btnRun.addEventListener("click", () => this.runCurrent());
    this.btnCompile.addEventListener("click", () => this.compileCurrent());
    this.btnSave.addEventListener("click", () => this.saveCurrent());
    this.btnNew.addEventListener("click", () => this.fileTree.promptNewFile());
    this.btnFocusMode.addEventListener("click", () => this.toggleFocusMode());
    this.btnThemeToggle.addEventListener("click", () => this.toggleTheme());

    this.btnViewEditor.addEventListener("click", () => this.switchView("editor"));
    this.btnViewBenchmarks.addEventListener("click", () => this.switchView("benchmarks"));

    // Populate Examples dropdown
    if (window.EXAMPLES_DATA) {
      window.EXAMPLES_DATA.forEach((ex) => {
        const opt = document.createElement("option");
        opt.value = ex.id;
        opt.textContent = ex.name;
        this.selectExample.appendChild(opt);
      });
    }

    this.selectExample.addEventListener("change", (e) => {
      const exId = e.target.value;
      if (!exId) return;
      const ex = window.EXAMPLES_DATA.find((item) => item.id === exId);
      if (ex) {
        this.editor.openFile(`/examples/${ex.file}`, ex.source, true);
        this.switchView("editor");
      }
      this.selectExample.value = "";
    });
  }

  initComponents() {
    // Terminal
    this.terminal = new SaplTerminal(document.getElementById("terminal-container"));
    this.terminal.append("🚀 Welkom bij WebSapl! De JMVM WebAssembly interpreter wordt geladen...\n", "stdout");

    // Metrics Bar
    this.metrics = new SaplMetrics(document.getElementById("metrics-container"));

    // Code Editor
    this.editor = new SaplEditor(document.getElementById("editor-container"), {
      onChange: () => {},
      onSave: (content, path) => this.saveFile(path, content),
      onRun: () => this.runCurrent()
    });

    // File Tree
    this.fileTree = new SaplFileTree(document.getElementById("filetree-container"), {
      onSelectFile: (path, isReadOnly) => this.loadFile(path, isReadOnly),
      onNewFile: (path) => this.createNewFile(path),
      onDeleteFile: (path) => this.deleteFile(path),
      onUploadFile: (filename, content) => this.uploadFile(filename, content)
    });

    // Benchmark Suite
    this.benchmarkSuite = new SaplBenchmarkSuite(document.getElementById("benchmarks-container"), {
      onRunSingle: async (bench) => {
        return this.runBenchmark(bench);
      },
      onLoadIntoEditor: (path, source) => {
        this.editor.openFile(path, source, true);
        this.switchView("editor");
      }
    });
  }

  initWorker() {
    this.setStatus("loading", "WASM Interpreter initialiseren...");
    this.worker = new Worker("engine/worker.js");

    this.worker.onmessage = (e) => {
      const msg = e.data;
      switch (msg.type) {
        case "INIT_DONE":
          this.setStatus("ready", "Klaar voor uitvoering");
          this.terminal.append("✔ JMVM WebAssembly engine & compiler geladen!\n\n", "stdout");
          this.worker.postMessage({ type: "GET_FILE_TREE" });
          this.loadInitialWorkspace();
          break;

        case "STDOUT":
          this.terminal.append(msg.text, "stdout");
          break;

        case "STDERR":
          this.terminal.append(msg.text, "stderr");
          break;

        case "FILE_TREE":
          this.fileTree.setTreeData({
            workspace: msg.workspace || [],
            benchmarks: msg.benchmarks || [],
            examples: msg.examples || [],
            lib: msg.lib || []
          });
          break;

        case "FILE_CONTENT":
          this.editor.openFile(msg.path, msg.content, msg.path.startsWith("/benchmarks") || msg.path.startsWith("/examples") || msg.path.startsWith("/lib"));
          break;

        case "FILE_WRITTEN":
          this.editor.markSaved(msg.path);
          this.fileTree.setTreeData({ workspace: msg.fileTree });
          this.setStatus("ready", "Bestand opgeslagen");
          break;

        case "FILE_DELETED":
          this.fileTree.setTreeData({ workspace: msg.fileTree });
          this.setStatus("ready", "Bestand verwijderd");
          break;

        case "RUN_COMPLETE":
          this.isRunning = false;
          this.setStatus("ready", "Klaar");
          this.btnRun.disabled = false;
          this.btnRun.innerHTML = `<span class="btn-icon">▶</span> Run`;
          this.metrics.update(msg.metrics);
          if (msg.fileTree) {
            this.fileTree.setTreeData({ workspace: msg.fileTree });
          }
          break;

        case "COMPILE_COMPLETE":
          this.isRunning = false;
          this.setStatus("ready", "Compilatie geslaagd");
          this.btnCompile.disabled = false;
          this.btnCompile.innerHTML = `<span class="btn-icon">⚙</span> Compileer`;
          this.terminal.append(`✔ Compilatie geslaagd in ${msg.compileTimeMs.toFixed(1)}ms!\n📁 Gegenereerde bytecode opgeslagen als: ${msg.path || "output.jmvm"} (${msg.size} bytes)\n\n`, "stdout");
          if (msg.fileTree) {
            this.fileTree.setTreeData({ workspace: msg.fileTree });
          }
          break;

        case "COMPILE_FAILED":
          this.isRunning = false;
          this.setStatus("error", "Compilatie mislukt");
          this.btnRun.disabled = false;
          this.btnRun.innerHTML = `<span class="btn-icon">▶</span> Run`;
          this.btnCompile.disabled = false;
          this.btnCompile.innerHTML = `<span class="btn-icon">⚙</span> Compileer`;
          break;

        case "ERROR":
          this.isRunning = false;
          this.setStatus("error", "Fout");
          this.terminal.append(`[Fout] ${msg.message}\n`, "stderr");
          this.btnRun.disabled = false;
          this.btnRun.innerHTML = `<span class="btn-icon">▶</span> Run`;
          this.btnCompile.disabled = false;
          this.btnCompile.innerHTML = `<span class="btn-icon">⚙</span> Compileer`;
          break;
      }
    };

    // Send initialization payload
    this.worker.postMessage({
      type: "INIT",
      stdlib: window.STDLIB_DATA || "",
      compilerBase64: window.COMPILER_JMVM_BASE64 || "",
      benchmarks: window.BENCHMARKS_DATA || [],
      examples: window.EXAMPLES_DATA || []
    });
  }

  initShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (e.key === "F5") {
        e.preventDefault();
        this.runCurrent();
      }
    });
  }

  loadInitialWorkspace() {
    const defaultProgram = `|| ==========================================================
|| WebSapl: Luie Functionele Programmeertaal & JMVM WASM IDE
|| ==========================================================

#import "lib/stdlib.cfp"

start = resultaat

|| Recursieve Faculteit
fac !n = if (n == 0) 1 (n * fac (n - 1))

|| Hogere-orde functies op luie lijsten via stdlib
verdubbel n = n * 2
mijnLijst   = Cons 1 (Cons 2 (Cons 3 (Cons 4 (Cons 5 Nil))))
resultaat   = length (map verdubbel mijnLijst)
`;

    // Check if main.cfp already exists in VFS, otherwise write it
    this.loadFile("/workspace/main.cfp", false, defaultProgram);
  }

  loadFile(path, isReadOnly = false, fallbackContent = null) {
    if (this.editor.openTabs.has(path)) {
      this.editor.openFile(path);
      return;
    }
    if (fallbackContent !== null) {
      this.editor.openFile(path, fallbackContent, isReadOnly);
      this.worker.postMessage({ type: "WRITE_FILE", path, content: fallbackContent });
      return;
    }
    this.worker.postMessage({ type: "READ_FILE", path });
  }

  saveFile(path, content) {
    if (!path) return;
    let targetPath = path;
    if (!path.startsWith("/workspace/")) {
      const filename = path.split("/").pop();
      targetPath = `/workspace/${filename}`;
      this.terminal.append(`[Info] Bestand opgeslagen als bewerkbare kopie in ${targetPath}\n`, "stdout");
      this.editor.openFile(targetPath, content, false);
    }
    this.editor.markSaved(targetPath);
    this.setStatus("loading", "Opslaan...");
    this.worker.postMessage({ type: "WRITE_FILE", path: targetPath, content });
  }

  createNewFile(path) {
    const initialContent = `|| ${path.split("/").pop()}\nstart = 42\n`;
    this.worker.postMessage({ type: "WRITE_FILE", path, content: initialContent });
    this.editor.openFile(path, initialContent, false);
  }

  deleteFile(path) {
    this.worker.postMessage({ type: "DELETE_FILE", path });
    if (this.editor.currentFile === path) {
      this.editor.closeTab(path);
    }
  }

  uploadFile(filename, content) {
    const path = `/workspace/${filename}`;
    this.worker.postMessage({ type: "WRITE_FILE", path, content });
    this.editor.openFile(path, content, false);
  }

  saveCurrent() {
    if (this.editor.currentFile) {
      this.saveFile(this.editor.currentFile, this.editor.getValue());
    }
  }

  compileCurrent() {
    if (this.isRunning) return;
    this.saveCurrent();

    // Zorg ervoor dat het onderpaneel (terminal / metrieken) zichtbaar wordt
    if (this.isFocusMode) {
      this.setFocusMode(false);
    }

    const content = this.editor.getValue();
    const path = this.editor.currentFile || "/workspace/main.cfp";

    this.isRunning = true;
    this.btnCompile.disabled = true;
    this.btnCompile.innerHTML = `<span class="btn-icon">⏳</span> Compileren...`;
    this.setStatus("compiling", "Compileren via Sapl compiler...");
    this.metrics.reset();
    this.terminal.append(`\n--- Compilatie gestart voor ${path} ---\n`, "stdout");

    this.worker.postMessage({
      type: "COMPILE",
      source: content,
      path
    });
  }

  runCurrent() {
    if (this.isRunning) return;
    this.saveCurrent();

    // Zorg ervoor dat het onderpaneel (terminal / metrieken) zichtbaar wordt
    if (this.isFocusMode) {
      this.setFocusMode(false);
    }

    const content = this.editor.getValue();
    const path = this.editor.currentFile || "/workspace/main.cfp";

    this.isRunning = true;
    this.btnRun.disabled = true;
    this.btnRun.innerHTML = `<span class="btn-icon">⏳</span> Draait...`;
    this.setStatus("running", "Uitvoeren op JMVM WASM...");
    this.metrics.reset();
    this.terminal.append(`\n================== Start Executie: ${path} ==================\n`, "stdout");

    if (path.endsWith(".jmvm")) {
      this.worker.postMessage({ type: "RUN_BYTECODE", path });
    } else {
      this.worker.postMessage({ type: "COMPILE_AND_RUN", source: content, path });
    }
  }

  async runBenchmark(benchmark) {
    this.terminal.append(`\n[Benchmark] Draaien van ${benchmark.name} (${benchmark.file})...\n`, "stdout");

    return new Promise((resolve, reject) => {
      const onBenchMessage = (e) => {
        const msg = e.data;
        if (msg.type === "RUN_COMPLETE") {
          this.worker.removeEventListener("message", onBenchMessage);
          this.benchmarkSuite.setResult(benchmark.id, {
            timeMs: msg.metrics.elapsedMs,
            instructions: msg.metrics.instructions,
            calls: msg.metrics.calls,
            creates: msg.metrics.creates,
            gcCount: msg.metrics.gcCount,
            output: msg.output,
            res: msg.metrics.res
          });
          resolve(msg.metrics);
        } else if (msg.type === "COMPILE_FAILED" || msg.type === "ERROR") {
          this.worker.removeEventListener("message", onBenchMessage);
          this.benchmarkSuite.setError(benchmark.id, msg.error || msg.message);
          reject(new Error(msg.error || msg.message));
        }
      };

      this.worker.addEventListener("message", onBenchMessage);

      if (benchmark.bytecode) {
        this.worker.postMessage({
          type: "RUN_BYTECODE",
          bytecode: benchmark.bytecode,
          path: `/benchmarks/${benchmark.jmvm}`
        });
      } else {
        this.worker.postMessage({
          type: "COMPILE_AND_RUN",
          source: benchmark.source,
          path: `/benchmarks/${benchmark.file}`
        });
      }
    });
  }

  switchView(viewName) {
    this.currentView = viewName;
    if (viewName === "editor") {
      this.viewEditor.style.display = "flex";
      this.viewBenchmarks.style.display = "none";
      this.btnViewEditor.classList.add("active");
      this.btnViewBenchmarks.classList.remove("active");
    } else {
      this.viewEditor.style.display = "none";
      this.viewBenchmarks.style.display = "block";
      this.btnViewEditor.classList.remove("active");
      this.btnViewBenchmarks.classList.add("active");
    }
  }

  setTheme(theme) {
    this.currentTheme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("websapl_theme", theme);

    if (this.themeIcon && this.themeText) {
      if (theme === "light") {
        this.themeIcon.textContent = "🌙";
        this.themeText.textContent = "Dark";
        this.btnThemeToggle.title = "Schakel over naar Dark Mode";
      } else {
        this.themeIcon.textContent = "☀️";
        this.themeText.textContent = "Light";
        this.btnThemeToggle.title = "Schakel over naar Light Mode";
      }
    }

    if (this.editor) {
      this.editor.setTheme(theme);
    }
  }

  setFocusMode(enable) {
    this.isFocusMode = enable;
    if (enable) {
      document.body.classList.add("focus-mode");
      if (this.btnFocusMode) {
        this.btnFocusMode.classList.add("active");
        this.btnFocusMode.title = "Herstel standaard weergave (toon zijbalk en onderpaneel)";
      }
    } else {
      document.body.classList.remove("focus-mode");
      if (this.btnFocusMode) {
        this.btnFocusMode.classList.remove("active");
        this.btnFocusMode.title = "Focusmodus: Alleen editor (verberg zijbalk en onderpaneel)";
      }
    }
    if (this.editor) {
      this.editor.refresh();
    }
  }

  toggleFocusMode() {
    this.setFocusMode(!this.isFocusMode);
  }

  setStatus(type, text) {
    this.statusText.textContent = text;
    this.statusIndicator.className = `status-dot ${type}`;
  }
}

window.WebSaplApp = WebSaplApp;
