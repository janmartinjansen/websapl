/* Streamlined English Sapl Workbench (benchmarks, local user files, single-view compiler stages) */
(function () {
  "use strict";

  const USER_FILES_KEY = "websapl_workbench_files";
  const OVERRIDES_KEY = "websapl_workbench_overrides";
  const THEME_KEY = "websapl_theme";
  const GUIDE_PATH = "WORKBENCH_README.md";
  const ALL_STAGES = ["types", "cfp", "parse", "strictness", "bool", "lazytag", "lift", "retag", "jmvm"];

  const FALLBACK_GUIDE_MD = [
    "## Sapl Workbench — Quick Guide",
    "",
    "**Sapl Workbench** is a 100% client-side WebAssembly environment for **Core Sapl** (`.cfp`) and **Sapl+** (`.spp`), executing compiled bytecode on **JMVM** (Jansen's Minimal Virtual Machine).",
    "",
    "### Files & Stages",
    "- **My Files**: Click **+ New** to create `.spp` or `.cfp` programs saved in your browser (`localStorage`).",
    "- **View Bar**: Inspect inferred `types` or compiler stages (`cfp`, `parse`, `strictness`, `bool`, `lazytag`, `lift`, `retag`, `jmvm`) one at a time.",
    "",
    "### Quick Examples to Try",
    "- [benchmarks_sapl/fib.cfp](?file=benchmarks_sapl/fib.cfp)",
    "- [benchmarks_saplplus/queens.spp](?file=benchmarks_saplplus/queens.spp)"
  ].join("\n");

  const STARTER_SPP = [
    "// New Sapl+ program",
    "import \"lib/list.spp\" as L",
    "",
    "fibs =: 0 : 1 : L.zipWith (+) fibs (L.tail fibs)",
    "",
    "start = L.nth 10 fibs"
  ].join("\n") + "\n";

  const STARTER_CFP = [
    "|| New Core Sapl program",
    "#import \"lib/stdlib.cfp\"",
    "",
    "fac !n = if (n <= 1) 1 (n * fac (n - 1))",
    "",
    "start = fac 10"
  ].join("\n") + "\n";

  const state = {
    worker: null,
    workerReady: false,
    isBusy: false,
    compileSeq: 0,
    pendingCallbacks: new Map(),
    editor: null,
    ignoreEditorChange: false,

    userFiles: {},     // path -> content (e.g. "my_files/demo.spp")
    overrides: {},     // benchmark path -> edited content
    originals: new Map(), // benchmark path -> manifest/fetched content
    fileMap: new Map(),   // path -> file metadata
    groups: {
      myFiles: { expanded: true },
      saplPlusDemo: { expanded: true },
      sapl: { expanded: true },
      saplPlus: { expanded: true }
    },

    openTabs: [],
    activeTabPath: null,
    pendingDeletePath: null,
    pendingStageRefresh: false,
    guideMarkdown: null
  };

  const el = {
    sidebar: document.getElementById("app-sidebar"),
    fileTree: document.getElementById("file-tree"),
    treeSearch: document.getElementById("tree-search"),
    tabsBar: document.getElementById("tabs-bar"),
    breadcrumb: document.getElementById("file-breadcrumb"),
    btnResetBenchmark: document.getElementById("btn-reset-benchmark"),

    stageBar: document.getElementById("stage-bar"),
    btnStageCfp: document.getElementById("btn-stage-cfp"),
    stageStatus: document.getElementById("stage-status"),
    stageReadonlyLabel: document.getElementById("stage-readonly-label"),
    btnBackToSource: document.getElementById("btn-back-to-source"),

    editorContainer: document.getElementById("editor-container"),
    guidePreview: document.getElementById("guide-preview"),
    bottomPanel: document.getElementById("bottom-panel"),
    terminalContent: document.getElementById("terminal-content"),
    terminalInput: document.getElementById("terminal-input"),
    btnTerminalSend: document.getElementById("btn-terminal-send"),
    btnClearTerminal: document.getElementById("btn-clear-terminal"),

    metricRes: document.getElementById("metric-res"),
    metricTime: document.getElementById("metric-time"),
    metricInstr: document.getElementById("metric-instr"),
    metricCreates: document.getElementById("metric-creates"),
    metricCalls: document.getElementById("metric-calls"),
    metricGc: document.getElementById("metric-gc"),

    btnNewFile: document.getElementById("btn-new-file"),
    btnSidebarNew: document.getElementById("btn-sidebar-new"),
    btnSave: document.getElementById("btn-save"),
    btnCompileRun: document.getElementById("btn-compile-run"),
    btnRun: document.getElementById("btn-run"),
    chkStrictness: document.getElementById("chk-strictness"),

    btnToggleSidebar: document.getElementById("btn-toggle-sidebar"),
    btnOpenGuide: document.getElementById("btn-open-guide"),
    btnCloseSidebar: document.getElementById("btn-close-sidebar"),
    btnToggleTerminal: document.getElementById("btn-toggle-terminal"),
    btnCloseTerminal: document.getElementById("btn-close-terminal"),
    btnThemeToggle: document.getElementById("btn-theme-toggle"),

    statusDot: document.getElementById("status-dot"),
    statusText: document.getElementById("status-text"),

    newFileDialog: document.getElementById("new-file-dialog"),
    newFileForm: document.getElementById("new-file-form"),
    newFileName: document.getElementById("new-file-name"),
    newFileLang: document.getElementById("new-file-lang"),
    newFileStarter: document.getElementById("new-file-starter"),
    newFileError: document.getElementById("new-file-error"),

    deleteFileDialog: document.getElementById("delete-file-dialog"),
    deleteFileDesc: document.getElementById("delete-file-desc")
  };

  // --- THEME (meta color-scheme + data-theme sync for workbench.css) ---
  function initTheme() {
    const meta = document.querySelector('meta[name="color-scheme"]');
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const osTheme = () => (mql.matches ? "dark" : "light");
    const renderedTheme = () => (meta.content === "light" || meta.content === "dark" ? meta.content : osTheme());

    function syncVisual(stored) {
      meta.content = stored === "light" || stored === "dark" ? stored : "light dark";
      document.documentElement.setAttribute("data-theme", renderedTheme());
    }

    el.btnThemeToggle.addEventListener("click", () => {
      const target = renderedTheme() === "dark" ? "light" : "dark";
      if (target === osTheme()) {
        try { localStorage.removeItem(THEME_KEY); } catch (_) {}
        syncVisual(null);
      } else {
        try { localStorage.setItem(THEME_KEY, target); } catch (_) {}
        syncVisual(target);
      }
    });

    mql.addEventListener("change", () => {
      if (meta.content === "light dark") {
        document.documentElement.setAttribute("data-theme", osTheme());
      }
    });

    window.addEventListener("storage", (e) => {
      if (e.key === THEME_KEY) syncVisual(e.newValue);
    });

    try { syncVisual(localStorage.getItem(THEME_KEY)); } catch (_) { syncVisual(null); }
  }

  // --- PROGRESSIVE ENHANCEMENTS (switch, invoker commands, dialog closedby) ---
  function initProgressiveFeatures() {
    if (el.chkStrictness && !("switch" in HTMLInputElement.prototype)) {
      el.chkStrictness.setAttribute("role", "switch");
      el.chkStrictness.classList.add("switch-fallback");
    }

    if (!("commandForElement" in HTMLButtonElement.prototype)) {
      for (const btn of document.querySelectorAll('button[command="show-modal"][commandfor]')) {
        btn.addEventListener("click", () => {
          const dlg = document.getElementById(btn.getAttribute("commandfor"));
          if (dlg && !dlg.open) dlg.showModal();
        });
      }
    }

    if (!("closedBy" in HTMLDialogElement.prototype)) {
      const outside = (e, dialog) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
        let pressedOutside = false;
        dialog.addEventListener("pointerdown", (e) => { pressedOutside = outside(e, dialog); });
        dialog.addEventListener("pointerup", (e) => { if (pressedOutside && outside(e, dialog)) dialog.close(); });
      }
    }
  }

  // --- STORAGE ---
  function loadLocalStorage() {
    try {
      const rawUsers = localStorage.getItem(USER_FILES_KEY);
      if (rawUsers) state.userFiles = JSON.parse(rawUsers) || {};
    } catch (_) {
      state.userFiles = {};
    }
    try {
      const rawOverrides = localStorage.getItem(OVERRIDES_KEY);
      if (rawOverrides) state.overrides = JSON.parse(rawOverrides) || {};
    } catch (_) {
      state.overrides = {};
    }
  }

  function persistUserFiles() {
    try {
      localStorage.setItem(USER_FILES_KEY, JSON.stringify(state.userFiles));
    } catch (err) {
      logTerminal(`Warning: could not save to browser storage (${err.message}).\n`, "warning");
    }
  }

  function persistOverrides() {
    try {
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(state.overrides));
    } catch (err) {
      logTerminal(`Warning: could not save edits to browser storage (${err.message}).\n`, "warning");
    }
  }

  // --- STATUS & TERMINAL ---
  function setStatus(kind, text) {
    el.statusDot.className = "status-dot " + kind;
    el.statusText.textContent = text;
  }

  function logTerminal(text, cls = "normal") {
    const span = document.createElement("span");
    if (cls !== "normal") span.className = "log-" + cls;
    span.textContent = text;
    el.terminalContent.appendChild(span);
    el.terminalContent.scrollTop = el.terminalContent.scrollHeight;
  }

  function resetMetricsUI() {
    el.metricRes.textContent = "-";
    el.metricTime.textContent = "-";
    el.metricInstr.textContent = "-";
    el.metricCalls.textContent = "-";
    el.metricCreates.textContent = "-";
    el.metricGc.textContent = "-";
  }

  function updateMetricsUI(m) {
    if (!m) return;
    el.metricRes.textContent = m.res !== null && m.res !== undefined ? m.res : "-";
    el.metricTime.textContent = m.elapsed_time !== null && m.elapsed_time !== undefined ? `${m.elapsed_time}s` : "-";
    el.metricInstr.textContent = m.instr_executed ? m.instr_executed.toLocaleString() : "-";
    el.metricCalls.textContent = m.calls ? m.calls.toLocaleString() : "-";
    el.metricCreates.textContent = m.creates ? m.creates.toLocaleString() : "-";
    el.metricGc.textContent = m.gc_count !== null && m.gc_count !== undefined ? m.gc_count : "-";
  }

  // --- WORKER ---
  function initWorker() {
    state.worker = new Worker("engine/worker.js?v=" + Date.now());
    state.worker.onmessage = (e) => {
      const msg = e.data;
      switch (msg.type) {
        case "INIT_DONE":
          state.workerReady = true;
          setStatus("ready", "Ready");
          logTerminal("WebAssembly JMVM engine ready.\n", "success");
          break;
        case "STDOUT":
          logTerminal(msg.text, "normal");
          break;
        case "STDERR":
          logTerminal(msg.text, "warning");
          break;
        case "COMPILE_COMPLETE": {
          const cb = state.pendingCallbacks.get(msg.id);
          if (cb) {
            state.pendingCallbacks.delete(msg.id);
            cb(msg);
          }
          break;
        }
        case "RUN_COMPLETE": {
          const runCb = msg.id ? state.pendingCallbacks.get(msg.id) : null;
          if (runCb) {
            state.pendingCallbacks.delete(msg.id);
            runCb(msg);
          } else {
            state.isBusy = false;
            setStatus("ready", "Ready");
            if (msg.metrics) updateMetricsUI(msg.metrics);
            logTerminal("\n[Execution finished]\n", "info");
          }
          break;
        }
        default:
          break;
      }
    };

    state.worker.postMessage({
      type: "INIT",
      stdlib: window.STDLIB_DATA || ""
    });
  }

  function callWorker(payload) {
    return new Promise((resolve) => {
      const id = ++state.compileSeq;
      state.pendingCallbacks.set(id, resolve);
      state.worker.postMessage({ ...payload, id });
    });
  }

  // --- CODEMIRROR ---
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
      if (state.ignoreEditorChange) return;
      const tab = getActiveTab();
      if (!tab || tab.ext === ".md" || tab.activeStage !== "source") return;

      const val = state.editor.getValue();
      tab.content = val;
      tab.isDirty = val !== tab.originalContent;
      tab.stageCache.clear();
      renderTabs();
      updateBreadcrumb(tab);
      setStatus(tab.isDirty ? "busy" : "ready", tab.isDirty ? "Modified" : "Ready");
    });
  }

  // --- FILE TREE LOADING (ONLY standard benchmarks + My Files) ---
  function extOf(name) {
    const idx = name.lastIndexOf(".");
    return idx >= 0 ? name.slice(idx).toLowerCase() : "";
  }

  function baseOf(p) {
    return p.split("/").pop();
  }

  async function loadManifestBenchmarks() {
    let rawTree = [];
    if (window.WEBSAPL_TREE && Array.isArray(window.WEBSAPL_TREE)) {
      rawTree = window.WEBSAPL_TREE;
    } else {
      try {
        const res = await fetch("manifest.json");
        if (res.ok) {
          const data = await res.json();
          rawTree = data.tree || [];
        }
      } catch (err) {
        logTerminal(`Warning: failed to load manifest (${err.message}).\n`, "warning");
      }
    }

    function collectFolder(dirName, targetExts) {
      const exts = Array.isArray(targetExts) ? targetExts : [targetExts];
      const dir = rawTree.find((n) => n.type === "directory" && n.name === dirName);
      if (!dir || !Array.isArray(dir.children)) return [];
      return dir.children
        .filter((f) => f.type === "file" && exts.includes(extOf(f.name)))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    state.fileMap.clear();

    for (const f of collectFolder("sapl_plus_demo_en", [".md", ".spp"])) {
      const original = typeof f.content === "string" ? f.content : "";
      const ext = extOf(f.name);
      state.originals.set(f.path, original);
      const effective = (ext !== ".md" && Object.prototype.hasOwnProperty.call(state.overrides, f.path))
        ? state.overrides[f.path]
        : original;
      state.fileMap.set(f.path, {
        name: f.name,
        path: f.path,
        ext,
        group: "saplPlusDemo",
        isUserFile: false,
        content: effective
      });
    }

    for (const f of collectFolder("benchmarks_sapl", ".cfp")) {
      const original = typeof f.content === "string" ? f.content : "";
      state.originals.set(f.path, original);
      const effective = Object.prototype.hasOwnProperty.call(state.overrides, f.path)
        ? state.overrides[f.path]
        : original;
      state.fileMap.set(f.path, {
        name: f.name,
        path: f.path,
        ext: ".cfp",
        group: "sapl",
        isUserFile: false,
        content: effective
      });
    }

    for (const f of collectFolder("benchmarks_saplplus", ".spp")) {
      const original = typeof f.content === "string" ? f.content : "";
      state.originals.set(f.path, original);
      const effective = Object.prototype.hasOwnProperty.call(state.overrides, f.path)
        ? state.overrides[f.path]
        : original;
      state.fileMap.set(f.path, {
        name: f.name,
        path: f.path,
        ext: ".spp",
        group: "saplPlus",
        isUserFile: false,
        content: effective
      });
    }

    for (const [p, content] of Object.entries(state.userFiles)) {
      const name = baseOf(p);
      state.fileMap.set(p, {
        name,
        path: p,
        ext: extOf(name) || ".spp",
        group: "myFiles",
        isUserFile: true,
        content
      });
    }
  }

  function renderTree() {
    el.fileTree.innerHTML = "";
    const filter = el.treeSearch.value.trim().toLowerCase();

    const sections = [
      {
        key: "myFiles",
        label: "My Files",
        files: Array.from(state.fileMap.values())
          .filter((f) => f.isUserFile)
          .sort((a, b) => a.name.localeCompare(b.name))
      },
      {
        key: "saplPlusDemo",
        label: "Sapl+ Demo",
        files: Array.from(state.fileMap.values())
          .filter((f) => f.group === "saplPlusDemo")
          .sort((a, b) => {
            if (a.ext === ".md" && b.ext !== ".md") return -1;
            if (a.ext !== ".md" && b.ext === ".md") return 1;
            return a.name.localeCompare(b.name);
          })
      },
      {
        key: "sapl",
        label: "Sapl Benchmarks (.cfp)",
        files: Array.from(state.fileMap.values())
          .filter((f) => f.group === "sapl")
          .sort((a, b) => a.name.localeCompare(b.name))
      },
      {
        key: "saplPlus",
        label: "Sapl+ Benchmarks (.spp)",
        files: Array.from(state.fileMap.values())
          .filter((f) => f.group === "saplPlus")
          .sort((a, b) => a.name.localeCompare(b.name))
      }
    ];

    for (const sec of sections) {
      const visibleFiles = filter
        ? sec.files.filter((f) => f.name.toLowerCase().includes(filter))
        : sec.files;

      if (filter && visibleFiles.length === 0 && !sec.label.toLowerCase().includes(filter)) {
        continue;
      }

      const groupDiv = document.createElement("div");
      groupDiv.className = "tree-group";

      const isExpanded = Boolean(filter) || state.groups[sec.key].expanded;
      const folderBtn = document.createElement("button");
      folderBtn.type = "button";
      folderBtn.className = "tree-folder-btn";
      folderBtn.setAttribute("aria-expanded", String(isExpanded));

      const arrow = document.createElement("span");
      arrow.className = "tree-arrow" + (isExpanded ? " expanded" : "");
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "▶";
      folderBtn.appendChild(arrow);

      const folderIcon = document.createElement("span");
      folderIcon.setAttribute("aria-hidden", "true");
      folderIcon.textContent = sec.key === "myFiles" ? "📝" : "📁";
      folderBtn.appendChild(folderIcon);

      const title = document.createElement("span");
      title.textContent = sec.label;
      folderBtn.appendChild(title);

      const ul = document.createElement("ul");
      ul.className = "tree-list";
      ul.hidden = !isExpanded;

      folderBtn.addEventListener("click", () => {
        const next = !state.groups[sec.key].expanded;
        state.groups[sec.key].expanded = next;
        folderBtn.setAttribute("aria-expanded", String(next));
        arrow.className = "tree-arrow" + (next ? " expanded" : "");
        ul.hidden = !next;
      });

      groupDiv.appendChild(folderBtn);

      if (visibleFiles.length === 0) {
        const empty = document.createElement("li");
        empty.className = "tree-empty";
        empty.textContent = "No saved files yet — click + New";
        ul.appendChild(empty);
      } else {
        for (const f of visibleFiles) {
          const li = document.createElement("li");
          li.className = "tree-file-row";

          const fileBtn = document.createElement("button");
          fileBtn.type = "button";
          fileBtn.className = "tree-file-btn" + (f.path === state.activeTabPath ? " active" : "");

          const badge = document.createElement("span");
          badge.setAttribute("aria-hidden", "true");
          if (f.ext === ".md") {
            badge.className = "tree-icon";
            badge.textContent = "📄";
          } else {
            badge.className = "tree-icon " + (f.ext === ".spp" ? "file-icon-ama" : "file-icon-cfp");
            badge.textContent = f.ext === ".spp" ? "λ+" : "λ";
          }
          fileBtn.appendChild(badge);

          const nameSpan = document.createElement("span");
          nameSpan.textContent = f.name;
          fileBtn.appendChild(nameSpan);

          fileBtn.addEventListener("click", () => openFile(f.path));
          li.appendChild(fileBtn);

          if (f.isUserFile) {
            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "tree-del-btn";
            delBtn.setAttribute("aria-label", `Delete ${f.name}`);
            delBtn.textContent = "✕";
            delBtn.addEventListener("click", () => requestDeleteUserFile(f.path));
            li.appendChild(delBtn);
          }

          ul.appendChild(li);
        }
      }

      groupDiv.appendChild(ul);
      el.fileTree.appendChild(groupDiv);
    }
  }

  // --- TABS, GUIDE & SINGLE-VIEW STAGE DISPLAY ---
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderGuideHtml(md) {
    if (window.marked && typeof window.marked.parse === "function") {
      el.guidePreview.innerHTML = window.marked.parse(md);
    } else {
      el.guidePreview.innerHTML = `<pre>${escapeHtml(md)}</pre>`;
    }
  }

  async function openGuide() {
    const existing = state.openTabs.find((t) => t.path === GUIDE_PATH);
    if (existing) {
      setActiveTab(GUIDE_PATH);
      return;
    }

    if (!state.guideMarkdown) {
      try {
        const res = await fetch(GUIDE_PATH);
        state.guideMarkdown = res.ok ? await res.text() : FALLBACK_GUIDE_MD;
      } catch (_) {
        state.guideMarkdown = FALLBACK_GUIDE_MD;
      }
    }

    state.openTabs.unshift({
      path: GUIDE_PATH,
      name: "README.md",
      ext: ".md",
      isGuide: true,
      isUserFile: false,
      content: state.guideMarkdown,
      originalContent: state.guideMarkdown,
      isDirty: false,
      activeStage: "source",
      stageCache: new Map()
    });

    setActiveTab(GUIDE_PATH);
  }

  function getActiveTab() {
    return state.openTabs.find((t) => t.path === state.activeTabPath) || null;
  }

  async function openFile(filePath) {
    let tab = state.openTabs.find((t) => t.path === filePath);
    if (!tab) {
      let f = state.fileMap.get(filePath);
      if (!f) return;

      let content = f.content;
      if (!f.isUserFile && !content) {
        try {
          const res = await fetch(filePath);
          if (res.ok) {
            content = await res.text();
            state.originals.set(filePath, content);
            f.content = content;
          }
        } catch (err) {
          logTerminal(`Error loading ${filePath}: ${err.message}\n`, "error");
          return;
        }
      }

      tab = {
        path: f.path,
        name: f.name,
        ext: f.ext,
        isUserFile: f.isUserFile,
        content: content,
        originalContent: content,
        isDirty: false,
        activeStage: "source",
        stageCache: new Map()
      };
      state.openTabs.push(tab);
    }

    setActiveTab(tab.path);
  }

  function setActiveTab(filePath) {
    state.activeTabPath = filePath;
    const tab = getActiveTab();
    renderTabs();
    renderTree();
    updateBreadcrumb(tab);

    const isGuide = Boolean(tab && tab.isGuide);
    const isMd = Boolean(tab && (tab.isGuide || tab.ext === ".md"));
    el.btnOpenGuide.classList.toggle("active", isGuide);
    el.btnOpenGuide.setAttribute("aria-pressed", String(isGuide));

    const codeDisabled = !tab || isMd;
    el.btnSave.disabled = codeDisabled;
    el.btnCompileRun.disabled = codeDisabled;
    el.btnRun.disabled = codeDisabled;

    if (isMd) {
      el.stageBar.style.display = "none";
      el.editorContainer.style.display = "none";
      el.guidePreview.style.display = "block";
      renderGuideHtml(tab.content);
      return;
    }

    el.guidePreview.style.display = "none";
    el.editorContainer.style.display = "";
    el.stageBar.style.display = "";

    if (!tab) {
      el.btnStageCfp.classList.add("hidden");
      el.stageStatus.style.display = "none";
      state.ignoreEditorChange = true;
      state.editor.setValue("");
      state.editor.setOption("readOnly", true);
      state.ignoreEditorChange = false;
      state.editor.refresh();
      return;
    }

    // Show .cfp stage button only when a .spp file is open
    const isSpp = tab.ext === ".spp";
    el.btnStageCfp.classList.toggle("hidden", !isSpp);
    if (!isSpp && tab.activeStage === "cfp") {
      tab.activeStage = "source";
    }

    showStage(tab.activeStage);
    state.editor.refresh();
    requestAnimationFrame(() => state.editor.refresh());
  }

  function closeTab(filePath) {
    const idx = state.openTabs.findIndex((t) => t.path === filePath);
    if (idx < 0) return;
    state.openTabs.splice(idx, 1);

    if (state.activeTabPath === filePath) {
      const next = state.openTabs[idx] || state.openTabs[idx - 1] || null;
      setActiveTab(next ? next.path : null);
    } else {
      renderTabs();
    }
  }

  function renderTabs() {
    el.tabsBar.innerHTML = "";
    for (const tab of state.openTabs) {
      const item = document.createElement("div");
      item.className = "tab-item" + (tab.path === state.activeTabPath ? " active" : "");

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "tab-select-btn";

      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      if (tab.isGuide) {
        icon.textContent = "📖";
      } else if (tab.ext === ".md") {
        icon.textContent = "📄";
      } else {
        icon.className = tab.ext === ".spp" ? "file-icon-ama" : "file-icon-cfp";
        icon.textContent = tab.ext === ".spp" ? "λ+" : "λ";
      }
      selectBtn.appendChild(icon);

      const title = document.createElement("span");
      title.textContent = tab.name;
      selectBtn.appendChild(title);

      if (tab.isDirty) {
        const dot = document.createElement("span");
        dot.className = "tab-dirty";
        dot.setAttribute("aria-label", "Unsaved changes");
        selectBtn.appendChild(dot);
      }

      selectBtn.addEventListener("click", () => setActiveTab(tab.path));
      item.appendChild(selectBtn);

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "tab-close-btn";
      closeBtn.setAttribute("aria-label", `Close ${tab.name}`);
      closeBtn.textContent = "✕";
      closeBtn.addEventListener("click", () => closeTab(tab.path));
      item.appendChild(closeBtn);

      el.tabsBar.appendChild(item);
    }
  }

  function updateBreadcrumb(tab) {
    if (!tab) {
      el.breadcrumb.textContent = "No file opened";
      el.btnResetBenchmark.style.display = "none";
      return;
    }
    if (tab.isGuide) {
      el.breadcrumb.textContent = "README.md — User Guide";
      el.btnResetBenchmark.style.display = "none";
      return;
    }
    if (tab.ext === ".md") {
      el.breadcrumb.textContent = tab.path;
      el.btnResetBenchmark.style.display = "none";
      return;
    }
    const stageSuffix = tab.activeStage === "source" ? "" : `  [${tab.activeStage}]`;
    el.breadcrumb.textContent = `${tab.path}${tab.isDirty ? " *" : ""}${stageSuffix}`;

    const hasOverride = !tab.isUserFile &&
      (Object.prototype.hasOwnProperty.call(state.overrides, tab.path) ||
       tab.content !== state.originals.get(tab.path));
    el.btnResetBenchmark.style.display = hasOverride ? "inline-flex" : "none";
  }

  function updateStageButtons(tab) {
    const active = tab ? tab.activeStage : "source";
    for (const btn of el.stageBar.querySelectorAll(".stage-btn")) {
      const stage = btn.getAttribute("data-stage");
      btn.setAttribute("aria-pressed", String(stage === active));
    }

    if (!tab || active === "source") {
      el.stageStatus.style.display = "none";
    } else {
      el.stageStatus.style.display = "inline-flex";
      const label = active === "cfp"
        ? "Core Sapl (.cfp)"
        : active === "types"
          ? "Inferred types (Hindley-Milner)"
          : active;
      el.stageReadonlyLabel.textContent = `Read-only: ${label}`;
    }
  }

  function setEditorText(text, readOnly, preserveScroll = false) {
    const prevScroll = preserveScroll ? state.editor.getScrollInfo() : null;
    state.ignoreEditorChange = true;
    state.editor.setValue(text);
    state.editor.setOption("readOnly", readOnly);
    state.ignoreEditorChange = false;
    if (prevScroll) {
      state.editor.scrollTo(prevScroll.left, prevScroll.top);
    }
  }

  function cacheKey(stage, strictness) {
    return (stage === "cfp" || stage === "types") ? stage : `${strictness ? "strict" : "nostrict"}|${stage}`;
  }

  async function ensureStageGenerated(tab, stage, strictness) {
    const key = cacheKey(stage, strictness);
    const cached = tab.stageCache.get(key);
    if (cached && cached.sourceSnapshot === tab.content) {
      return { success: true, text: cached.text };
    }

    if (!state.workerReady) {
      return { success: false, error: "Engine is still loading." };
    }

    const sourceSnapshot = tab.content;
    if (stage === "types") {
      const tcRes = await callWorker({
        type: "TYPECHECK",
        source: sourceSnapshot,
        path: tab.path
      });
      if (!tcRes.success) {
        return {
          success: false,
          error: tcRes.error || "Typecheck failed."
        };
      }
      const report = (tcRes.report || "").trim();
      const outText = report || "// (no top-level definitions found)";
      tab.stageCache.set(key, { sourceSnapshot, text: outText });
      return { success: true, text: outText };
    }

    let cfpSource = sourceSnapshot;
    let cfpPath = tab.path;

    if (tab.ext === ".spp") {
      const cfpCached = tab.stageCache.get("cfp");
      if (cfpCached && cfpCached.sourceSnapshot === sourceSnapshot) {
        cfpSource = cfpCached.text;
      } else {
        const preRes = await callWorker({
          type: "PREPROCESS",
          kind: "spp",
          source: sourceSnapshot,
          path: tab.path
        });
        if (!preRes.success || !preRes.files || preRes.files.length === 0) {
          return {
            success: false,
            error: preRes.stderr || preRes.stdout || preRes.error || "Preprocessing failed."
          };
        }
        cfpSource = preRes.files[0].content;
        cfpPath = preRes.files[0].path;
        tab.stageCache.set("cfp", { sourceSnapshot, text: cfpSource });
        if (stage === "cfp") {
          return { success: true, text: cfpSource };
        }
      }
      if (stage === "cfp") {
        return { success: true, text: cfpSource };
      }
      cfpPath = `/tmp/${tab.name.replace(/\.spp$/, ".cfp")}`;
    }

    const compRes = await callWorker({
      type: "COMPILE",
      source: cfpSource,
      path: cfpPath,
      stages: [stage],
      strictness
    });

    if (!compRes.success || !compRes.files || compRes.files.length === 0) {
      return {
        success: false,
        error: compRes.stderr || compRes.stdout || compRes.error || `Failed to generate ${stage}.`
      };
    }

    const outText = compRes.files[0].content;
    tab.stageCache.set(key, { sourceSnapshot, text: outText });
    return { success: true, text: outText };
  }

  async function showStage(stage) {
    const tab = getActiveTab();
    if (!tab || tab.isGuide || tab.ext === ".md") return;

    if (stage === "cfp" && tab.ext !== ".spp") {
      stage = "source";
    }

    tab.activeStage = stage;
    updateStageButtons(tab);
    updateBreadcrumb(tab);

    if (stage === "source") {
      setEditorText(tab.content, false);
      return;
    }

    const strictness = el.chkStrictness.checked;
    const key = cacheKey(stage, strictness);
    const cached = tab.stageCache.get(key);
    if (cached && cached.sourceSnapshot === tab.content) {
      setEditorText(cached.text, true);
      return;
    }

    if (state.isBusy) {
      state.pendingStageRefresh = true;
      return;
    }
    state.isBusy = true;
    state.pendingStageRefresh = false;
    setStatus("busy", `Generating ${stage}...`);
    setEditorText(`// Generating ${stage}...`, true);

    const res = await ensureStageGenerated(tab, stage, strictness);
    state.isBusy = false;

    // Only update editor if user is still on the same tab & stage
    const currentTab = getActiveTab();
    if (!currentTab || currentTab.path !== tab.path || currentTab.activeStage !== stage) {
      setStatus("ready", "Ready");
      if (state.pendingStageRefresh && currentTab) {
        state.pendingStageRefresh = false;
        showStage(currentTab.activeStage);
      }
      return;
    }

    if (state.pendingStageRefresh) {
      state.pendingStageRefresh = false;
      showStage(currentTab.activeStage);
      return;
    }

    if (res.success) {
      setEditorText(res.text, true);
      setStatus("ready", `Viewing ${stage}`);
    } else {
      logTerminal(`\n✗ Could not generate ${stage}:\n${res.error}\n`, "error");
      setStatus("error", `${stage} failed`);
      tab.activeStage = "source";
      updateStageButtons(tab);
      updateBreadcrumb(tab);
      setEditorText(tab.content, false);
    }
  }

  // --- SAVE, CREATE, DELETE, RESET ---
  function saveActiveFile() {
    const tab = getActiveTab();
    if (!tab || tab.isGuide || tab.ext === ".md") return;

    if (tab.activeStage === "source") {
      tab.content = state.editor.getValue();
    }

    const fileObj = state.fileMap.get(tab.path);
    if (fileObj) fileObj.content = tab.content;

    if (tab.isUserFile) {
      state.userFiles[tab.path] = tab.content;
      persistUserFiles();
    } else {
      const orig = state.originals.get(tab.path);
      if (tab.content === orig) {
        delete state.overrides[tab.path];
      } else {
        state.overrides[tab.path] = tab.content;
      }
      persistOverrides();
    }

    tab.originalContent = tab.content;
    tab.isDirty = false;
    renderTabs();
    updateBreadcrumb(tab);
    setStatus("ready", "Saved");
    logTerminal(`Saved ${tab.name} in browser storage.\n`, "success");
  }

  function restoreActiveBenchmark() {
    const tab = getActiveTab();
    if (!tab || tab.isUserFile || tab.isGuide || tab.ext === ".md") return;

    const orig = state.originals.get(tab.path);
    if (typeof orig !== "string") return;

    delete state.overrides[tab.path];
    persistOverrides();

    const fileObj = state.fileMap.get(tab.path);
    if (fileObj) fileObj.content = orig;

    tab.content = orig;
    tab.originalContent = orig;
    tab.isDirty = false;
    tab.stageCache.clear();
    tab.activeStage = "source";

    setEditorText(orig, false);
    updateStageButtons(tab);
    renderTabs();
    updateBreadcrumb(tab);
    setStatus("ready", "Restored");
  }

  function createNewUserFile(rawName, langExt, useStarter) {
    let cleanName = rawName.trim();
    if (!cleanName.endsWith(".cfp") && !cleanName.endsWith(".spp")) {
      cleanName += langExt;
    }
    const ext = extOf(cleanName);
    const fullPath = `my_files/${cleanName}`;
    const starter = useStarter ? (ext === ".spp" ? STARTER_SPP : STARTER_CFP) : "";

    if (state.fileMap.has(fullPath)) {
      openFile(fullPath);
      return;
    }

    state.userFiles[fullPath] = starter;
    persistUserFiles();

    state.fileMap.set(fullPath, {
      name: cleanName,
      path: fullPath,
      ext,
      group: "myFiles",
      isUserFile: true,
      content: starter
    });

    state.groups.myFiles.expanded = true;
    renderTree();
    openFile(fullPath);
  }

  function requestDeleteUserFile(path) {
    const f = state.fileMap.get(path);
    if (!f || !f.isUserFile) return;
    state.pendingDeletePath = path;
    el.deleteFileDesc.textContent = `Permanently delete "${f.name}" from browser storage?`;
    el.deleteFileDialog.showModal();
  }

  function deleteUserFile(path) {
    if (!path || !state.fileMap.has(path)) return;
    delete state.userFiles[path];
    persistUserFiles();
    state.fileMap.delete(path);

    if (state.openTabs.some((t) => t.path === path)) {
      closeTab(path);
    }
    renderTree();
    if (!getActiveTab() && state.fileMap.has("benchmarks_sapl/fib.cfp")) {
      openFile("benchmarks_sapl/fib.cfp");
    }
  }

  // --- COMPILE, RUN, TYPECHECK ---
  async function compileAndRunActive(forceRecompile = true) {
    const tab = getActiveTab();
    if (!tab || tab.isGuide || tab.ext === ".md" || !state.workerReady || state.isBusy) return;

    if (tab.activeStage === "source") {
      tab.content = state.editor.getValue();
    }

    const strictness = el.chkStrictness.checked;
    const key = cacheKey("jmvm", strictness);

    if (!forceRecompile) {
      const cached = tab.stageCache.get(key);
      if (cached && cached.sourceSnapshot === tab.content) {
        runJmvmContent(tab.path, cached.text);
        return;
      }
    }

    state.isBusy = true;
    resetMetricsUI();
    setStatus("busy", "Compiling...");
    logTerminal(`\n=== Compile & Run: ${tab.path} (strictness: ${strictness ? "on" : "off"}) ===\n`, "info");

    const t0 = performance.now();
    const res = await ensureStageGenerated(tab, "jmvm", strictness);
    if (!res.success) {
      state.isBusy = false;
      setStatus("error", "Compile failed");
      logTerminal(`✗ Compilation failed:\n${res.error}\n`, "error");
      return;
    }

    const compileMs = Math.round(performance.now() - t0);
    logTerminal(`✓ Compiled in ${compileMs} ms\n`, "success");

    if (tab.activeStage === "jmvm") {
      setEditorText(res.text, true);
    }

    state.isBusy = false;
    runJmvmContent(tab.path, res.text);
  }

  function runJmvmContent(label, jmvmText) {
    if (state.isBusy || !state.workerReady) return;
    state.isBusy = true;
    setStatus("busy", "Running...");
    logTerminal(`Running ${label} on WebAssembly JMVM...\n`, "info");

    state.worker.postMessage({
      type: "RUN",
      contentOrPath: jmvmText,
      isPath: false,
      stdin: el.terminalInput.value.trim()
    });
  }

  // --- PANEL & DIALOG BINDINGS ---
  function toggleSidebar(force) {
    const hide = force !== undefined ? !force : !el.sidebar.classList.contains("hidden");
    el.sidebar.classList.toggle("hidden", hide);
    el.btnToggleSidebar.classList.toggle("active", !hide);
    el.btnToggleSidebar.setAttribute("aria-pressed", String(!hide));
  }

  function toggleTerminal(force) {
    const hide = force !== undefined ? !force : !el.bottomPanel.classList.contains("hidden");
    el.bottomPanel.classList.toggle("hidden", hide);
    el.btnToggleTerminal.classList.toggle("active", !hide);
    el.btnToggleTerminal.setAttribute("aria-pressed", String(!hide));
  }

  function bindUI() {
    el.treeSearch.addEventListener("input", renderTree);
    el.btnOpenGuide.addEventListener("click", () => openGuide());
    el.guidePreview.addEventListener("click", (e) => {
      const link = e.target.closest("a[href]");
      if (!link) return;
      const href = link.getAttribute("href") || "";
      if (href.startsWith("?file=")) {
        e.preventDefault();
        const target = new URLSearchParams(href.slice(1)).get("file");
        if (target && state.fileMap.has(target)) {
          openFile(target);
        }
      }
    });
    el.btnToggleSidebar.addEventListener("click", () => toggleSidebar());
    el.btnCloseSidebar.addEventListener("click", () => toggleSidebar(false));
    el.btnToggleTerminal.addEventListener("click", () => toggleTerminal());
    el.btnCloseTerminal.addEventListener("click", () => toggleTerminal(false));

    el.btnClearTerminal.addEventListener("click", () => { el.terminalContent.innerHTML = ""; });
    el.btnTerminalSend.addEventListener("click", () => compileAndRunActive(false));
    el.terminalInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") compileAndRunActive(false);
    });

    el.btnSave.addEventListener("click", saveActiveFile);
    el.btnResetBenchmark.addEventListener("click", restoreActiveBenchmark);
    el.btnCompileRun.addEventListener("click", () => compileAndRunActive(true));
    el.btnRun.addEventListener("click", () => compileAndRunActive(false));

    el.btnBackToSource.addEventListener("click", () => showStage("source"));

    el.stageBar.addEventListener("click", (e) => {
      const btn = e.target.closest(".stage-btn");
      if (!btn) return;
      const stage = btn.getAttribute("data-stage");
      if (stage) showStage(stage);
    });

    el.chkStrictness.addEventListener("change", () => {
      const tab = getActiveTab();
      if (!tab || tab.isGuide || tab.ext === ".md") return;
      if (tab.activeStage !== "source" && tab.activeStage !== "cfp" && tab.activeStage !== "types") {
        showStage(tab.activeStage);
      }
    });

    // Reset new-file modal fields when opened or when language changes
    const resetNewFileModal = () => {
      el.newFileError.textContent = "";
      el.newFileName.value = "";
    };
    el.btnNewFile.addEventListener("click", resetNewFileModal);
    el.btnSidebarNew.addEventListener("click", resetNewFileModal);

    el.newFileLang.addEventListener("change", () => {
      const val = el.newFileName.value.trim();
      if (val && (val.endsWith(".cfp") || val.endsWith(".spp"))) {
        el.newFileName.value = val.replace(/\.(cfp|spp)$/, el.newFileLang.value);
      }
    });

    el.newFileForm.addEventListener("submit", (e) => {
      if (e.submitter && e.submitter.value === "cancel") return;
      const name = el.newFileName.value.trim();
      if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
        e.preventDefault();
        el.newFileError.textContent = "Enter a valid file name without slashes (/).";
        el.newFileName.focus();
        return;
      }
      el.newFileError.textContent = "";
    });

    el.newFileDialog.addEventListener("close", () => {
      const val = el.newFileDialog.returnValue;
      el.newFileDialog.returnValue = "";
      if (val === "create") {
        createNewUserFile(
          el.newFileName.value,
          el.newFileLang.value,
          el.newFileStarter.checked
        );
      }
    });

    el.deleteFileDialog.addEventListener("close", () => {
      const val = el.deleteFileDialog.returnValue;
      el.deleteFileDialog.returnValue = "";
      const target = state.pendingDeletePath;
      state.pendingDeletePath = null;
      if (val === "delete" && target) {
        deleteUserFile(target);
      }
    });

    // Keyboard shortcuts
    window.addEventListener("keydown", (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveActiveFile();
      } else if ((mod && e.key === "Enter") || e.key === "F5") {
        e.preventDefault();
        compileAndRunActive(true);
      }
    });
  }

  // --- BOOT ---
  async function boot() {
    initTheme();
    initProgressiveFeatures();
    loadLocalStorage();
    initCodeMirror();
    bindUI();
    initWorker();

    await loadManifestBenchmarks();
    renderTree();

    const params = new URLSearchParams(window.location.search);
    const requested = params.get("file");
    if (requested && state.fileMap.has(requested)) {
      await openFile(requested);
    } else {
      await openGuide();
    }
  }

  boot();
})();
