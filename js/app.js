/**
 * Sapl Web Workbench - Main Client Application Logic (WebAssembly Edition)
 */

(function() {
  "use strict";

  // Application State
  const state = {
    treeData: [],
    fileMap: new Map(), // path -> { name, ext, content, size, isBinary, rawUrl }
    openTabs: [], // array of { path, name, ext, content, originalContent, isDirty, isPreview, isBinary, rawUrl, viewMode: 'render'|'edit'|'pdf' }
    activeTabPath: null,
    contextMenuTabPath: null,
    editor: null,
    theme: localStorage.getItem("websapl_theme") || "dark",
    worker: null,
    workerReady: false,
    isCompiling: false,
    isRunning: false,
    pendingCompileCallbacks: new Map(),
    compileSeq: 0,

    // REPL panel (zie openReplTab/sendReplLine)
    replInitStarted: false,
    replReady: false,
    replBusy: false
  };

  // DOM Elements
  const el = {
    fileTree: document.getElementById("file-tree"),
    treeSearch: document.getElementById("tree-search"),
    tabsBar: document.getElementById("tabs-bar"),
    editorContainer: document.getElementById("editor-container"),
    markdownPreview: document.getElementById("markdown-preview"),
    pdfPreview: document.getElementById("pdf-preview"),
    pdfFrame: document.getElementById("pdf-frame"),
    fileBreadcrumb: document.getElementById("file-breadcrumb"),
    viewToggleBtn: document.getElementById("btn-view-toggle"),
    statusDot: document.getElementById("status-dot"),
    statusText: document.getElementById("status-text"),
    
    // Tab Context Menu Elements
    tabContextMenu: document.getElementById("tab-context-menu"),
    ctxCloseTab: document.getElementById("ctx-close-tab"),
    ctxCloseOthers: document.getElementById("ctx-close-others"),
    ctxCloseRight: document.getElementById("ctx-close-right"),
    ctxCloseAll: document.getElementById("ctx-close-all"),
    ctxKeepOpen: document.getElementById("ctx-keep-open"),
    ctxSepPin: document.getElementById("ctx-sep-pin"),
    
    // Panels
    appSidebar: document.getElementById("app-sidebar"),
    settingsPanel: document.getElementById("settings-panel"),
    bottomPanel: document.getElementById("bottom-panel"),
    
    // Panel Toggle Buttons
    btnToggleSidebar: document.getElementById("btn-toggle-sidebar"),
    btnCloseSidebar: document.getElementById("btn-close-sidebar"),
    btnToggleTerminal: document.getElementById("btn-toggle-terminal"),
    btnCloseTerminal: document.getElementById("btn-close-terminal"),
    btnToggleSettings: document.getElementById("btn-toggle-settings"),
    btnCloseSettings: document.getElementById("btn-close-settings"),

    // Actions
    btnSave: document.getElementById("btn-save"),
    btnCompile: document.getElementById("btn-compile"),
    btnRun: document.getElementById("btn-run"),
    btnTypecheck: document.getElementById("btn-typecheck"),
    btnCompileRun: document.getElementById("btn-compile-run"),
    btnTheme: document.getElementById("btn-theme-toggle"),
    btnRefreshTree: document.getElementById("btn-refresh-tree"),

    // REPL panel (client-side poort van repl_retag.py, zie engine/worker.js)
    btnOpenRepl: document.getElementById("btn-open-repl"),
    replPanel: document.getElementById("repl-panel"),
    replLog: document.getElementById("repl-log"),
    replStatus: document.getElementById("repl-status"),
    txtReplInput: document.getElementById("txt-repl-input"),
    btnReplSend: document.getElementById("btn-repl-send"),
    btnReplHistory: document.getElementById("btn-repl-history"),
    btnReplUndo: document.getElementById("btn-repl-undo"),
    btnReplFuncs: document.getElementById("btn-repl-funcs"),
    btnReplReset: document.getElementById("btn-repl-reset"),
    selReplExample: document.getElementById("sel-repl-example"),
    txtReplLoad: document.getElementById("txt-repl-load"),
    btnReplLoad: document.getElementById("btn-repl-load"),
    txtReplSave: document.getElementById("txt-repl-save"),
    btnReplSave: document.getElementById("btn-repl-save"),

    // Intermediate Stage Info Section
    sectionStageInfo: document.getElementById("section-stage-info"),
    txtStageInfoBadge: document.getElementById("txt-stage-info-badge"),
    txtStageInfoDesc: document.getElementById("txt-stage-info-desc"),

    // Compiler Settings Sections
    sectionCompilerBackend: document.getElementById("section-compiler-backend"),
    sectionStrictness: document.getElementById("section-strictness"),
    sectionStages: document.getElementById("section-stages"),
    sectionEngine: document.getElementById("section-engine"),

    compilerSapl: document.getElementById("compiler-sapl"),
    compilerRetag: document.getElementById("compiler-retag"),
    compilerModules: document.getElementById("compiler-modules"),
    lblCompilerSapl: document.getElementById("lbl-compiler-sapl"),
    lblCompilerRetag: document.getElementById("lbl-compiler-retag"),
    lblCompilerModules: document.getElementById("lbl-compiler-modules"),

    // Modules (build_modules.py port) Section
    sectionModulesBackend: document.getElementById("section-modules-backend"),
    txtModulesManifest: document.getElementById("txt-modules-manifest"),
    txtModulesEntryFunc: document.getElementById("txt-modules-entry-func"),
    txtModulesScope: document.getElementById("txt-modules-scope"),
    btnModulesSuggest: document.getElementById("btn-modules-suggest"),
    chkStrictness: document.getElementById("chk-strictness"),
    chkStages: {
      parse: document.getElementById("stage-parse"),
      strictness: document.getElementById("stage-strictness"),
      bool: document.getElementById("stage-bool"),
      lazytag: document.getElementById("stage-lazytag"),
      lift: document.getElementById("stage-lift"),
      retag: document.getElementById("stage-retag"),
      jmvm: document.getElementById("stage-jmvm")
    },
    btnSelectAllStages: document.getElementById("btn-select-all-stages"),
    btnSelectJmvmOnly: document.getElementById("btn-select-jmvm-only"),
    
    // Bottom Panel & Terminal
    terminalContent: document.getElementById("terminal-content"),
    btnClearTerminal: document.getElementById("btn-clear-terminal"),
    terminalPromptBar: document.getElementById("terminal-prompt-bar"),
    terminalPromptLabel: document.getElementById("terminal-prompt-label"),
    terminalInput: document.getElementById("terminal-input"),
    btnTerminalSend: document.getElementById("btn-terminal-send"),
    
    // Metrics
    metricRes: document.getElementById("metric-res"),
    metricTime: document.getElementById("metric-time"),
    metricInstr: document.getElementById("metric-instr"),
    metricCreates: document.getElementById("metric-creates"),
    metricCalls: document.getElementById("metric-calls"),
    metricGc: document.getElementById("metric-gc")
  };

  // --- INITIALIZATION ---
  async function init() {
    applyTheme(state.theme);
    initCodeMirror();
    setupEventListeners();
    initWorker();
    await loadTreeData();
    showWelcomeMessage();
    renderTree();

    // Default: open the usage guide (README.md) so a first-time visitor
    // sees how to use the editor before anything else, rather than landing
    // straight in a random code example.
    setTimeout(() => {
      if (state.fileMap.has("README.md")) {
        openFile("README.md", { preview: false });
      } else if (state.fileMap.has("paper_examples/01_fac.cfp")) {
        openFile("paper_examples/01_fac.cfp", { preview: false });
      }
    }, 150);
  }

  // --- THEME ---
  function applyTheme(themeName) {
    state.theme = themeName;
    document.documentElement.setAttribute("data-theme", themeName);
    localStorage.setItem("websapl_theme", themeName);
    if (el.btnTheme) {
      el.btnTheme.textContent = themeName === "dark" ? "☀️ Light" : "🌙 Dark";
    }
  }

  // --- WEB WORKER ---
  function initWorker() {
    state.worker = new Worker("engine/worker.js");

    state.worker.onmessage = function (e) {
      const msg = e.data;
      switch (msg.type) {
        case "INIT_DONE":
          state.workerReady = true;
          logTerminal("✓ WebAssembly JMVM Engine gereed.\n", "success");
          break;

        case "STDOUT":
          logTerminal(msg.text, "normal");
          break;

        case "STDERR":
          logTerminal(msg.text, "warning");
          break;

        case "COMPILE_COMPLETE":
          state.isCompiling = false;
          const cb = state.pendingCompileCallbacks.get(msg.id);
          if (cb) {
            state.pendingCompileCallbacks.delete(msg.id);
            cb(msg);
          }
          break;

        case "REPL_RESULT": {
          const replCb = state.pendingCompileCallbacks.get(msg.id);
          if (replCb) {
            state.pendingCompileCallbacks.delete(msg.id);
            replCb(msg);
          }
          break;
        }

        case "RUN_COMPLETE":
          state.isRunning = false;
          setStatus("ready", "Klaar");
          if (msg.metrics) {
            updateMetricsUI(msg.metrics);
          }
          logTerminal(`\n[Uitvoering voltooid]\n`, "info");
          break;

        default:
          break;
      }
    };

    state.worker.postMessage({
      type: "INIT",
      stdlib: window.STDLIB_DATA || ""
    });
  }

  // --- CODEMIRROR SETUP ---
  function initCodeMirror() {
    state.editor = CodeMirror(el.editorContainer, {
      value: "",
      mode: "sapl",
      theme: "default",
      lineNumbers: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      tabSize: 2,
      indentUnit: 2,
      lineWrapping: false
    });

    state.editor.on("change", () => {
      const activeTab = getActiveTab();
      if (!activeTab) return;

      const currentVal = state.editor.getValue();
      const isDirty = (currentVal !== activeTab.originalContent);
      if (activeTab.isDirty !== isDirty) {
        activeTab.isDirty = isDirty;
        if (isDirty) {
          activeTab.isPreview = false;
        }
        activeTab.content = currentVal;
        renderTabs();
      } else {
        activeTab.content = currentVal;
      }
      setStatus(isDirty ? "busy" : "ready", isDirty ? "Aangepast" : "Klaar");
    });
  }

  // --- TREE DATA & FILE MAP ---
  async function loadTreeData() {
    if (window.WEBSAPL_TREE && Array.isArray(window.WEBSAPL_TREE)) {
      state.treeData = window.WEBSAPL_TREE;
    } else {
      try {
        const res = await fetch("manifest.json");
        if (res.ok) {
          const data = await res.json();
          state.treeData = data.tree || [];
        }
      } catch (err) {
        console.warn("Failed to fetch manifest.json:", err);
      }
    }

    state.fileMap.clear();
    function indexNodes(nodes) {
      for (const n of nodes) {
        if (n.type === "file") {
          state.fileMap.set(n.path, n);
        } else if (n.type === "directory" && n.children) {
          indexNodes(n.children);
        }
      }
    }
    indexNodes(state.treeData);

    // Also load user files from LocalStorage
    try {
      const userFilesJson = localStorage.getItem("websapl_user_files");
      if (userFilesJson) {
        const userFiles = JSON.parse(userFilesJson);
        for (const [p, content] of Object.entries(userFiles)) {
          const name = pathBasename(p);
          const ext = pathExt(name);
          const fileObj = { name, path: p, type: "file", ext, content, size: content.length, isBinary: false };
          state.fileMap.set(p, fileObj);
          insertIntoTree(state.treeData, fileObj);
        }
      }
    } catch (_) {}
  }

  function insertIntoTree(tree, fileObj) {
    const parts = fileObj.path.split("/");
    if (parts.length === 1) {
      const idx = tree.findIndex(n => n.path === fileObj.path);
      if (idx >= 0) tree[idx] = fileObj;
      else tree.push(fileObj);
      return;
    }
    const folderName = parts[0];
    let folder = tree.find(n => n.type === "directory" && n.name === folderName);
    if (!folder) {
      folder = { name: folderName, path: folderName, type: "directory", children: [], _expanded: true };
      tree.unshift(folder);
    }
    const subPath = parts.slice(1).join("/");
    insertIntoTree(folder.children, { ...fileObj, path: subPath });
  }

  // --- TAB MANAGEMENT ---
  function getActiveTab() {
    return state.openTabs.find(t => t.path === state.activeTabPath);
  }

  // De REPL-tab is een synthetische entry in openTabs, zonder backend-
  // bestand -- elke bestand-georiënteerde actie (compileren/opslaan/
  // draaien) moet zich hiertegen wapenen, net als Workbench's Linter/
  // Debugger/REPL-tool-tabs (zie workbench/js/app.js's isToolTab).
  function isToolTab(tab) {
    return !!tab && !!tab.kind;
  }

  async function openFile(filePath, options = {}) {
    const isPreview = (options.preview === true);

    const existingIdx = state.openTabs.findIndex(t => t.path === filePath);
    if (existingIdx >= 0) {
      if (!isPreview && state.openTabs[existingIdx].isPreview) {
        state.openTabs[existingIdx].isPreview = false;
      }
      setActiveTab(filePath);
      return;
    }

    let fileObj = state.fileMap.get(filePath);
    let content = fileObj ? fileObj.content : null;

    if (content === null || content === undefined) {
      const userFiles = JSON.parse(localStorage.getItem("websapl_user_files") || "{}");
      if (userFiles[filePath] !== undefined) {
        content = userFiles[filePath];
      }
    }

    const name = pathBasename(filePath);
    const ext = pathExt(name);
    const isBinary = (ext === ".pdf" || ext === ".wasm");

    if (content === null || content === undefined) {
      if (!isBinary) {
        try {
          const res = await fetch(filePath);
          if (res.ok) {
            content = await res.text();
          } else {
            content = `// Bestand niet gevonden: ${filePath}`;
          }
        } catch (err) {
          content = `// Fout bij laden: ${err.message}`;
        }
      } else {
        content = "";
      }
    }

    fileObj = {
      path: filePath,
      name: name,
      ext: ext,
      content: content,
      size: content ? content.length : 0,
      isBinary: isBinary,
      rawUrl: filePath
    };
    state.fileMap.set(filePath, fileObj);

    if (isPreview) {
      const previewIdx = state.openTabs.findIndex(t => t.isPreview && !t.isDirty);
      if (previewIdx >= 0) {
        state.openTabs.splice(previewIdx, 1);
      }
    }

    const newTab = {
      path: filePath,
      name: name,
      ext: ext,
      content: content,
      originalContent: content,
      isDirty: false,
      isPreview: isPreview,
      viewMode: ext === ".md" ? "render" : "edit",
      isBinary: isBinary,
      rawUrl: filePath
    };

    state.openTabs.push(newTab);
    setActiveTab(filePath);
  }

  function setActiveTab(filePath) {
    state.activeTabPath = filePath;
    renderTabs();

    const tab = getActiveTab();
    if (!tab) {
      el.fileBreadcrumb.textContent = "Geen bestand geopend";
      setStatus("ready", "Klaar");
      state.editor.setValue("");
      return;
    }

    if (isToolTab(tab)) {
      // Tool-tab (REPL): geen backend-bestand -- editor/markdown/pdf-
      // wisseling en updateCompilerConfigForFile overslaan.
      el.fileBreadcrumb.textContent = tab.name;
      setStatus("ready", "Klaar");
      if (el.editorContainer) el.editorContainer.style.display = "none";
      if (el.markdownPreview) el.markdownPreview.style.display = "none";
      if (el.pdfPreview) el.pdfPreview.style.display = "none";
      if (el.viewToggleBtn) el.viewToggleBtn.style.display = "none";
      if (el.replPanel) {
        el.replPanel.style.display = tab.kind === "repl" ? "flex" : "none";
        if (tab.kind === "repl") scrollReplLogToBottom();
      }
      return;
    }
    if (el.replPanel) el.replPanel.style.display = "none";

    el.fileBreadcrumb.textContent = tab.path;
    setStatus("ready", tab.isDirty ? "Aangepast" : "Klaar");

    if (tab.ext === ".pdf") {
      if (el.editorContainer) el.editorContainer.style.display = "none";
      if (el.markdownPreview) el.markdownPreview.style.display = "none";
      if (el.viewToggleBtn) el.viewToggleBtn.style.display = "none";
      if (el.pdfPreview) {
        el.pdfPreview.style.display = "block";
        if (el.pdfFrame) {
          el.pdfFrame.src = tab.rawUrl || tab.path;
        }
      }
    } else if (tab.ext === ".md" && tab.viewMode === "render") {
      if (el.pdfPreview) el.pdfPreview.style.display = "none";
      if (el.editorContainer) el.editorContainer.style.display = "none";
      if (el.markdownPreview) {
        el.markdownPreview.style.display = "block";
        renderMarkdown(tab.content);
      }
      if (el.viewToggleBtn) {
        el.viewToggleBtn.style.display = "inline-flex";
        el.viewToggleBtn.textContent = "📝 Broncode bewerken";
      }
    } else {
      if (el.pdfPreview) el.pdfPreview.style.display = "none";
      if (el.markdownPreview) el.markdownPreview.style.display = "none";
      if (el.editorContainer) el.editorContainer.style.display = "block";

      if (tab.ext === ".md") {
        if (el.viewToggleBtn) {
          el.viewToggleBtn.style.display = "inline-flex";
          el.viewToggleBtn.textContent = "📖 Markdown bekijken";
        }
      } else {
        if (el.viewToggleBtn) el.viewToggleBtn.style.display = "none";
      }

      state.editor.setValue(tab.content);
      state.editor.clearHistory();

      if (tab.ext === ".cfp" || tab.ext.startsWith(".cfp_") || tab.ext === ".spp" || tab.ext === ".lfp") {
        state.editor.setOption("mode", "sapl");
      } else if ([".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hh", ".hxx"].includes(tab.ext)) {
        state.editor.setOption("mode", "clike");
      } else {
        state.editor.setOption("mode", "text/plain");
      }

      state.editor.refresh();
      state.editor.focus();
    }

    updateCompilerConfigForFile(tab);
    highlightActiveTreeNode();
  }

  function closeTab(relPath, e) {
    if (e) e.stopPropagation();
    const idx = state.openTabs.findIndex(t => t.path === relPath);
    if (idx === -1) return;

    state.openTabs.splice(idx, 1);
    if (state.activeTabPath === relPath) {
      if (state.openTabs.length > 0) {
        const nextIdx = Math.max(0, idx - 1);
        setActiveTab(state.openTabs[nextIdx].path);
      } else {
        state.activeTabPath = null;
        el.fileBreadcrumb.textContent = "Geen bestand geopend";
        state.editor.setValue("");
        if (el.markdownPreview) el.markdownPreview.innerHTML = "";
        if (el.pdfPreview) el.pdfPreview.style.display = "none";
        if (el.replPanel) el.replPanel.style.display = "none";
        if (el.editorContainer) el.editorContainer.style.display = "block";
      }
    }
    renderTabs();
  }

  function renderTabs() {
    el.tabsBar.innerHTML = "";

    for (const tab of state.openTabs) {
      const tabEl = document.createElement("div");
      tabEl.className = "tab-item" +
        (tab.path === state.activeTabPath ? " active" : "") +
        (tab.isPreview ? " preview" : "");
      tabEl.dataset.path = tab.path;

      const iconInfo = isToolTab(tab) ? { icon: "⌨️", className: "file-icon-tool" } : getFileIcon(tab.name, tab.ext);
      const icon = document.createElement("span");
      icon.className = `tab-icon ${iconInfo.className}`;
      icon.textContent = iconInfo.icon;
      tabEl.appendChild(icon);

      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = tab.name + (tab.isDirty ? " *" : "");
      tabEl.appendChild(title);

      const closeBtn = document.createElement("span");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "✕";
      closeBtn.onclick = (e) => closeTab(tab.path, e);
      tabEl.appendChild(closeBtn);

      tabEl.onclick = () => setActiveTab(tab.path);
      tabEl.ondblclick = () => {
        tab.isPreview = false;
        renderTabs();
      };
      tabEl.oncontextmenu = (e) => {
        e.preventDefault();
        showTabContextMenu(tab.path, e.clientX, e.clientY);
      };

      el.tabsBar.appendChild(tabEl);
    }
  }

  // --- TAB CONTEXT MENU ---
  function showTabContextMenu(tabPath, x, y) {
    state.contextMenuTabPath = tabPath;
    const targetTab = state.openTabs.find(t => t.path === tabPath);

    if (el.ctxKeepOpen && el.ctxSepPin) {
      if (targetTab && targetTab.isPreview) {
        el.ctxKeepOpen.style.display = "flex";
        el.ctxSepPin.style.display = "block";
      } else {
        el.ctxKeepOpen.style.display = "none";
        el.ctxSepPin.style.display = "none";
      }
    }

    el.tabContextMenu.style.display = "block";
    const menuW = el.tabContextMenu.offsetWidth || 210;
    const menuH = el.tabContextMenu.offsetHeight || 190;
    const posX = (x + menuW > window.innerWidth) ? Math.max(10, window.innerWidth - menuW - 10) : x;
    const posY = (y + menuH > window.innerHeight) ? Math.max(10, window.innerHeight - menuH - 10) : y;

    el.tabContextMenu.style.left = `${posX}px`;
    el.tabContextMenu.style.top = `${posY}px`;
  }

  function hideTabContextMenu() {
    if (el.tabContextMenu) el.tabContextMenu.style.display = "none";
    state.contextMenuTabPath = null;
  }

  function closeOtherTabs(targetPath) {
    state.openTabs = state.openTabs.filter(t => t.path === targetPath);
    setActiveTab(targetPath);
  }

  function closeTabsToRight(targetPath) {
    const idx = state.openTabs.findIndex(t => t.path === targetPath);
    if (idx === -1) return;
    state.openTabs = state.openTabs.slice(0, idx + 1);
    if (!state.openTabs.some(t => t.path === state.activeTabPath)) {
      setActiveTab(targetPath);
    }
    renderTabs();
  }

  function closeAllTabs() {
    state.openTabs = [];
    state.activeTabPath = null;
    el.fileBreadcrumb.textContent = "Geen bestand geopend";
    state.editor.setValue("");
    if (el.markdownPreview) el.markdownPreview.innerHTML = "";
    if (el.pdfPreview) el.pdfPreview.style.display = "none";
    if (el.editorContainer) el.editorContainer.style.display = "block";
    renderTabs();
  }

  function keepOpenTab(targetPath) {
    const t = state.openTabs.find(tab => tab.path === targetPath);
    if (t) {
      t.isPreview = false;
      renderTabs();
    }
  }

  function toggleViewMode() {
    const activeTab = getActiveTab();
    if (!activeTab || activeTab.ext !== ".md") return;
    activeTab.viewMode = (activeTab.viewMode === "render") ? "edit" : "render";
    setActiveTab(activeTab.path);
  }

  function renderMarkdown(mdContent) {
    if (window.marked && window.marked.parse) {
      el.markdownPreview.innerHTML = marked.parse(mdContent);
    } else {
      el.markdownPreview.innerHTML = `<pre>${escapeHtml(mdContent)}</pre>`;
    }
  }

  // --- CONTEXT CONFIG ---
  function updateCompilerConfigForFile(tab) {
    if (!tab) return;

    if (tab.name.endsWith(".cfp_retag") || tab.name.endsWith(".cfp_decompiled")) {
      // Retag mode
      if (el.lblCompilerSapl) el.lblCompilerSapl.style.display = "none";
      if (el.lblCompilerRetag) el.lblCompilerRetag.style.display = "flex";
      if (el.compilerRetag) el.compilerRetag.checked = true;

      if (el.btnCompile) {
        el.btnCompile.style.display = "inline-flex";
        el.btnCompile.innerHTML = "<span>⚙️</span> Compileer (Retag → JMVM)";
      }
      if (el.btnCompileRun) {
        el.btnCompileRun.style.display = "inline-flex";
        el.btnCompileRun.innerHTML = "<span>⚡</span> Compileer & Run";
      }
      if (el.btnRun) el.btnRun.style.display = "inline-flex";
      if (el.sectionStageInfo) el.sectionStageInfo.style.display = "none";

      if (el.sectionCompilerBackend) el.sectionCompilerBackend.style.display = "block";
      if (el.sectionStrictness) el.sectionStrictness.style.display = "none";
      if (el.sectionStages) el.sectionStages.style.display = "none";
      if (el.sectionEngine) el.sectionEngine.style.display = "block";
    } else if (tab.ext.startsWith(".cfp_")) {
      // Intermediate inspection stage
      if (el.btnCompile) el.btnCompile.style.display = "none";
      if (el.btnCompileRun) el.btnCompileRun.style.display = "none";
      if (el.btnRun) el.btnRun.style.display = "none";

      if (el.sectionCompilerBackend) el.sectionCompilerBackend.style.display = "none";
      if (el.sectionStrictness) el.sectionStrictness.style.display = "none";
      if (el.sectionStages) el.sectionStages.style.display = "none";
      if (el.sectionEngine) el.sectionEngine.style.display = "none";

      if (el.sectionStageInfo) {
        el.sectionStageInfo.style.display = "block";
        const stageDescMap = {
          ".cfp_parse": { badge: "Stage: Parse AST", desc: "Rauwe post-parse AST direct uit de parser, vóór enige transformatie." },
          ".cfp_strictness": { badge: "Stage: Strictness Analyse", desc: "AST na automatische strictness inferentie (bevat geannoteerde ! argumenten)." },
          ".cfp_bool": { badge: "Stage 1: Boolean Transformatie (bool)", desc: "AST waarin logische operatoren (/\\ en \\/) zijn vertaald naar geneste if-else expressies." },
          ".cfp_lazytag": { badge: "Stage 2: Lazy Tagging (lazytag)", desc: "AST waarin luie argumenten en thunks zijn getagd met 'lazy'." },
          ".cfp_lift": { badge: "Stage 3: Lambda Lifting (lift)", desc: "AST waarin lokale sub-expressies zijn gelift naar top-level hulpfuncties." }
        };
        const info = stageDescMap[tab.ext] || { badge: `Tussenformaat (${tab.ext})`, desc: "Gegenereerd tussenstadium van de compiler pipeline." };
        if (el.txtStageInfoBadge) el.txtStageInfoBadge.textContent = info.badge;
        if (el.txtStageInfoDesc) el.txtStageInfoDesc.textContent = info.desc;
      }
    } else if (tab.ext === ".spp") {
      // Sapl+ source: preprocess to plain .cfp first (preprocess/driver.jmvm,
      // itself an ordinary compiled Sapl program), not directly compilable
      // by saplcomp/retagcomp -- see worker.js's preprocessSpp.
      if (el.btnCompile) {
        el.btnCompile.style.display = "inline-flex";
        el.btnCompile.innerHTML = "<span>🔤</span> Preprocess (.spp → .cfp)";
      }
      if (el.btnCompileRun) el.btnCompileRun.style.display = "none";
      if (el.btnRun) el.btnRun.style.display = "none";
      if (el.sectionStageInfo) el.sectionStageInfo.style.display = "none";

      if (el.sectionCompilerBackend) el.sectionCompilerBackend.style.display = "none";
      if (el.sectionStrictness) el.sectionStrictness.style.display = "none";
      if (el.sectionStages) el.sectionStages.style.display = "none";
      if (el.sectionEngine) el.sectionEngine.style.display = "none";
    } else if (tab.ext === ".lfp") {
      // .lfp source: Sapl + kale, onbeperkte lambda's -- preprocess to plain
      // .cfp first (lamlift/lamlift.jmvm, zelf een gewoon gecompileerd Sapl-
      // programma), niet direct compileerbaar door saplcomp/retagcomp -- zie
      // worker.js's preprocessLfp.
      if (el.btnCompile) {
        el.btnCompile.style.display = "inline-flex";
        el.btnCompile.innerHTML = "<span>λ</span> Preprocess (.lfp → .cfp)";
      }
      if (el.btnCompileRun) el.btnCompileRun.style.display = "none";
      if (el.btnRun) el.btnRun.style.display = "none";
      if (el.sectionStageInfo) el.sectionStageInfo.style.display = "none";

      if (el.sectionCompilerBackend) el.sectionCompilerBackend.style.display = "none";
      if (el.sectionStrictness) el.sectionStrictness.style.display = "none";
      if (el.sectionStages) el.sectionStages.style.display = "none";
      if (el.sectionEngine) el.sectionEngine.style.display = "none";
    } else if (tab.ext === ".cfp") {
      // Original source file
      if (el.lblCompilerSapl) el.lblCompilerSapl.style.display = "flex";
      if (el.lblCompilerRetag) el.lblCompilerRetag.style.display = "none";
      if (el.lblCompilerModules) el.lblCompilerModules.style.display = "flex";
      if (el.compilerSapl && !el.compilerModules.checked) el.compilerSapl.checked = true;

      // Modules-hulp: scope-map/manifest-veld defaulten op de map van dit
      // bestand -- een module in dit spoor IS gewoon een .cfp-bestand
      // (het HUIDIGE tabblad is altijd de entry, geen apart entry-veld
      // nodig zoals in de Workbench-poort: dat voorkwam daar juist een
      // divergentie-risico tussen een handmatig ingevuld entry-veld en
      // het bestand dat je daadwerkelijk compileert).
      if (el.txtModulesScope && !el.txtModulesScope.dataset.userEdited) el.txtModulesScope.value = pathDirname(tab.path);
      if (el.txtModulesManifest && !el.txtModulesManifest.dataset.userEdited) {
        const dir = pathDirname(tab.path);
        el.txtModulesManifest.value = (dir ? dir + "/" : "") + "manifest.txt";
      }

      if (el.btnCompile) {
        el.btnCompile.style.display = "inline-flex";
        el.btnCompile.innerHTML = "<span>⚙️</span> Compileer";
      }
      if (el.btnCompileRun) {
        el.btnCompileRun.style.display = "inline-flex";
        el.btnCompileRun.innerHTML = "<span>⚡</span> Compileer & Run";
      }
      if (el.btnRun) el.btnRun.style.display = "inline-flex";
      if (el.sectionStageInfo) el.sectionStageInfo.style.display = "none";

      if (el.sectionCompilerBackend) el.sectionCompilerBackend.style.display = "block";
      if (el.sectionStrictness) el.sectionStrictness.style.display = "block";
      if (el.sectionStages) el.sectionStages.style.display = "block";
      if (el.sectionEngine) el.sectionEngine.style.display = "block";
    } else if (tab.ext === ".jmvm") {
      if (el.btnCompile) el.btnCompile.style.display = "none";
      if (el.btnCompileRun) el.btnCompileRun.style.display = "none";
      if (el.btnRun) el.btnRun.style.display = "inline-flex";
      if (el.sectionStageInfo) el.sectionStageInfo.style.display = "none";

      if (el.sectionCompilerBackend) el.sectionCompilerBackend.style.display = "none";
      if (el.sectionStrictness) el.sectionStrictness.style.display = "none";
      if (el.sectionStages) el.sectionStages.style.display = "none";
      if (el.sectionEngine) el.sectionEngine.style.display = "block";
    } else {
      if (el.btnCompile) el.btnCompile.style.display = "none";
      if (el.btnCompileRun) el.btnCompileRun.style.display = "none";
      if (el.btnRun) el.btnRun.style.display = "none";
      if (el.sectionStageInfo) el.sectionStageInfo.style.display = "none";
      if (el.sectionCompilerBackend) el.sectionCompilerBackend.style.display = "none";
      if (el.sectionStrictness) el.sectionStrictness.style.display = "none";
      if (el.sectionStages) el.sectionStages.style.display = "none";
      if (el.sectionEngine) el.sectionEngine.style.display = "none";
    }

    updateModulesSectionVisibility();
  }

  // Zichtbaarheid van de "Modules: manifest"-sectie hangt af van welke
  // compiler-radio gekozen is EN of de Compiler Backend-sectie zelf
  // sowieso zichtbaar is voor dit bestandstype -- centraal hier i.p.v.
  // in elke branch hierboven gedupliceerd, ook aangeroepen vanuit de
  // radio-change-listener zelf (zie setupEventListeners).
  function updateModulesSectionVisibility() {
    const backendVisible = el.sectionCompilerBackend && el.sectionCompilerBackend.style.display !== "none";
    const show = !!(el.compilerModules && el.compilerModules.checked && backendVisible);
    if (el.sectionModulesBackend) el.sectionModulesBackend.style.display = show ? "block" : "none";
  }

  // --- ACTIONS: SAVE, COMPILE, RUN ---
  function saveActiveFile() {
    const activeTab = getActiveTab();
    if (!activeTab || isToolTab(activeTab)) return;

    activeTab.content = state.editor.getValue();
    activeTab.originalContent = activeTab.content;
    activeTab.isDirty = false;
    activeTab.isPreview = false;

    state.fileMap.set(activeTab.path, {
      ...activeTab,
      size: activeTab.content.length
    });

    try {
      const userFiles = JSON.parse(localStorage.getItem("websapl_user_files") || "{}");
      userFiles[activeTab.path] = activeTab.content;
      localStorage.setItem("websapl_user_files", JSON.stringify(userFiles));
    } catch (_) {}

    renderTabs();
    setStatus("ready", "Klaar");
    logTerminal(`✓ Opgeslagen: ${activeTab.path}\n`, "success");
  }

  // Shared by compileActiveFile's and preprocessActiveFile's success
  // callbacks: register each generated file in the file map and open (or
  // refresh) a tab for it.
  function openGeneratedFiles(files) {
    for (const f of files) {
      state.fileMap.set(f.path, {
        path: f.path,
        name: f.name,
        ext: pathExt(f.name),
        content: f.content,
        size: f.size,
        isBinary: false
      });

      const openTab = state.openTabs.find(t => t.path === f.path);
      if (openTab) {
        openTab.content = f.content;
        openTab.originalContent = f.content;
        openTab.isDirty = false;
      } else {
        state.openTabs.push({
          path: f.path,
          name: f.name,
          ext: pathExt(f.name),
          content: f.content,
          originalContent: f.content,
          isDirty: false,
          viewMode: "edit"
        });
      }
    }
  }

  // Sapl+ (.spp) -> plain Sapl (.cfp): runs preprocess/driver.jmvm; .lfp
  // (Sapl + kale, onbeperkte lambda's) -> plain Sapl (.cfp): runs
  // lamlift/lamlift.jmvm (see worker.js's preprocessSpp/preprocessLfp).
  // Both are ordinary compiled Sapl programs, run on the same WASM VM, and
  // both open the resulting .cfp in a new tab -- from there,
  // compileActiveFile (the regular "Compileer"/"Compileer & Run" buttons)
  // takes over exactly as for any hand-written .cfp source.
  async function preprocessActiveFile() {
    const activeTab = getActiveTab();
    if (!activeTab || (activeTab.ext !== ".spp" && activeTab.ext !== ".lfp")) return;
    if (state.isCompiling) return;
    state.isCompiling = true;

    const kind = activeTab.ext === ".lfp" ? "lfp" : "spp";
    const engineLabel = kind === "lfp" ? "lamlift.jmvm" : "driver.jmvm";

    activeTab.content = state.editor.getValue();

    toggleTerminal(true);
    logTerminal(`\n=== Preprocessen: ${activeTab.path} (${kind} -> Sapl, WebAssembly ${engineLabel}) ===\n`, "info");
    setStatus("busy", "Bezig met preprocessen...");

    const compileId = ++state.compileSeq;

    state.pendingCompileCallbacks.set(compileId, (data) => {
      if (data.stdout) logTerminal(data.stdout, "normal");
      if (data.stderr) logTerminal(data.stderr, "warning");

      if (data.success && data.files && data.files.length > 0) {
        setStatus("ready", `Voorverwerkt (${data.durationMs}ms)`);
        logTerminal(`✓ ${activeTab.ext} → .cfp voorverwerkt in ${data.durationMs}ms\n`, "success");

        openGeneratedFiles(data.files);
        setActiveTab(data.files[0].path);
        renderTabs();
      } else {
        setStatus("error", "Preprocessen mislukt");
        logTerminal(`✗ Preprocessen mislukt.\n`, "error");
      }
    });

    state.worker.postMessage({
      type: "PREPROCESS",
      kind: kind,
      id: compileId,
      source: activeTab.content,
      path: activeTab.path
    });
  }

  // Hindley-Milner type-inferentie voor Sapl+ (preprocess/typecheck.jmvm,
  // zie typing/README.md) tegen het actieve tabblad -- runs on the same
  // WASM VM as preprocessActiveFile above, but produces a plain text
  // report (no output file, so nothing to open as a new tab) logged
  // straight to the terminal.
  async function runTypecheck() {
    const activeTab = getActiveTab();
    if (!activeTab || isToolTab(activeTab)) return;
    if (state.isCompiling) return;
    state.isCompiling = true;

    activeTab.content = state.editor.getValue();

    toggleTerminal(true);
    logTerminal(`\n=== Typechecken: ${activeTab.path} (WebAssembly typecheck.jmvm) ===\n`, "info");
    setStatus("busy", "Bezig met typechecken...");

    const compileId = ++state.compileSeq;

    state.pendingCompileCallbacks.set(compileId, (data) => {
      state.isCompiling = false;

      if (!data.success) {
        setStatus("error", "Typechecken mislukt");
        logTerminal(`✗ Typechecken mislukt: ${data.error || "onbekende fout"}\n`, "error");
        return;
      }

      const report = (data.report || "").trim();
      if (report) {
        logTerminal(report + "\n", "normal");
      } else {
        logTerminal("(geen uitvoer -- leeg bestand of geen topniveaufuncties?)\n", "info");
      }
      const hasFout = /FOUT:/.test(report);
      setStatus(hasFout ? "ready" : "ready", `Typecheck klaar (${data.durationMs}ms)`);
      logTerminal(`✓ Typecheck klaar in ${data.durationMs}ms${hasFout ? " -- zie meldingen hierboven" : ", geen meldingen"}.\n`, hasFout ? "warning" : "success");
    });

    state.worker.postMessage({
      type: "TYPECHECK",
      id: compileId,
      source: activeTab.content,
      path: activeTab.path
    });
  }

  async function compileActiveFile(andRun = false) {
    const activeTab = getActiveTab();
    if (!activeTab || isToolTab(activeTab)) return;

    if (activeTab.ext === ".spp" || activeTab.ext === ".lfp") {
      preprocessActiveFile();
      return;
    }

    if (activeTab.ext === ".jmvm") {
      if (andRun) {
        runJmvmFile(activeTab.path);
      } else {
        logTerminal("ℹ️ Dit bestand is al gecompileerde .jmvm bytecode. Klik op 'Run' om het uit te voeren.\n", "info");
      }
      return;
    }

    if (activeTab.ext.startsWith(".cfp_") && !activeTab.name.endsWith(".cfp_retag") && !activeTab.name.endsWith(".cfp_decompiled")) {
      logTerminal(`ℹ️ ${activeTab.name} is een tussenformaat. Selecteer het bronbestand (${activeTab.name.split(".cfp_")[0]}.cfp) om te compileren.\n`, "info");
      return;
    }

    if (activeTab.ext === ".cfp" && el.compilerModules && el.compilerModules.checked) {
      await buildModulesFromActiveFile(andRun);
      return;
    }

    if (state.isCompiling) return;
    state.isCompiling = true;

    activeTab.content = state.editor.getValue();

    const isRetag = activeTab.name.endsWith(".cfp_retag") || activeTab.name.endsWith(".cfp_decompiled");
    const strictness = el.chkStrictness ? el.chkStrictness.checked : true;
    
    const stages = [];
    if (!isRetag) {
      for (const [k, chk] of Object.entries(el.chkStages)) {
        if (chk && chk.checked) stages.push(k);
      }
      if (stages.length === 0) stages.push("jmvm");
    } else {
      stages.push("jmvm");
    }

    toggleTerminal(true);
    logTerminal(`\n=== Compileren: ${activeTab.path} (WebAssembly saplcomp) ===\n`, "info");
    setStatus("busy", "Bezig met compileren...");

    const compileId = ++state.compileSeq;

    state.pendingCompileCallbacks.set(compileId, (data) => {
      if (data.stdout) logTerminal(data.stdout, "normal");
      if (data.stderr) logTerminal(data.stderr, "warning");

      if (data.success && data.files && data.files.length > 0) {
        setStatus("ready", `Gecompileerd (${data.durationMs}ms)`);
        logTerminal(`✓ Succesvol gecompileerd in ${data.durationMs}ms (${data.files.length} bestanden gegenereerd)\n`, "success");

        openGeneratedFiles(data.files);

        const jmvmFile = data.files.find(f => f.stage === "jmvm") || data.files[data.files.length - 1];
        if (jmvmFile) {
          setActiveTab(jmvmFile.path);
        }
        renderTabs();

        if (andRun && jmvmFile) {
          runJmvmFile(jmvmFile.path);
        }
      } else {
        setStatus("error", "Compilatie mislukt");
        logTerminal(`✗ Compilatie mislukt.\n`, "error");
      }
    });

    state.worker.postMessage({
      type: isRetag ? "COMPILE_RETAG" : "COMPILE",
      id: compileId,
      source: activeTab.content,
      path: activeTab.path,
      stages: stages,
      strictness: strictness
    });
  }

  // --- MODULES: apart compileren + linken (build_modules.py-poort) ---
  //
  // Achtergrond: docs/2026-09-13_modules_compileren_en_linken_gebruik.md,
  // de Workbench-versie van deze feature (workbench/server.js's
  // "modules"-backend, wraapt sapl_compiler/tools/build_modules.py als
  // los proces). Hier is er geen los proces/bestandssysteem beschikbaar
  // -- worker.js's buildModules() (nieuw, zie engine/worker.js) doet
  // dezelfde orkestratie maar rechtstreeks tegen de WASM-VM-instanties,
  // en deze functies hier verzamelen de daarvoor benodigde bestandsinhoud
  // uit de bestandsboom/tabs/localStorage vóórdat de boodschap naar de
  // worker gaat (de worker heeft immers geen eigen toegang tot de
  // gebruiker se bestanden, alleen tot compiler-artefacten in zijn eigen
  // gedeelde VFS).
  //
  // BEWUST geen aparte "force herbouw"-optie zoals de CLI/Workbench-versie
  // heeft: er is geen persistente "laatst gebouwde versie" tussen
  // paginaherladingen om tegen te vergelijken, dus elke build herbouwt
  // hier altijd alles (zie worker.js's buildModules-toelichting).

  // Leest de inhoud van een bestand op zijn VFS-achtige projectpad --
  // eerst de al-bekende bronnen (open tab/fileMap, dan localStorage se
  // eigen bestanden), pas als laatste een echte fetch (voor een
  // bronbestand dat nog nooit geopend is in deze sessie). Gedeeld door
  // zowel de manifest-suggestie als de daadwerkelijke build hieronder.
  async function getFileContentForPath(filePath) {
    const openTab = state.openTabs.find((t) => t.path === filePath);
    if (openTab) return openTab.content;
    const cached = state.fileMap.get(filePath);
    if (cached && cached.content !== undefined && cached.content !== null) return cached.content;
    try {
      const userFiles = JSON.parse(localStorage.getItem("websapl_user_files") || "{}");
      if (userFiles[filePath] !== undefined) return userFiles[filePath];
    } catch (_) {}
    try {
      const res = await fetch(filePath);
      if (res.ok) return await res.text();
    } catch (_) {}
    return null;
  }

  // Alle module-namen die ergens in een manifest genoemd worden (als
  // sleutel of als afhankelijkheid) -- een lossere, foutentolerante scan
  // dan een echte parse (die zit in worker.js's parseManifestText, met
  // de echte topologische sortering/cyclus-detectie); hier alleen nodig
  // om te weten WELKE bestanden vooraf opgehaald moeten worden.
  function extractManifestModuleNames(text) {
    const names = new Set();
    for (const raw of text.split("\n")) {
      const line = raw.split("#")[0].trim();
      if (!line) continue;
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      names.add(line.slice(0, idx).trim());
      const rest = line.slice(idx + 1).trim();
      if (rest) rest.split(/\s+/).forEach((n) => names.add(n));
    }
    return [...names];
  }

  async function buildModulesFromActiveFile(andRun) {
    const activeTab = getActiveTab();
    if (!activeTab) return;
    if (state.isCompiling) return;

    const manifestPath = (el.txtModulesManifest.value || "").trim();
    const entryFunc = (el.txtModulesEntryFunc.value || "").trim() || "start";
    if (!manifestPath) {
      alert("Geef eerst een manifestbestand op (of genereer een suggestie hieronder).");
      return;
    }

    state.isCompiling = true;
    activeTab.content = state.editor.getValue();

    toggleTerminal(true);
    logTerminal(`\n=== Modulegewijs compileren: ${activeTab.path} (manifest: ${manifestPath}) ===\n`, "info");
    setStatus("busy", "Bezig met modulegewijs compileren...");

    try {
      const manifestText = await getFileContentForPath(manifestPath);
      if (manifestText === null) {
        throw new Error(`manifest niet gevonden: ${manifestPath}`);
      }

      const manifestDir = pathDirname(manifestPath);
      const entryModule = pathRelative(manifestDir, activeTab.path);

      // Elke naam in het manifest -- sleutel of afhankelijkheid -- vooraf
      // ophalen als broncode, relatief aan de manifest-map (zelfde
      // resolutie als build_modules.py's eigen resolve()). Een naam die
      // niet als bestand bestaat wordt hier stil overgeslagen; de
      // worker se buildModules() geeft daar zelf een duidelijke fout
      // over als die naam ECHT nodig blijkt (transitief vanaf de entry).
      const names = extractManifestModuleNames(manifestText);
      const moduleSources = {};
      for (const name of names) {
        const resolved = pathJoinNormalize(manifestDir, name);
        const content = await getFileContentForPath(resolved);
        if (content !== null) moduleSources[name] = content;
      }
      // De entry zelf staat mogelijk nog niet opgeslagen (actief bewerkt) --
      // altijd de editor se HUIDIGE inhoud gebruiken, niet een eventueel
      // stalere versie uit fileMap/localStorage.
      moduleSources[entryModule] = activeTab.content;

      const compileId = ++state.compileSeq;
      state.pendingCompileCallbacks.set(compileId, (data) => {
        if (data.stdout) logTerminal(data.stdout, "normal");
        if (data.stderr) logTerminal(data.stderr, "warning");

        if (data.success && data.files && data.files.length > 0) {
          setStatus("ready", `Gecompileerd (${data.durationMs}ms)`);
          logTerminal(`✓ Succesvol modulegewijs gecompileerd in ${data.durationMs}ms\n`, "success");

          openGeneratedFiles(data.files);
          const jmvmFile = data.files.find((f) => f.stage === "jmvm") || data.files[data.files.length - 1];
          if (jmvmFile) setActiveTab(jmvmFile.path);
          renderTabs();

          if (andRun && jmvmFile) runJmvmFile(jmvmFile.path);
        } else {
          setStatus("error", "Modulegewijs compileren mislukt");
          logTerminal(`✗ Modulegewijs compileren mislukt.\n`, "error");
        }
      });

      const outPath = "/tmp/" + pathBasename(activeTab.path).replace(/\.cfp$/, "") + ".jmvm";
      state.worker.postMessage({
        type: "BUILD_MODULES",
        id: compileId,
        manifest: manifestText,
        entryModule: entryModule,
        entryFunc: entryFunc,
        moduleSources: moduleSources,
        outPath: outPath
      });
    } catch (err) {
      state.isCompiling = false;
      setStatus("error", "Fout");
      logTerminal(`✗ Fout bij modulegewijs compileren: ${err.message}\n`, "error");
    }
  }

  // --- Manifest-hulp: suggest_manifest.py's heuristiek in kale JS ---
  //
  // Zelfde ontwerp als de Python-versie (sapl_compiler/tools/
  // suggest_manifest.py): een kandidaat-bestand "biedt" een naam aan
  // (top-level functienaam, of ADT-constructornaam), een module
  // "gebruikt" een naam als die letterlijk (heel woord, buiten
  // commentaar) in zijn brontekst voorkomt. GEEN call-graph-analyse (zie
  // dat script se docstring voor de twee blokkades die dat onoplosbaar
  // maken zonder scope-tracking) -- een startpunt, geen afgeleide
  // waarheid. Bewust NIET hergebruikt via de worker (dit heeft geen VM
  // nodig, puur string-werk, dus rechtstreeks hier in de hoofdthread).

  function stripCommentsJs(text) {
    const outLines = [];
    for (const line of text.split("\n")) {
      let inString = false;
      let cut = line.length;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"' && (i === 0 || line[i - 1] !== "\\")) {
          inString = !inString;
        } else if (!inString && c === "/" && line[i + 1] === "/") {
          cut = i;
          break;
        }
      }
      outLines.push(line.slice(0, cut));
    }
    return outLines.join("\n");
  }

  function splitDefinitionsJs(text) {
    // Zelfde heuristiek als repl_retag.py's split_definitions/parser.cfp's
    // mergeContinuations: een niet-ingesprongen regel begint een nieuwe
    // top-level definitie. Onverwachte inspringing zonder voorgaande
    // regel wordt hier stil genegeerd (i.p.v. een fout te gooien zoals
    // de Python-versie) -- dit is een best-effort suggestie, één rommelig
    // bestand mag de rest niet blokkeren.
    const defs = [];
    let current = null;
    for (const raw of text.split("\n")) {
      const stripped = raw.trim();
      if (stripped === "" || stripped.startsWith("//")) continue;
      const indented = raw.length > 0 && (raw[0] === " " || raw[0] === "\t");
      if (!indented) {
        if (current !== null) defs.push(current);
        current = raw;
      } else if (current !== null) {
        current += "\n" + raw;
      }
    }
    if (current !== null) defs.push(current);
    return defs;
  }

  function extractDefNameJs(text) {
    const stripped = text.trim();
    let m = stripped.match(/^::\s*([A-Za-z_][A-Za-z0-9_]*)/);
    if (m) return "::" + m[1];
    m = stripped.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    return m ? m[1] : null;
  }

  function extractConstructorNamesJs(defText) {
    const stripped = defText.trim();
    const eqIdx = stripped.indexOf("=");
    if (!stripped.startsWith("::") || eqIdx === -1) return [];
    const rhs = stripped.slice(eqIdx + 1);
    const names = [];
    for (const alt of rhs.split("|")) {
      const m = alt.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)/);
      if (m) names.push(m[1]);
    }
    return names;
  }

  // Vindt een directory-node in state.treeData op zijn pad (lege string
  // = root); geeft `{ children: [...] }` terug zodat de aanroeper altijd
  // gewoon `.children` kan lezen.
  function findTreeDir(nodes, targetPath) {
    if (!targetPath) return { children: nodes };
    for (const n of nodes) {
      if (n.type === "directory") {
        if (n.path === targetPath) return n;
        const found = findTreeDir(n.children || [], targetPath);
        if (found) return found;
      }
    }
    return null;
  }

  function listCfpSiblings(scopeDir) {
    const dirNode = findTreeDir(state.treeData, scopeDir);
    if (!dirNode) return [];
    return (dirNode.children || [])
      .filter((n) => n.type === "file" && n.ext === ".cfp")
      .map((n) => n.path);
  }

  async function buildManifestSuggestion(entryPath, scopeDir, manifestDir) {
    const candidatePaths = listCfpSiblings(scopeDir);
    if (!candidatePaths.includes(entryPath)) candidatePaths.push(entryPath);

    const bodies = {};
    const index = {}; // naam -> Set(paden)
    for (const p of candidatePaths) {
      const content = await getFileContentForPath(p);
      if (content === null) continue; // onleesbaar, overslaan (net als de Python-versie)
      bodies[p] = stripCommentsJs(content);
      for (const d of splitDefinitionsJs(content)) {
        const name = extractDefNameJs(d);
        if (!name) continue;
        if (name.startsWith("::")) {
          for (const cname of extractConstructorNamesJs(d)) {
            (index[cname] = index[cname] || new Set()).add(p);
          }
        } else {
          (index[name] = index[name] || new Set()).add(p);
        }
      }
    }

    const deps = {};
    const ambiguous = {};
    const queue = [entryPath];
    const processed = new Set();
    while (queue.length) {
      const f = queue.shift();
      if (processed.has(f)) continue;
      processed.add(f);
      if (!(f in bodies)) {
        deps[f] = new Set();
        continue;
      }
      const body = bodies[f];
      // Een naam die `f` ZELF ook aanbiedt volledig genegeerd, niet
      // alleen als kandidaat-provider -- zelfde fix als in
      // suggest_manifest.py (anders matcht bv. elk bestand se eigen
      // `start` tegen een ander bestand dat toevallig hetzelfde biedt).
      const ownNames = new Set(Object.keys(index).filter((n) => index[n].has(f)));
      const candidateNames = Object.keys(index).filter((n) => !ownNames.has(n));
      const ownDeps = new Set();
      const ownAmbiguous = [];
      if (candidateNames.length > 0) {
        const escaped = candidateNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        const pattern = new RegExp("(?<![A-Za-z0-9_])(" + escaped.join("|") + ")(?![A-Za-z0-9_])", "g");
        const used = new Set(body.match(pattern) || []);
        for (const name of [...used].sort()) {
          const providers = index[name];
          if (providers.size === 1) {
            ownDeps.add([...providers][0]);
          } else {
            ownAmbiguous.push([name, [...providers].sort()]);
          }
        }
      }
      deps[f] = ownDeps;
      if (ownAmbiguous.length) ambiguous[f] = ownAmbiguous;
      for (const d of ownDeps) if (!processed.has(d)) queue.push(d);
    }

    const rel = (p) => pathRelative(manifestDir, p);
    const order = [entryPath, ...Object.keys(deps).filter((m) => m !== entryPath).sort()];
    const lines = [
      "# Automatisch gegenereerde SUGGESTIE -- geen afgeleide waarheid, controleer/vul",
      "# aan voor gebruik (heuristische naam-scan, geen call-graph-analyse)."
    ];
    for (const mod of order) {
      const depLine = [...deps[mod]].map(rel).sort().join(" ");
      lines.push(`${rel(mod)}: ${depLine}`.trimEnd());
      for (const [name, providers] of (ambiguous[mod] || [])) {
        lines.push(`#   WAARSCHUWING: '${name}' komt voor in meerdere kandidaten (${providers.map(rel).join(", ")}) -- kies er zelf een en voeg toe aan de regel hierboven.`);
      }
    }
    return lines.join("\n") + "\n";
  }

  async function suggestModulesManifest() {
    const activeTab = getActiveTab();
    if (!activeTab || activeTab.ext !== ".cfp") {
      alert("Open eerst een .cfp-bestand.");
      return;
    }
    const manifestPath = (el.txtModulesManifest.value || "").trim();
    if (!manifestPath) {
      alert("Geef eerst een manifestpad op.");
      return;
    }
    const scopeDir = (el.txtModulesScope.value || "").trim() || pathDirname(activeTab.path);
    const manifestDir = pathDirname(manifestPath);

    toggleTerminal(true);
    logTerminal(`\n=== Manifest-suggestie (heuristiek, geen afgeleide waarheid) ===\n`, "info");
    logTerminal(`Entry: ${activeTab.path}\nScope-map: ${scopeDir}\nManifest-map: ${manifestDir}\n`, "normal");
    setStatus("busy", "Suggestie genereren...");

    try {
      const manifestText = await buildManifestSuggestion(activeTab.path, scopeDir, manifestDir);

      // Suggestie als NIEUW, nog niet opgeslagen tabblad openen op het
      // manifestpad -- hergebruikt zo de bestaande, al werkende editor +
      // "Opslaan"-knop i.p.v. een aparte schrijf-route te bouwen. Bewust
      // isDirty:true: dit is een suggestie, geen al-opgeslagen bestand.
      const existingIdx = state.openTabs.findIndex((t) => t.path === manifestPath);
      const tabData = {
        path: manifestPath,
        name: pathBasename(manifestPath),
        ext: pathExt(manifestPath),
        content: manifestText,
        originalContent: "",
        isDirty: true,
        viewMode: "edit"
      };
      if (existingIdx >= 0) state.openTabs[existingIdx] = tabData;
      else state.openTabs.push(tabData);
      setActiveTab(manifestPath);
      renderTabs();

      setStatus("ready", "Suggestie geopend -- controleer/bewerk en klik Opslaan");
      logTerminal(`✓ Suggestie geopend als tabblad (${manifestPath}) -- controleer/bewerk vóór opslaan.\n`, "success");
    } catch (err) {
      setStatus("error", "Fout");
      logTerminal(`✗ Fout bij suggestie: ${err.message}\n`, "error");
    }
  }

  // --- REPL: Sapl+ REPL, client-side poort van sapl_compiler/tools/
  // repl_retag.py (repl/README.md) ---
  //
  // Alle sessie-logica (naam-tabel, atomische kandidaat-dan-promoveer-
  // rebuild, prelude-/reserved-name-botsingen) zit in engine/worker.js's
  // replXxx()-functies, hergebruikt van dezelfde vijf WASM-primitieven
  // als de "modules"-backend hierboven. Hier alleen: commando's parsen
  // (dezelfde `:def`/`:history`/`:undo`/`:reset`/`:load`/`:save`/`:funcs`-
  // syntax als de terminal-versies), `:load`/`:save`'s bestandstoegang
  // (getFileContentForPath/nieuw-tabblad-openen, al gebouwd voor de
  // modules-hulp hierboven), en het logvenster.

  function replCall(cmd, extra) {
    return new Promise((resolve) => {
      const id = ++state.compileSeq;
      state.pendingCompileCallbacks.set(id, resolve);
      state.worker.postMessage({ type: "REPL_EVAL", id, cmd, ...extra });
    });
  }

  function replInitCall() {
    return new Promise((resolve) => {
      const id = ++state.compileSeq;
      state.pendingCompileCallbacks.set(id, resolve);
      state.worker.postMessage({ type: "REPL_INIT", id });
    });
  }

  function scrollReplLogToBottom() {
    if (el.replLog) el.replLog.scrollTop = el.replLog.scrollHeight;
  }

  function replAppendLog(text, cssClass) {
    if (!el.replLog || !text) return;
    if (cssClass) {
      const span = document.createElement("span");
      span.className = cssClass;
      span.textContent = text;
      el.replLog.appendChild(span);
    } else {
      el.replLog.appendChild(document.createTextNode(text));
    }
    scrollReplLogToBottom();
  }

  function setReplBusy(busy) {
    state.replBusy = busy;
    const idle = state.replReady && !busy;
    [el.txtReplInput, el.btnReplSend, el.btnReplHistory, el.btnReplUndo,
      el.btnReplFuncs, el.btnReplReset, el.txtReplLoad, el.btnReplLoad,
      el.txtReplSave, el.btnReplSave].forEach((node) => { if (node) node.disabled = !idle; });
  }

  // Vult de "Voorbeeld laden"-keuzelijst met de .cfp-bestanden in
  // websapl/repl_examples/ (hergebruikt findTreeDir/listCfpSiblings,
  // dezelfde tree-lookup als de modules-manifest-hulp hierboven) --
  // een file-picker i.p.v. zelf een pad te typen, specifiek voor deze
  // curated map met bekend-werkende REPL-demo's (allemaal al geverifieerd
  // via :load, zie sapl_compiler/tools/repl_retag.py's eigen sweep-test
  // over de kernbenchmarks). Idempotent: veilig opnieuw aan te roepen.
  function populateReplExamplePicker() {
    if (!el.selReplExample) return;
    const files = listCfpSiblings("repl_examples").sort();
    el.selReplExample.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = files.length ? "-- kies een voorbeeldbestand --" : "(geen voorbeelden gevonden)";
    el.selReplExample.appendChild(placeholder);
    for (const p of files) {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = pathBasename(p);
      el.selReplExample.appendChild(opt);
    }
  }

  async function openReplTab() {
    populateReplExamplePicker();
    const existing = state.openTabs.find((t) => t.path === "__repl__");
    if (!existing) state.openTabs.push({ path: "__repl__", name: "REPL", kind: "repl" });
    setActiveTab("__repl__");

    if (state.replInitStarted) return;
    state.replInitStarted = true;

    if (el.replStatus) {
      el.replStatus.textContent = "Bezig met initialiseren...";
      el.replStatus.className = "tool-panel-status busy";
    }
    try {
      // Wacht op de WASM-engine zelf (dezelfde compileSapl/compileRetag
      // gebruiken 'm ook al, maar die worden pas na een gebruikersactie
      // aangeroepen -- de REPL-tab kan potentieel eerder geopend worden).
      if (!state.workerReady) {
        await new Promise((resolve) => {
          const check = () => { if (state.workerReady) resolve(); else setTimeout(check, 100); };
          check();
        });
      }
      const r = await replInitCall();
      if (!r.success) throw new Error(r.error);
      state.replReady = true;
      if (el.replStatus) {
        el.replStatus.textContent = "Klaar.";
        el.replStatus.className = "tool-panel-status ok";
      }
      setReplBusy(false);
      replAppendLog("Sapl+ REPL klaar. Typ een expressie, of ':def naam ... = ...' voor een eigen functie/ADT.\n");
      if (el.txtReplInput) el.txtReplInput.focus();
    } catch (err) {
      if (el.replStatus) {
        el.replStatus.textContent = `Fout: ${err.message}`;
        el.replStatus.className = "tool-panel-status crashed";
      }
      replAppendLog(`fout bij initialiseren: ${err.message}\n`, "repl-line-error");
    }
  }

  // :load <pad> -- zelfde .jmvm->.cfp-terugval en identiek-aan-de-
  // prelude-tolerantie als repl_retag.py/vm.cpp's REPL_HOST, hier alleen
  // het BESTANDSTOEGANG-deel (de sessie-logica zit in worker.js's
  // replLoadContent) via getFileContentForPath, dezelfde resolver als de
  // modules-backend hierboven.
  async function replHandleLoad(pathArg) {
    if (!pathArg) throw new Error(":load heeft een bestandspad nodig, bv. ':load mijn_functies.cfp'");
    const ext = pathExt(pathArg);
    let usePath = pathArg;
    if (ext !== ".cfp" && ext !== ".spp") {
      const base = ext ? pathArg.slice(0, -ext.length) : pathArg;
      const sibling = base + ".cfp";
      const siblingContent = await getFileContentForPath(sibling);
      if (siblingContent !== null) {
        replAppendLog(`'${pathArg}' is geen Sapl-broncode (${ext}) -- '${sibling}' geladen in plaats daarvan.\n`);
        usePath = sibling;
      } else {
        throw new Error(`:load verwacht Sapl-broncode (.cfp/.spp), geen '${ext}'-bestand (${pathArg}). Ook geen '${sibling}' gevonden om in plaats daarvan te laden.`);
      }
    }
    const content = await getFileContentForPath(usePath);
    if (content === null) throw new Error(`bestand niet gevonden: ${usePath}`);
    const r = await replCall("load", { content });
    if (!r.success) throw new Error(r.error);
    for (const note of r.notes) replAppendLog(note + "\n");
    replAppendLog(r.names.length
      ? `geladen: ${r.names.join(", ")}\n`
      : "geladen: (niets nieuws -- alles was al gereserveerd of stond al in de prelude)\n");
  }

  // :save <pad> -- opent de sessie (zonder prelude) als nieuw, nog niet
  // opgeslagen tabblad, zelfde patroon als de modules-manifest-suggestie:
  // websapl heeft geen los "schrijf naar willekeurig pad"-endpoint zoals
  // de Workbench's /api/save, dus de bestaande editor+Opslaan-knop is de
  // aangewezen weg -- vandaar de tekst hieronder ("klik op Opslaan") i.p.v.
  // simpelweg "opgeslagen" te claimen zoals de terminal-REPL's dat doen
  // (die schrijven wél meteen echt naar schijf).
  async function replHandleSave(pathArg) {
    if (!pathArg) throw new Error(":save heeft een bestandspad nodig, bv. ':save mijn_sessie.cfp'");
    const r = await replCall("save");
    if (!r.success) throw new Error(r.error);
    const existingIdx = state.openTabs.findIndex((t) => t.path === pathArg);
    const tabData = {
      path: pathArg,
      name: pathBasename(pathArg),
      ext: pathExt(pathArg),
      content: r.content,
      originalContent: "",
      isDirty: true,
      viewMode: "edit"
    };
    if (existingIdx >= 0) state.openTabs[existingIdx] = tabData;
    else state.openTabs.push(tabData);
    renderTabs();
    replAppendLog(`sessie geopend als nieuw tabblad (${pathArg}) -- klik op dat tabblad en dan op Opslaan om te bewaren.\n`);
  }

  // Zelfde dispatch-structuur als repl_retag.py's dispatch()/vm.cpp's
  // dispatchH -- elke tak drukt exact dezelfde meldingen af als de
  // terminal-versies, zodat het logvenster hier identiek leesbaar is.
  async function sendReplLine(line) {
    if (!line.trim() || !state.replReady || state.replBusy) return;
    replAppendLog(`repl> ${line}\n`, "repl-line-typed");
    setReplBusy(true);
    if (el.replStatus) { el.replStatus.textContent = "Bezig..."; el.replStatus.className = "tool-panel-status busy"; }

    try {
      if (line.startsWith(":def")) {
        const text = line.slice(4).trim();
        if (!text) throw new Error(":def heeft een clausule/ADT-declaratie nodig, bv. ':def double x = x * 2'");
        const r = await replCall("def", { text });
        if (!r.success) throw new Error(r.error);
        replAppendLog(`gedefinieerd: ${r.name}\n`);
      } else if (line === ":list" || line === ":history") {
        const r = await replCall("history");
        if (!r.success) throw new Error(r.error);
        if (r.entries.length === 0) replAppendLog("  (lege sessie)\n");
        for (const entry of r.entries) replAppendLog(`  ${entry.name}: ${entry.text}\n`);
      } else if (line === ":undo") {
        const r = await replCall("undo");
        if (!r.success) throw new Error(r.error);
        replAppendLog("ongedaan gemaakt\n");
      } else if (line === ":reset") {
        const r = await replCall("reset");
        if (!r.success) throw new Error(r.error);
        replAppendLog("sessie geleegd\n");
      } else if (line.startsWith(":load")) {
        await replHandleLoad(line.slice(5).trim());
      } else if (line.startsWith(":save")) {
        await replHandleSave(line.slice(5).trim());
      } else if (line === ":funcs") {
        const r = await replCall("funcs");
        if (!r.success) throw new Error(r.error);
        if (r.funcs.length === 0) replAppendLog("  (geen functies)\n");
        for (const f of r.funcs) replAppendLog(`  ${f}\n`);
      } else {
        const r = await replCall("eval", { line });
        if (!r.success) throw new Error(r.error);
        replAppendLog(`${r.output}\n  (${r.name})\n`);
      }
      if (el.replStatus) { el.replStatus.textContent = "Klaar."; el.replStatus.className = "tool-panel-status ok"; }
    } catch (err) {
      replAppendLog(`fout: ${err.message}\n`, "repl-line-error");
      if (el.replStatus) { el.replStatus.textContent = `Fout: ${err.message}`; el.replStatus.className = "tool-panel-status crashed"; }
    }
    setReplBusy(false);
    if (el.txtReplInput) el.txtReplInput.focus();
  }

  // REPL command history (persisted in localStorage, navigable via ArrowUp/ArrowDown)
  const REPL_HISTORY_KEY = "sapl_websapl_repl_history";
  let replHistory = [];
  try {
    const saved = localStorage.getItem(REPL_HISTORY_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) replHistory = parsed;
    }
  } catch (e) {}
  let replHistoryCursor = replHistory.length;
  let replDraft = "";

  function pushReplHistory(line) {
    if (!line || !line.trim()) return;
    if (replHistory.length === 0 || replHistory[replHistory.length - 1] !== line) {
      replHistory.push(line);
      if (replHistory.length > 500) replHistory.shift();
      try {
        localStorage.setItem(REPL_HISTORY_KEY, JSON.stringify(replHistory));
      } catch (e) {}
    }
    replHistoryCursor = replHistory.length;
    replDraft = "";
  }

  function handleReplInputKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      sendReplInputLine();
    } else if (e.key === "ArrowUp") {
      if (replHistory.length === 0) return;
      e.preventDefault();
      if (replHistoryCursor === replHistory.length) {
        replDraft = el.txtReplInput.value;
      }
      if (replHistoryCursor > 0) {
        replHistoryCursor--;
        el.txtReplInput.value = replHistory[replHistoryCursor];
        el.txtReplInput.selectionStart = el.txtReplInput.selectionEnd = el.txtReplInput.value.length;
      }
    } else if (e.key === "ArrowDown") {
      if (replHistoryCursor < replHistory.length) {
        e.preventDefault();
        replHistoryCursor++;
        if (replHistoryCursor === replHistory.length) {
          el.txtReplInput.value = replDraft;
        } else {
          el.txtReplInput.value = replHistory[replHistoryCursor];
        }
        el.txtReplInput.selectionStart = el.txtReplInput.selectionEnd = el.txtReplInput.value.length;
      }
    }
  }

  function sendReplInputLine() {
    if (!el.txtReplInput) return;
    const line = el.txtReplInput.value;
    if (!line.trim()) return;
    pushReplHistory(line);
    el.txtReplInput.value = "";
    sendReplLine(line);
  }

  function sendReplLoad() {
    if (!el.txtReplLoad) return;
    const target = el.txtReplLoad.value.trim();
    if (!target) return;
    sendReplLine(`:load ${target}`);
  }

  function sendReplSave() {
    if (!el.txtReplSave) return;
    const target = el.txtReplSave.value.trim();
    if (!target) return;
    sendReplLine(`:save ${target}`);
  }

  async function runJmvmFile(filePath, customStdin = "") {
    const activeTab = getActiveTab();
    let targetPath = filePath;
    let targetContent = "";

    if (!targetPath) {
      if (!activeTab || isToolTab(activeTab)) return;
      if (activeTab.ext === ".jmvm") {
        targetPath = activeTab.path;
        targetContent = activeTab.content;
      } else if (activeTab.ext === ".cfp") {
        compileActiveFile(true);
        return;
      }
    } else {
      const fileObj = state.fileMap.get(targetPath);
      if (fileObj) targetContent = fileObj.content;
    }

    if (state.isRunning) return;
    state.isRunning = true;

    toggleTerminal(true);
    logTerminal(`\n=== Uitvoeren: ${targetPath} (WebAssembly JMVM) ===\n`, "info");
    setStatus("busy", "Draaien...");

    state.worker.postMessage({
      type: "RUN",
      contentOrPath: targetContent || targetPath,
      isPath: false,
      stdin: customStdin || (el.terminalInput ? el.terminalInput.value.trim() : "")
    });
  }

  // --- FILE TREE RENDERING ---
  function renderTree() {
    el.fileTree.innerHTML = "";
    const filterText = el.treeSearch.value.trim().toLowerCase();
    const container = document.createElement("div");
    renderTreeNodes(state.treeData, container, filterText, 0);
    el.fileTree.appendChild(container);
    highlightActiveTreeNode();
  }

  function renderTreeNodes(nodes, parentEl, filterText, depth) {
    for (const node of nodes) {
      if (node.type === "directory") {
        const matchesChild = hasMatchingChild(node, filterText);
        if (filterText && !matchesChild && !node.name.toLowerCase().includes(filterText)) {
          continue;
        }

        const folderEl = document.createElement("div");
        folderEl.className = "tree-node tree-folder";
        folderEl.style.paddingLeft = `${depth * 14 + 6}px`;

        const arrow = document.createElement("span");
        arrow.className = "tree-arrow" + (node._expanded || filterText ? " expanded" : "");
        arrow.textContent = "▶";
        folderEl.appendChild(arrow);

        const icon = document.createElement("span");
        icon.className = "tree-icon";
        icon.textContent = "📁";
        folderEl.appendChild(icon);

        const nameSpan = document.createElement("span");
        nameSpan.textContent = node.name;
        folderEl.appendChild(nameSpan);

        parentEl.appendChild(folderEl);

        const childrenContainer = document.createElement("div");
        childrenContainer.style.display = (node._expanded || filterText) ? "block" : "none";
        renderTreeNodes(node.children || [], childrenContainer, filterText, depth + 1);
        parentEl.appendChild(childrenContainer);

        folderEl.onclick = () => {
          node._expanded = !node._expanded;
          arrow.className = "tree-arrow" + (node._expanded ? " expanded" : "");
          childrenContainer.style.display = node._expanded ? "block" : "none";
        };
      } else if (node.type === "file") {
        if (filterText && !node.name.toLowerCase().includes(filterText)) {
          continue;
        }

        const fileEl = document.createElement("div");
        fileEl.className = "tree-node tree-file" + (node.path === state.activeTabPath ? " active" : "");
        fileEl.style.paddingLeft = `${depth * 14 + 20}px`;
        fileEl.dataset.path = node.path;

        const iconInfo = getFileIcon(node.name, node.ext);
        const icon = document.createElement("span");
        icon.className = `tree-icon ${iconInfo.className}`;
        icon.textContent = iconInfo.icon;
        fileEl.appendChild(icon);

        const nameSpan = document.createElement("span");
        nameSpan.textContent = node.name;
        fileEl.appendChild(nameSpan);

        fileEl.onclick = (e) => {
          e.stopPropagation();
          openFile(node.path, { preview: true });
        };
        fileEl.ondblclick = (e) => {
          e.stopPropagation();
          openFile(node.path, { preview: false });
        };

        parentEl.appendChild(fileEl);
      }
    }
  }

  function hasMatchingChild(dirNode, filterText) {
    if (!filterText) return true;
    if (!dirNode.children) return false;
    for (const c of dirNode.children) {
      if (c.name.toLowerCase().includes(filterText)) return true;
      if (c.type === "directory" && hasMatchingChild(c, filterText)) return true;
    }
    return false;
  }

  function highlightActiveTreeNode() {
    const allFiles = el.fileTree.querySelectorAll(".tree-file");
    allFiles.forEach(f => {
      if (f.dataset.path === state.activeTabPath) f.classList.add("active");
      else f.classList.remove("active");
    });
  }

  function getFileIcon(fileName, ext) {
    if (fileName.includes(".cfp_") || fileName.includes(".decompiled")) {
      return { icon: "λ*", className: "file-icon-retag" };
    }
    switch (ext) {
      case ".cfp": return { icon: "λ", className: "file-icon-cfp" };
      case ".spp": return { icon: "λ+", className: "file-icon-cfp" };
      case ".lfp": return { icon: "λ", className: "file-icon-cfp" };
      case ".jmvm": return { icon: "⚙", className: "file-icon-jmvm" };
      case ".md": return { icon: "📖", className: "file-icon-md" };
      case ".pdf": return { icon: "📕", className: "file-icon-pdf" };
      case ".c":
      case ".cpp":
      case ".cc":
      case ".h": return { icon: "C++", className: "file-icon-code" };
      case ".py": return { icon: "Py", className: "file-icon-code" };
      default: return { icon: "📄", className: "" };
    }
  }

  // --- TERMINAL & METRICS ---
  function showWelcomeMessage() {
    el.terminalContent.innerHTML = "";
    logTerminal("=========================================================================\n", "accent");
    logTerminal("🚀 Welkom bij de Sapl Web Workbench (WASM Edition)\n", "accent");
    logTerminal("Draait de self-hosted Sapl compiler en JMVM direct in de browser via WebAssembly.\n", "normal");
    logTerminal("=========================================================================\n\n", "accent");
    logTerminal("📁 Open voorbeelden in de linkerbalk (o.a. 'paper_examples' en 'benchmarks').\n", "normal");
  }

  function logTerminal(text, type = "normal") {
    const span = document.createElement("span");
    if (type === "success") span.className = "log-success";
    else if (type === "error") span.className = "log-error";
    else if (type === "info") span.className = "log-info";
    else if (type === "warning") span.className = "log-warning";
    else if (type === "accent") span.className = "log-stage";
    else span.className = "log-muted";
    span.textContent = text;
    el.terminalContent.appendChild(span);
    el.terminalContent.scrollTop = el.terminalContent.scrollHeight;
  }

  function setStatus(type, text) {
    if (el.statusDot) {
      el.statusDot.className = `status-dot ${type}`;
    }
    if (el.statusText) {
      el.statusText.textContent = text;
    }
  }

  function updateMetricsUI(m) {
    if (el.metricRes) el.metricRes.textContent = m.res !== null ? m.res : "-";
    if (el.metricTime) el.metricTime.textContent = m.elapsed_time !== null ? `${m.elapsed_time}s` : "-";
    if (el.metricInstr) el.metricInstr.textContent = m.instr_executed ? m.instr_executed.toLocaleString() : "-";
    if (el.metricCalls) el.metricCalls.textContent = m.calls ? m.calls.toLocaleString() : "-";
    if (el.metricCreates) el.metricCreates.textContent = m.creates ? m.creates.toLocaleString() : "-";
    if (el.metricGc) el.metricGc.textContent = m.gc_count !== null ? m.gc_count : "-";
  }

  function handleTerminalPromptSubmit() {
    if (!el.terminalInput) return;
    const inputVal = el.terminalInput.value.trim();
    if (!inputVal) return;
    logTerminal(`Stdin > ${inputVal}\n`, "info");
    runJmvmFile(null, inputVal);
  }

  // --- PANEL TOGGLES ---
  function toggleSidebar(forceState) {
    const isHidden = el.appSidebar.classList.toggle("hidden", forceState === false ? true : (forceState === true ? false : undefined));
    el.btnToggleSidebar.classList.toggle("active", !isHidden);
    triggerEditorRefresh();
  }

  function toggleTerminal(forceState) {
    const isHidden = el.bottomPanel.classList.toggle("hidden", forceState === false ? true : (forceState === true ? false : undefined));
    el.btnToggleTerminal.classList.toggle("active", !isHidden);
    triggerEditorRefresh();
  }

  function toggleSettings(forceState) {
    const isHidden = el.settingsPanel.classList.toggle("hidden", forceState === false ? true : (forceState === true ? false : undefined));
    el.btnToggleSettings.classList.toggle("active", !isHidden);
    triggerEditorRefresh();
  }

  function triggerEditorRefresh() {
    setTimeout(() => {
      if (state.editor) state.editor.refresh();
    }, 50);
  }

  // --- EVENT LISTENERS ---
  function setupEventListeners() {
    el.btnSave.onclick = () => saveActiveFile();
    el.btnCompile.onclick = () => compileActiveFile(false);
    el.btnCompileRun.onclick = () => compileActiveFile(true);
    el.btnRun.onclick = () => runJmvmFile();
    if (el.btnTypecheck) el.btnTypecheck.onclick = () => runTypecheck();
    el.btnTheme.onclick = () => applyTheme(state.theme === "dark" ? "light" : "dark");
    el.btnRefreshTree.onclick = async () => { await loadTreeData(); renderTree(); };
    el.viewToggleBtn.onclick = () => toggleViewMode();
    el.btnClearTerminal.onclick = () => showWelcomeMessage();
    el.treeSearch.oninput = () => renderTree();

    // Modules-backend: welke van de drie compiler-radio's ook wisselt,
    // "Modules: manifest" toont/verbergt zich alleen op basis van of
    // "modules" nu gekozen is (zie updateModulesSectionVisibility).
    for (const radio of [el.compilerSapl, el.compilerRetag, el.compilerModules]) {
      if (radio) radio.addEventListener("change", updateModulesSectionVisibility);
    }
    // Eenmaal handmatig bewerkt onthoudt het veld dat (dataset.userEdited),
    // zodat updateCompilerConfigForFile een volgend .cfp-bestand niet
    // stilzwijgend over een bewuste eigen invoer heen schrijft.
    for (const input of [el.txtModulesScope, el.txtModulesManifest]) {
      if (input) input.addEventListener("input", () => { input.dataset.userEdited = "1"; });
    }
    if (el.btnModulesSuggest) el.btnModulesSuggest.onclick = () => suggestModulesManifest();

    // REPL panel
    if (el.btnOpenRepl) el.btnOpenRepl.onclick = () => openReplTab();
    if (el.btnReplHistory) el.btnReplHistory.onclick = () => sendReplLine(":history");
    if (el.btnReplUndo) el.btnReplUndo.onclick = () => sendReplLine(":undo");
    if (el.btnReplFuncs) el.btnReplFuncs.onclick = () => sendReplLine(":funcs");
    if (el.btnReplReset) {
      el.btnReplReset.onclick = () => {
        if (confirm("Sessie legen? (kan met Undo weer teruggezet worden)")) sendReplLine(":reset");
      };
    }
    if (el.btnReplLoad) el.btnReplLoad.onclick = () => sendReplLoad();
    if (el.selReplExample) {
      el.selReplExample.onchange = () => {
        const chosen = el.selReplExample.value;
        el.selReplExample.value = "";
        if (chosen) sendReplLine(`:load ${chosen}`);
      };
    }
    if (el.btnReplSave) el.btnReplSave.onclick = () => sendReplSave();
    if (el.btnReplSend) el.btnReplSend.onclick = () => sendReplInputLine();
    if (el.txtReplInput) el.txtReplInput.onkeydown = handleReplInputKeydown;
    if (el.txtReplLoad) el.txtReplLoad.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); sendReplLoad(); } };
    if (el.txtReplSave) el.txtReplSave.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); sendReplSave(); } };

    // Context Menu Handlers
    if (el.ctxCloseTab) el.ctxCloseTab.onclick = () => { if (state.contextMenuTabPath) closeTab(state.contextMenuTabPath); hideTabContextMenu(); };
    if (el.ctxCloseOthers) el.ctxCloseOthers.onclick = () => { if (state.contextMenuTabPath) closeOtherTabs(state.contextMenuTabPath); hideTabContextMenu(); };
    if (el.ctxCloseRight) el.ctxCloseRight.onclick = () => { if (state.contextMenuTabPath) closeTabsToRight(state.contextMenuTabPath); hideTabContextMenu(); };
    if (el.ctxCloseAll) el.ctxCloseAll.onclick = () => { closeAllTabs(); hideTabContextMenu(); };
    if (el.ctxKeepOpen) el.ctxKeepOpen.onclick = () => { if (state.contextMenuTabPath) keepOpenTab(state.contextMenuTabPath); hideTabContextMenu(); };

    window.addEventListener("click", () => hideTabContextMenu());
    window.addEventListener("contextmenu", (e) => { if (!e.target.closest(".tab-item")) hideTabContextMenu(); });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTabContextMenu(); });

    // Terminal Prompt Input
    if (el.terminalInput) {
      el.terminalInput.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleTerminalPromptSubmit();
        }
      };
    }
    if (el.btnTerminalSend) el.btnTerminalSend.onclick = () => handleTerminalPromptSubmit();

    // Panel Toggles
    el.btnToggleSidebar.onclick = () => toggleSidebar();
    if (el.btnCloseSidebar) el.btnCloseSidebar.onclick = () => toggleSidebar(false);

    el.btnToggleTerminal.onclick = () => toggleTerminal();
    if (el.btnCloseTerminal) el.btnCloseTerminal.onclick = () => toggleTerminal(false);

    el.btnToggleSettings.onclick = () => toggleSettings();
    if (el.btnCloseSettings) el.btnCloseSettings.onclick = () => toggleSettings(false);

    el.btnSelectAllStages.onclick = () => {
      for (const chk of Object.values(el.chkStages)) chk.checked = true;
    };
    el.btnSelectJmvmOnly.onclick = () => {
      for (const [k, chk] of Object.entries(el.chkStages)) chk.checked = (k === "jmvm");
    };

    // Keyboard Shortcuts
    window.addEventListener("keydown", (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (modKey && e.key === "s") {
        e.preventDefault();
        saveActiveFile();
      } else if (modKey && e.key === "b") {
        e.preventDefault();
        compileActiveFile(false);
      } else if ((modKey && e.key === "Enter") || e.key === "F5") {
        e.preventDefault();
        compileActiveFile(true);
      }
    });
  }

  // --- HELPERS ---
  function pathBasename(p) { return p.split("/").pop(); }
  function pathExt(p) {
    const base = pathBasename(p);
    const idx = base.lastIndexOf(".");
    return idx >= 0 ? base.substring(idx) : "";
  }
  function pathDirname(p) {
    const idx = p.lastIndexOf("/");
    return idx >= 0 ? p.substring(0, idx) : "";
  }
  // Kaal string-pad-join+normalize voor VFS-achtige paden (geen leidende
  // '/', '/'-gescheiden, mag '..'/'.'-segmenten bevatten) -- dezelfde
  // taak als Node's path.join+path.normalize, hier zelf gedaan omdat
  // geen van beide beschikbaar is in dit browser-only bestand. Gebruikt
  // om een manifest-regel (relatief aan de manifest-map) terug te
  // vertalen naar een echt project-pad (zie buildModulesFromActiveFile).
  function pathJoinNormalize(base, rel) {
    const parts = (base ? base.split("/") : []).concat(rel.split("/"));
    const stack = [];
    for (const part of parts) {
      if (part === "" || part === ".") continue;
      if (part === "..") { if (stack.length) stack.pop(); }
      else stack.push(part);
    }
    return stack.join("/");
  }
  // Kaal path.relative-equivalent voor VFS-achtige paden (geen leidende
  // '/', beide slash-gescheiden): vindt het gemeenschappelijke
  // mapvoorvoegsel, en '..'-t vervolgens uit de rest terug omlaag.
  // Gebruikt om een manifest-sleutel (relatief aan de manifest-map, niet
  // per se de map van het entry-bestand) te berekenen -- zie
  // buildModulesFromActiveFile/suggestModulesManifest voor waarom dat
  // onderscheid nodig is (build_modules.py resolvt paden relatief aan de
  // manifest-LOCATIE, niet aan waar de modules zelf staan).
  function pathRelative(fromDir, toPath) {
    const fromParts = fromDir ? fromDir.split("/") : [];
    const toParts = toPath.split("/");
    let i = 0;
    while (i < fromParts.length && i < toParts.length - 1 && fromParts[i] === toParts[i]) i++;
    const ups = fromParts.length - i;
    const downs = toParts.slice(i);
    return Array(ups).fill("..").concat(downs).join("/");
  }
  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  window.addEventListener("DOMContentLoaded", init);
})();
