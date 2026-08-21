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
    compileSeq: 0
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
    btnCompileRun: document.getElementById("btn-compile-run"),
    btnTheme: document.getElementById("btn-theme-toggle"),
    btnRefreshTree: document.getElementById("btn-refresh-tree"),
    
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
    lblCompilerSapl: document.getElementById("lbl-compiler-sapl"),
    lblCompilerRetag: document.getElementById("lbl-compiler-retag"),
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

    // Default: open first paper example or README
    setTimeout(() => {
      if (state.fileMap.has("paper_examples/01_fac.cfp")) {
        openFile("paper_examples/01_fac.cfp", { preview: false });
      } else if (state.fileMap.has("paper_examples/README.md")) {
        openFile("paper_examples/README.md", { preview: false });
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
    el.tabsBar.innerHTML = "";

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
    } else if (tab.ext === ".cfp") {
      // Original source file
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

  async function compileActiveFile(andRun = false) {
    const activeTab = getActiveTab();
    if (!activeTab) return;

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
    el.btnTheme.onclick = () => applyTheme(state.theme === "dark" ? "light" : "dark");
    el.btnRefreshTree.onclick = async () => { await loadTreeData(); renderTree(); };
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
