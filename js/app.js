/**
 * Sapl Web Workbench — Online Client-side IDE & Compiler Pipeline
 * Direct WebAssembly runtime with self-hosted saplcomp and retagcomp.
 */

(function () {
  "use strict";

  // --- STATE ---
  const state = {
    theme: localStorage.getItem("websapl_theme") || "dark",
    treeData: [],
    fileMap: new Map(), // path -> { name, ext, content, isBinary, rawUrl }
    openTabs: [],
    activeTabPath: null,
    editor: null,
    worker: null,
    workerReady: false,
    isCompiling: false,
    isExecuting: false,
    contextMenuTabPath: null,
    pendingCompileCallbacks: new Map(),
    compileSeq: 0
  };

  // --- DOM ELEMENTS ---
  const el = {
    fileTree: document.getElementById("file-tree"),
    treeSearch: document.getElementById("tree-search"),
    tabBar: document.getElementById("tab-bar"),
    fileBreadcrumb: document.getElementById("file-breadcrumb"),
    tabStatus: document.getElementById("tab-status"),
    editorContainer: document.getElementById("editor-container"),
    markdownPreview: document.getElementById("markdown-preview"),
    pdfPreview: document.getElementById("pdf-preview"),
    pdfFrame: document.getElementById("pdf-frame"),
    viewToggleBtn: document.getElementById("btn-toggle-view"),
    
    // Tab Context Menu
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
    btnCompileRun: document.getElementById("btn-compile-run"),
    btnTheme: document.getElementById("btn-theme-toggle"),
    btnRefreshTree: document.getElementById("btn-refresh-tree"),
    
    // Intermediate Stage Info Section
    sectionStageInfo: document.getElementById("section-stage-info"),
    txtStageInfoBadge: document.getElementById("txt-stage-info-badge"),
    txtStageInfoDesc: document.getElementById("txt-stage-info-desc"),

    // Compiler Settings Sections
    sectionCompilerBackend: document.getElementById("section-compiler-backend"),
    lblCompilerSapl: document.getElementById("lbl-compiler-sapl"),
    lblCompilerRetag: document.getElementById("lbl-compiler-retag"),
    compilerSapl: document.getElementById("compiler-sapl"),
    compilerRetag: document.getElementById("compiler-retag"),
    
    sectionStrictness: document.getElementById("section-strictness"),
    chkStrictness: document.getElementById("chk-strictness"),
    
    sectionStages: document.getElementById("section-stages"),
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
    sectionEngine: document.getElementById("section-engine"),

    // Terminal & Metrics Elements
    terminalBody: document.getElementById("terminal-body"),
    btnClearTerminal: document.getElementById("btn-clear-terminal"),
    terminalInput: document.getElementById("terminal-input"),
    btnTerminalSend: document.getElementById("btn-terminal-send"),
    terminalPromptLabel: document.getElementById("terminal-prompt-label"),
    
    metricRes: document.getElementById("metric-res"),
    metricTime: document.getElementById("metric-time"),
    metricInstructions: document.getElementById("metric-instructions"),
    metricCalls: document.getElementById("metric-calls"),
    metricCreates: document.getElementById("metric-creates"),
    metricGc: document.getElementById("metric-gc")
  };

  // --- INITIALIZATION ---

  async function init() {
    applyTheme(state.theme);
    initCodeMirror();
    setupEventListeners();
    setupPanelTabs();
    initWorker();
    loadManifestFiles();
    renderTree();
    showWelcomeMessage();

    // Open first paper example or README if available
    if (state.fileMap.has("paper_examples/01_fac.cfp")) {
      openFile("paper_examples/01_fac.cfp", { preview: false });
    } else if (state.fileMap.has("paper_examples/README.md")) {
      openFile("paper_examples/README.md", { preview: false });
    }
  }

  // --- THEME ---

  function applyTheme(themeName) {
    state.theme = themeName;
    document.documentElement.setAttribute("data-theme", themeName);
    localStorage.setItem("websapl_theme", themeName);
    if (el.btnTheme) {
      el.btnTheme.textContent = themeName === "dark" ? "🌙" : "☀️";
    }
  }

  // --- WORKER INITIALIZATION ---

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
          handleWorkerCompileComplete(msg);
          break;

        case "RUN_COMPLETE":
          handleWorkerRunComplete(msg);
          break;

        default:
          break;
      }
    };

    const manifest = window.WEBSAPL_MANIFEST || {};
    state.worker.postMessage({
      type: "INIT",
      stdlib: window.STDLIB_DATA || "",
      saplcompBase64: manifest.saplcompBase64 || "",
      retagcompBase64: manifest.retagcompBase64 || ""
    });
  }

  function handleWorkerCompileComplete(msg) {
    state.isCompiling = false;
    const cb = state.pendingCompileCallbacks.get(msg.id);
    if (cb) {
      state.pendingCompileCallbacks.delete(msg.id);
      cb(msg);
    }
  }

  function handleWorkerRunComplete(msg) {
    state.isExecuting = false;
    setStatus("ready", "Gereed");
    if (msg.metrics) {
      updateMetricsUI(msg.metrics);
    }
    logTerminal(`\n[Uitvoering voltooid]\n`, "info");
  }

  // --- FILE MANIFEST & VFS ---

  function loadManifestFiles() {
    const manifest = window.WEBSAPL_MANIFEST || {};
    state.treeData = manifest.tree || [];
    state.fileMap.clear();

    function populateMap(nodes) {
      for (const node of nodes) {
        if (node.type === "file") {
          state.fileMap.set(node.path, node);
        } else if (node.type === "directory" && node.children) {
          populateMap(node.children);
        }
      }
    }
    populateMap(state.treeData);

    // Also load user files from LocalStorage if present
    try {
      const userFilesJson = localStorage.getItem("websapl_user_files");
      if (userFilesJson) {
        const userFiles = JSON.parse(userFilesJson);
        for (const [p, content] of Object.entries(userFiles)) {
          const name = pathBasename(p);
          const ext = pathExt(p);
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
      lineWrapping: true
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
    });
  }

  // --- TAB MANAGEMENT ---

  function getActiveTab() {
    return state.openTabs.find(t => t.path === state.activeTabPath);
  }

  function openFile(filePath, options = {}) {
    const isPreview = (options.preview === true);

    const existingIdx = state.openTabs.findIndex(t => t.path === filePath);
    if (existingIdx >= 0) {
      if (!isPreview && state.openTabs[existingIdx].isPreview) {
        state.openTabs[existingIdx].isPreview = false;
      }
      setActiveTab(filePath);
      return;
    }

    const fileObj = state.fileMap.get(filePath);
    if (!fileObj) {
      // Create memory file
      const name = pathBasename(filePath);
      const ext = pathExt(filePath);
      const newFile = {
        path: filePath,
        name: name,
        ext: ext,
        content: "",
        originalContent: "",
        isDirty: false,
        isPreview: isPreview,
        viewMode: ext === ".md" ? "render" : "edit",
        isBinary: ext === ".pdf",
        rawUrl: filePath
      };
      state.fileMap.set(filePath, newFile);
      state.openTabs.push(newFile);
      setActiveTab(filePath);
      return;
    }

    if (isPreview) {
      const previewIdx = state.openTabs.findIndex(t => t.isPreview && !t.isDirty);
      if (previewIdx >= 0) {
        state.openTabs.splice(previewIdx, 1);
      }
    }

    const newTab = {
      path: fileObj.path,
      name: fileObj.name,
      ext: fileObj.ext || pathExt(fileObj.name),
      content: fileObj.content || "",
      originalContent: fileObj.content || "",
      isDirty: false,
      isPreview: isPreview,
      viewMode: fileObj.ext === ".md" ? "render" : "edit",
      isBinary: fileObj.isBinary || fileObj.ext === ".pdf",
      rawUrl: fileObj.rawUrl || fileObj.path
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
      setStatus("ready", "Gereed");
      state.editor.setValue("");
      return;
    }

    el.fileBreadcrumb.textContent = tab.path;
    setStatus("ready", tab.isDirty ? "Aangepast" : "Gereed");

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
        el.viewToggleBtn.innerHTML = "<span>✏️</span> Bewerk Markdown";
      }
    } else {
      if (el.pdfPreview) el.pdfPreview.style.display = "none";
      if (el.markdownPreview) el.markdownPreview.style.display = "none";
      if (el.editorContainer) el.editorContainer.style.display = "block";

      if (tab.ext === ".md") {
        if (el.viewToggleBtn) {
          el.viewToggleBtn.style.display = "inline-flex";
          el.viewToggleBtn.innerHTML = "<span>📖</span> Bekijk Markdown";
        }
      } else {
        if (el.viewToggleBtn) el.viewToggleBtn.style.display = "none";
      }

      state.editor.setValue(tab.content);
      state.editor.clearHistory();

      if (tab.ext === ".cfp" || tab.ext.startsWith(".cfp_")) {
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
        if (el.editorContainer) el.editorContainer.style.display = "block";
      }
    }
    renderTabs();
  }

  function renderTabs() {
    el.tabBar.innerHTML = "";

    for (const tab of state.openTabs) {
      const tabEl = document.createElement("div");
      tabEl.className = "tab-item" +
        (tab.path === state.activeTabPath ? " active" : "") +
        (tab.isPreview ? " preview" : "");
      tabEl.dataset.path = tab.path;

      const iconInfo = getFileIcon(tab.name, tab.ext);
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

      el.tabBar.appendChild(tabEl);
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

  // --- COMPILER & CONTEXT CONFIG ---

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
    } else if (tab.ext === ".cfp") {
      // Original source file: saplcomp in WASM
      if (el.lblCompilerSapl) el.lblCompilerSapl.style.display = "flex";
      if (el.lblCompilerRetag) el.lblCompilerRetag.style.display = "none";
      if (el.compilerSapl) el.compilerSapl.checked = true;

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
      // .md, .pdf, etc.
      if (el.btnCompile) el.btnCompile.style.display = "none";
      if (el.btnCompileRun) el.btnCompileRun.style.display = "none";
      if (el.btnRun) el.btnRun.style.display = "none";
      if (el.sectionStageInfo) el.sectionStageInfo.style.display = "none";
      if (el.sectionCompilerBackend) el.sectionCompilerBackend.style.display = "none";
      if (el.sectionStrictness) el.sectionStrictness.style.display = "none";
      if (el.sectionStages) el.sectionStages.style.display = "none";
      if (el.sectionEngine) el.sectionEngine.style.display = "none";
    }
  }

  // --- ACTIONS: SAVE, COMPILE, RUN ---

  function saveActiveFile() {
    const activeTab = getActiveTab();
    if (!activeTab) return;

    activeTab.content = state.editor.getValue();
    activeTab.originalContent = activeTab.content;
    activeTab.isDirty = false;
    activeTab.isPreview = false;

    // Save in fileMap and localStorage
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
    setStatus("ready", "Opgeslagen");
    logTerminal(`✓ Opgeslagen: ${activeTab.path}\n`, "success");
  }

  async function compileActiveFile(andRun = false) {
    const activeTab = getActiveTab();
    if (!activeTab) return;

    if (state.isCompiling) return;
    state.isCompiling = true;

    // Save content before compiling
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
    setStatus("busy", "Compileren...");

    const compileId = ++state.compileSeq;

    state.pendingCompileCallbacks.set(compileId, (data) => {
      if (data.stdout) logTerminal(data.stdout, "normal");
      if (data.stderr) logTerminal(data.stderr, "warning");

      if (data.success && data.files && data.files.length > 0) {
        setStatus("ready", `Gecompileerd (${data.durationMs}ms)`);
        logTerminal(`✓ Succesvol gecompileerd in ${data.durationMs}ms (${data.files.length} bestanden gegenereerd)\n`, "success");

        // Add generated files to fileMap and tabs
        for (const f of data.files) {
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

        // Switch to .jmvm tab or last generated stage
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

  async function runJmvmFile(filePath, customStdin = "") {
    const activeTab = getActiveTab();
    let targetPath = filePath;
    let targetContent = "";

    if (!targetPath) {
      if (!activeTab) return;
      if (activeTab.ext === ".jmvm") {
        targetPath = activeTab.path;
        targetContent = activeTab.content;
      } else if (activeTab.ext === ".cfp") {
        // Compile and run
        compileActiveFile(true);
        return;
      }
    } else {
      const fileObj = state.fileMap.get(targetPath);
      if (fileObj) targetContent = fileObj.content;
    }

    if (state.isExecuting) return;
    state.isExecuting = true;

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
    el.terminalBody.innerHTML = "";
    logTerminal("=========================================================================\n", "accent");
    logTerminal("🚀 Welkom bij de Sapl Web Workbench (WASM Edition)\n", "accent");
    logTerminal("Draait de self-hosted Sapl compiler en JMVM direct in de browser via WebAssembly.\n", "normal");
    logTerminal("=========================================================================\n\n", "accent");
    logTerminal("📁 Open voorbeelden in de linkerbalk (o.a. 'paper_examples' en 'benchmarks').\n", "normal");
  }

  function logTerminal(text, type = "normal") {
    const span = document.createElement("span");
    span.className = `log-${type}`;
    span.textContent = text;
    el.terminalBody.appendChild(span);
    el.terminalBody.scrollTop = el.terminalBody.scrollHeight;
  }

  function setStatus(type, text) {
    if (!el.tabStatus) return;
    el.tabStatus.className = `tab-status ${type}`;
    el.tabStatus.textContent = text;
  }

  function updateMetricsUI(m) {
    if (el.metricRes) el.metricRes.textContent = m.res !== null ? m.res : "-";
    if (el.metricTime) el.metricTime.textContent = m.elapsed_time !== null ? m.elapsed_time : "-";
    if (el.metricInstructions) el.metricInstructions.textContent = m.instr_executed ? m.instr_executed.toLocaleString() : "-";
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

  // --- PANEL TOGGLES & TABS ---

  function toggleSidebar(forceState) {
    const isVisible = (forceState !== undefined) ? forceState : el.appSidebar.classList.contains("collapsed");
    el.appSidebar.classList.toggle("collapsed", !isVisible);
    el.btnToggleSidebar.classList.toggle("active", isVisible);
  }

  function toggleTerminal(forceState) {
    const isVisible = (forceState !== undefined) ? forceState : el.bottomPanel.classList.contains("collapsed");
    el.bottomPanel.classList.toggle("collapsed", !isVisible);
    el.btnToggleTerminal.classList.toggle("active", isVisible);
  }

  function toggleSettings(forceState) {
    const isVisible = (forceState !== undefined) ? forceState : el.settingsPanel.classList.contains("collapsed");
    el.settingsPanel.classList.toggle("collapsed", !isVisible);
    el.btnToggleSettings.classList.toggle("active", isVisible);
  }

  function setupPanelTabs() {
    const tabBtns = el.bottomPanel.querySelectorAll(".panel-tab");
    const contents = el.bottomPanel.querySelectorAll(".panel-content");

    tabBtns.forEach(btn => {
      btn.onclick = () => {
        const target = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.toggle("active", b === btn));
        contents.forEach(c => c.classList.toggle("active", c.id === `content-${target}`));
      };
    });
  }

  // --- EVENT LISTENERS ---

  function setupEventListeners() {
    el.btnSave.onclick = () => saveActiveFile();
    el.btnCompile.onclick = () => compileActiveFile(false);
    el.btnCompileRun.onclick = () => compileActiveFile(true);
    el.btnRun.onclick = () => runJmvmFile();
    el.btnTheme.onclick = () => applyTheme(state.theme === "dark" ? "light" : "dark");
    el.btnRefreshTree.onclick = () => { loadManifestFiles(); renderTree(); };
    el.viewToggleBtn.onclick = () => toggleViewMode();
    el.btnClearTerminal.onclick = () => showWelcomeMessage();
    el.treeSearch.oninput = () => renderTree();

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
  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  window.addEventListener("DOMContentLoaded", init);
})();
