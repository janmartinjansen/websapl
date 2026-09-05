/**
 * Course Studio — Interactive Authoring Application for Sap(+) & JMVM
 * Features: Local Storage, Live Student Preview, WASM Code Execution, GitHub Token Auth & 1-Click Publishing
 */
document.addEventListener("DOMContentLoaded", () => {
  // State
  const state = {
    course: null,
    activeModuleId: null, // "home" or moduleId
    activeFileName: null, // "index.md" or filename
    editor: null,
    worker: null,
    workerReady: false,
    previewDebounce: null,
    pendingRuns: new Map(),
    githubUser: null,
    githubToken: localStorage.getItem("websapl_github_token") || ""
  };

  // DOM Elements
  const el = {
    treeContainer: document.getElementById("tree-container"),
    editorWrapper: document.getElementById("editor-wrapper"),
    previewContent: document.getElementById("preview-content"),
    toolbarMd: document.getElementById("toolbar-markdown"),
    toolbarCode: document.getElementById("toolbar-code"),
    btnSave: document.getElementById("btn-save"),
    btnPublish: document.getElementById("btn-publish"),
    btnExportZip: document.getElementById("btn-export-zip"),
    btnReset: document.getElementById("btn-reset"),
    btnTheme: document.getElementById("btn-theme-toggle"),
    activeFileTitle: document.getElementById("active-file-title"),
    saveIndicator: document.getElementById("save-indicator"),
    btnRunCode: document.getElementById("btn-run-code"),
    btnInsertPlayground: document.getElementById("btn-insert-playground"),
    codeOutputPanel: document.getElementById("code-output-panel"),
    codeConsole: document.getElementById("code-console"),
    authContainer: document.getElementById("auth-modal-overlay"),
    authStatusUser: document.getElementById("auth-status-user"),
    btnLogout: document.getElementById("btn-logout")
  };

  // --- INITIALIZATION ---
  function init() {
    loadCourseData();
    initWorker();
    initCodeMirror();
    initTheme();
    setupEventListeners();
    checkAuth();
    renderTree();

    // Select Home (index.md) by default
    selectFile("home", "index.md");
  }

  // --- AUTHENTICATION (GITHUB TOKEN / LOCK SCREEN) ---
  async function checkAuth() {
    if (!state.githubToken) {
      showAuthModal();
      return;
    }

    try {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `token ${state.githubToken}`,
          "Accept": "application/vnd.github.v3+json"
        }
      });

      if (res.ok) {
        state.githubUser = await res.json();
        updateAuthUI();
        hideAuthModal();
      } else {
        console.warn("Invalid GitHub token");
        showAuthModal("Invalid GitHub Token. Please check token permissions.");
      }
    } catch (e) {
      console.warn("Could not verify GitHub token:", e);
      // If offline, allow access if token string exists
      hideAuthModal();
    }
  }

  function showAuthModal(errMsg = "") {
    if (!el.authContainer) return;
    el.authContainer.style.display = "flex";
    const errEl = document.getElementById("auth-error-msg");
    if (errEl) {
      errEl.textContent = errMsg;
      errEl.style.display = errMsg ? "block" : "none";
    }
  }

  function hideAuthModal() {
    if (el.authContainer) {
      el.authContainer.style.display = "none";
    }
  }

  function updateAuthUI() {
    if (el.authStatusUser && state.githubUser) {
      el.authStatusUser.innerHTML = `
        <span style="display:inline-flex; align-items:center; gap:6px; font-size:0.8rem; color:var(--text-secondary);">
          <img src="${state.githubUser.avatar_url}" style="width:18px; height:18px; border-radius:50%;" />
          <strong>${state.githubUser.login}</strong>
        </span>
      `;
    }
    if (el.btnLogout) {
      el.btnLogout.style.display = state.githubToken ? "inline-flex" : "none";
    }
  }

  // --- COURSE DATA STORAGE ---
  function loadCourseData() {
    let saved = null;
    try {
      const savedStr = localStorage.getItem("websapl_course_studio_data");
      if (savedStr) {
        saved = JSON.parse(savedStr);
      }
    } catch (e) {
      console.warn("Failed to load saved course data:", e);
    }

    const defaultData = window.DEFAULT_COURSE_DATA || { version: "1.2", title: "Course", home: {}, modules: [] };

    if (!saved || !saved.modules || saved.modules.length === 0) {
      state.course = JSON.parse(JSON.stringify(defaultData));
    } else {
      // Merge missing modules from defaultData so new curriculum (twice, primes, hamming) is always available
      defaultData.modules.forEach(defMod => {
        const existingMod = saved.modules.find(m => m.id === defMod.id);
        if (!existingMod) {
          saved.modules.push(JSON.parse(JSON.stringify(defMod)));
        } else {
          // Merge missing files inside existing module
          defMod.files.forEach(defFile => {
            const existingFile = existingMod.files.find(f => f.name === defFile.name);
            if (!existingFile) {
              existingMod.files.push(JSON.parse(JSON.stringify(defFile)));
            }
          });
        }
      });
      saved.version = defaultData.version;
      state.course = saved;
    }

    if (!state.course.home) {
      state.course.home = {
        name: "index.md",
        type: "markdown",
        content: defaultData.home ? defaultData.home.content : "# Course Title\n"
      };
    }

    // Auto-migrate any stale link from early prototypes
    if (state.course.home && state.course.home.content && state.course.home.content.includes("/guide/01-lazy-evaluation")) {
      state.course.home.content = state.course.home.content.replace(/\/guide\/01-lazy-evaluation/g, "/guide/01_introduction");
    }

    saveCourseData();
  }

  function saveCourseData() {
    try {
      localStorage.setItem("websapl_course_studio_data", JSON.stringify(state.course));
      if (el.saveIndicator) {
        el.saveIndicator.textContent = "✓ Saved (Draft)";
        el.saveIndicator.style.color = "var(--success)";
        setTimeout(() => {
          if (el.saveIndicator) el.saveIndicator.textContent = "Draft Auto-saved";
        }, 2000);
      }
    } catch (e) {
      console.error("Failed to save course data:", e);
    }
  }

  // --- THEME SETUP ---
  function initTheme() {
    const savedTheme = localStorage.getItem("websapl_theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
    updateThemeButton(savedTheme);
  }

  function updateThemeButton(theme) {
    if (el.btnTheme) {
      el.btnTheme.textContent = theme === "dark" ? "☀️ Light" : "🌙 Dark";
    }
  }

  // --- WEB WORKER (JMVM WASM) ---
  function initWorker() {
    try {
      state.worker = new Worker("engine/worker.js");
      state.worker.onmessage = handleWorkerMessage;
      state.worker.postMessage({
        type: "INIT",
        stdlib: window.STDLIB_DATA || ""
      });
    } catch (e) {
      console.error("Could not spawn worker:", e);
    }
  }

  function handleWorkerMessage(e) {
    const msg = e.data;
    switch (msg.type) {
      case "INIT_DONE":
        state.workerReady = true;
        console.log("✓ JMVM WebAssembly worker ready in Course Studio.");
        break;

      case "STDOUT":
        if (el.codeConsole) {
          el.codeConsole.textContent += msg.text;
        }
        break;

      case "STDERR":
        if (el.codeConsole) {
          el.codeConsole.textContent += msg.text;
        }
        break;

      case "COMPILE_COMPLETE":
        if (msg.success && state.pendingRuns.has(msg.id)) {
          const item = state.pendingRuns.get(msg.id);
          const jmvmFile = (msg.files && msg.files.length > 0) ? (msg.files.find(f => f.stage === "jmvm") || msg.files[0]) : null;
          const bytecode = jmvmFile ? jmvmFile.content : "";
          item.bytecode = bytecode;

          if (el.codeConsole) {
            el.codeConsole.textContent += `✓ Compiled successfully (${msg.durationMs || 0}ms).\nRunning on VM...\n`;
          }

          // Send RUN command with compiled bytecode content
          state.worker.postMessage({
            type: "RUN",
            contentOrPath: bytecode,
            isPath: false,
            stdin: ""
          });
        } else if (!msg.success && state.pendingRuns.has(msg.id)) {
          const item = state.pendingRuns.get(msg.id);
          state.pendingRuns.delete(msg.id);
          if (item.onError) {
            item.onError(msg.stderr || msg.error || "Compilation failed");
          }
        }
        break;

      case "RUN_COMPLETE":
        // Deliver to the current active pending run
        for (const [runId, item] of state.pendingRuns.entries()) {
          state.pendingRuns.delete(runId);
          if (item.onSuccess) {
            item.onSuccess({
              ...msg,
              bytecode: item.bytecode
            });
          }
          break;
        }
        break;

      default:
        break;
    }
  }

  // --- CODEMIRROR EDITOR ---
  function initCodeMirror() {
    state.editor = CodeMirror(el.editorWrapper, {
      value: "",
      mode: "markdown",
      theme: "default",
      lineNumbers: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      tabSize: 2,
      indentUnit: 2,
      lineWrapping: true
    });

    state.editor.on("change", () => {
      const activeFile = getActiveFile();
      if (!activeFile) return;

      activeFile.content = state.editor.getValue();
      saveCourseData();

      if (activeFile.type === "markdown") {
        schedulePreviewRender();
      }
    });
  }

  // --- FILE & MODULE TREE ---
  function renderTree() {
    el.treeContainer.innerHTML = "";

    // 1. Home / Startpagina Section (Top Level)
    const homeModEl = document.createElement("div");
    homeModEl.className = "tree-module";

    const isHomeActive = (state.activeModuleId === "home");
    homeModEl.innerHTML = `
      <div class="module-header" style="color: #60a5fa;">
        <span>🏠 COURSE OVERVIEW</span>
      </div>
      <div class="module-items">
        <div class="tree-item ${isHomeActive ? 'active' : ''}" id="tree-item-home">
          <span class="icon">✨</span>
          <span class="name">index.md (Homepage)</span>
        </div>
      </div>
    `;

    homeModEl.querySelector("#tree-item-home").onclick = () => selectFile("home", "index.md");
    el.treeContainer.appendChild(homeModEl);

    // 2. Course Modules
    state.course.modules.forEach((mod) => {
      const modEl = document.createElement("div");
      modEl.className = "tree-module";

      const header = document.createElement("div");
      header.className = "module-header";
      header.innerHTML = `
        <span>📂 ${escapeHtml(mod.title)}</span>
        <div class="sidebar-actions" onclick="event.stopPropagation()">
          <button class="sidebar-btn" title="Add File to this Module" onclick="window.Studio.promptAddFile('${mod.id}')">+</button>
          <button class="sidebar-btn" title="Delete Module" onclick="window.Studio.promptDeleteModule('${mod.id}')">×</button>
        </div>
      `;

      const itemsContainer = document.createElement("div");
      itemsContainer.className = "module-items";

      mod.files.forEach(file => {
        const item = document.createElement("div");
        const isActive = (state.activeModuleId === mod.id && state.activeFileName === file.name);
        item.className = "tree-item" + (isActive ? " active" : "");
        
        const icon = file.type === "markdown" ? "📄" : "⚙️";
        item.innerHTML = `
          <span class="icon">${icon}</span>
          <span class="name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          <div class="item-actions" onclick="event.stopPropagation()">
            <button class="sidebar-btn" title="Delete File" onclick="window.Studio.promptDeleteFile('${mod.id}', '${file.name}')">×</button>
          </div>
        `;

        item.onclick = () => selectFile(mod.id, file.name);
        itemsContainer.appendChild(item);
      });

      modEl.appendChild(header);
      modEl.appendChild(itemsContainer);
      el.treeContainer.appendChild(modEl);
    });
  }

  function getActiveFile() {
    if (state.activeModuleId === "home") {
      return state.course.home;
    }
    if (!state.activeModuleId || !state.activeFileName) return null;
    const mod = state.course.modules.find(m => m.id === state.activeModuleId);
    if (!mod) return null;
    return mod.files.find(f => f.name === state.activeFileName);
  }

  function selectFile(moduleId, fileName) {
    state.activeModuleId = moduleId;
    state.activeFileName = fileName;

    const file = getActiveFile();
    if (!file) return;

    if (el.activeFileTitle) {
      el.activeFileTitle.textContent = (moduleId === "home") ? "index.md (Homepage)" : file.name;
    }

    // Switch toolbars and modes
    if (file.type === "markdown") {
      el.toolbarMd.style.display = "flex";
      el.toolbarCode.style.display = "none";
      el.codeOutputPanel.style.display = "none";
      el.previewContent.style.display = "block";
      state.editor.setOption("mode", "markdown");
    } else {
      el.toolbarMd.style.display = "none";
      el.toolbarCode.style.display = "flex";
      el.codeOutputPanel.style.display = "flex";
      el.previewContent.style.display = "none";
      state.editor.setOption("mode", "sapl");
    }

    state.editor.setValue(file.content || "");
    state.editor.clearHistory();
    renderTree();

    if (file.type === "markdown") {
      renderLivePreview();
    }
  }

  // --- LIVE PREVIEW RENDERING ---
  function schedulePreviewRender() {
    clearTimeout(state.previewDebounce);
    state.previewDebounce = setTimeout(() => {
      renderLivePreview();
    }, 250);
  }

  function renderLivePreview() {
    const file = getActiveFile();
    if (!file || file.type !== "markdown") return;

    // Homepage Preview Special Handling
    if (state.activeModuleId === "home") {
      renderHomePreview(file.content || "");
      return;
    }

    let rawMarkdown = file.content || "";

    // Support GitHub alerts / callouts (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING])
    rawMarkdown = rawMarkdown.replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/gim, (match, type, title) => {
      return `> **[${type.toUpperCase()}]** ${title}`;
    });

    let processedMarkdown = rawMarkdown;

    // Render LaTeX Math with KaTeX ($$ ... $$ and $ ... $)
    if (typeof katex !== "undefined") {
      // Display Math: $$ ... $$
      processedMarkdown = processedMarkdown.replace(/\$\$([\s\S]+?)\$\$/g, (match, expr) => {
        try {
          return `\n\n<div class="katex-display-wrapper" style="text-align:center; margin:1.2rem 0; overflow-x:auto;">${katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false })}</div>\n\n`;
        } catch (e) {
          return match;
        }
      });

      // Inline Math: $ ... $
      processedMarkdown = processedMarkdown.replace(/(^|[^\\])\$([^\$\n]+?)\$/g, (match, prefix, expr) => {
        try {
          return prefix + katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false });
        } catch (e) {
          return match;
        }
      });
    }

    // Replace custom <SaplPlayground ... /> tags with placeholder divs before parsing markdown
    const playgrounds = [];
    processedMarkdown = processedMarkdown.replace(/<SaplPlayground\s+([^>]*)\/?>/g, (match, attrsStr) => {
      const idx = playgrounds.length;
      const attrs = parseAttributes(attrsStr);
      playgrounds.push(attrs);
      return `\n\n<div class="sapl-playground-placeholder" data-idx="${idx}"></div>\n\n`;
    });

    // Replace custom <JmvmStepper ... /> tags with placeholder divs
    const steppers = [];
    processedMarkdown = processedMarkdown.replace(/<JmvmStepper\s*([^>]*)\/?>/g, (match, attrsStr) => {
      const idx = steppers.length;
      const attrs = parseAttributes(attrsStr || "");
      steppers.push(attrs);
      return `\n\n<div class="jmvm-stepper-placeholder" data-idx="${idx}"></div>\n\n`;
    });

    // Parse Markdown with marked.js
    let htmlOutput = "";
    try {
      htmlOutput = marked.parse(processedMarkdown);
    } catch (e) {
      htmlOutput = `<div style="color:red">Markdown Parse Error: ${e.message}</div>`;
    }

    el.previewContent.innerHTML = htmlOutput;

    // Render interactive playground widgets into placeholders
    const placeholders = el.previewContent.querySelectorAll(".sapl-playground-placeholder");
    placeholders.forEach(ph => {
      const idx = parseInt(ph.getAttribute("data-idx"), 10);
      const attrs = playgrounds[idx];
      if (attrs) {
        const widget = createPlaygroundWidget(attrs);
        ph.replaceWith(widget);
      }
    });

    // Render interactive stepper widgets into placeholders
    const stepperPlaceholders = el.previewContent.querySelectorAll(".jmvm-stepper-placeholder");
    stepperPlaceholders.forEach(ph => {
      const idx = parseInt(ph.getAttribute("data-idx"), 10);
      const attrs = steppers[idx];
      if (attrs) {
        const widget = createStepperWidget(attrs);
        ph.replaceWith(widget);
      }
    });
  }

  function renderHomePreview(content) {
    // Simple visual hero rendering for index.md frontmatter
    let heroName = "Implementing Functional Languages";
    let heroTagline = "From Sap(+) to JMVM — Interactive Educational Course";
    let features = [];

    if (content.includes("name:")) {
      const m = content.match(/name:\s*["']?([^"'\n]+)["']?/);
      if (m) heroName = m[1];
    }
    if (content.includes("tagline:")) {
      const m = content.match(/tagline:\s*["']?([^"'\n]+)["']?/);
      if (m) heroTagline = m[1];
    }

    el.previewContent.innerHTML = `
      <div style="text-align:center; padding: 2rem 1rem; background: linear-gradient(180deg, rgba(56,189,248,0.1) 0%, transparent 100%); border-radius:12px; margin-bottom: 2rem;">
        <span style="font-size:0.8rem; font-weight:700; color:#38bdf8; text-transform:uppercase; letter-spacing:0.05em; background:rgba(56,189,248,0.15); padding:4px 10px; border-radius:999px;">IFL 2026 Educational Site</span>
        <h1 style="font-size:2.2rem; margin:1rem 0 0.5rem; border:none; padding:0;">${escapeHtml(heroName)}</h1>
        <p style="font-size:1.1rem; color:var(--text-secondary); max-width:600px; margin:0 auto 1.5rem;">${escapeHtml(heroTagline)}</p>
        <div style="display:flex; justify-content:center; gap:10px;">
          <button class="toolbar-btn btn-accent" style="padding:8px 16px; font-size:0.9rem;">Start Course →</button>
          <button class="toolbar-btn" style="padding:8px 16px; font-size:0.9rem;">View Roadmap</button>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:1rem;">
        <div class="metric-box" style="padding:1rem;">
          <h4 style="color:#38bdf8; margin-bottom:4px;">⚡ Lazy Graph Reduction</h4>
          <p style="font-size:0.82rem; color:var(--text-secondary);">Explore thunks, sharing, and graph overwriting step-by-step.</p>
        </div>
        <div class="metric-box" style="padding:1rem;">
          <h4 style="color:#34d399; margin-bottom:4px;">🛠️ Compiler Pipeline</h4>
          <p style="font-size:0.82rem; color:var(--text-secondary);">Learn lambda lifting, strictness analysis, and bytecode codegen.</p>
        </div>
        <div class="metric-box" style="padding:1rem;">
          <h4 style="color:#c084fc; margin-bottom:4px;">🎮 In-Browser WASM VM</h4>
          <p style="font-size:0.82rem; color:var(--text-secondary);">Direct interactive execution on JMVM without any setup.</p>
        </div>
      </div>
    `;
  }

  function parseAttributes(attrStr) {
    const attrs = {};
    const regex = /(\w+)=["']([^"']*)["']/g;
    let match;
    while ((match = regex.exec(attrStr)) !== null) {
      attrs[match[1]] = match[2];
    }
    return attrs;
  }

  // --- PLAYGROUND WIDGET GENERATION & EXECUTION ---
  function createPlaygroundWidget(attrs) {
    const container = document.createElement("div");
    container.className = "live-playground-widget";

    const title = attrs.title || (attrs.file ? `Code: ${attrs.file}` : "Interactive Code Playground");
    const lang = attrs.lang || "Sapl";

    let initialCode = attrs.initialCode || "";
    if (attrs.file) {
      const targetFile = findCourseFileByName(attrs.file);
      if (targetFile) {
        initialCode = targetFile.content;
      }
    }
    if (!initialCode) {
      initialCode = "fac !n = case n of 0 -> 1; _ -> n * fac (n - 1)\n\nmain = fac 10";
    }

    const widgetId = "widget_" + Math.random().toString(36).substring(2, 9);

    const isStrictnessEnabled = (attrs.strictness !== "false" && attrs.infer !== "false" && attrs.strictness !== false && attrs.file !== "fac_lazy.cfp");

    container.innerHTML = `
      <div class="widget-header">
        <div class="widget-title">
          <span class="widget-badge" style="${isStrictnessEnabled ? '' : 'background: #8b5cf6;'}">${isStrictnessEnabled ? escapeHtml(lang) : 'Lazy (No Infer)'}</span>
          <span>${escapeHtml(title)}</span>
        </div>
        <div class="widget-tabs">
          <button class="widget-tab-btn active" data-tab="code">Code</button>
          <button class="widget-tab-btn" data-tab="bytecode">JMVM Bytecode</button>
          <button class="widget-run-btn" id="${widgetId}_run">
            <span>▶ Run on JMVM</span>
          </button>
        </div>
      </div>
      <div class="widget-editor">
        <textarea class="widget-code-area" rows="6" spellcheck="false">${escapeHtml(initialCode)}</textarea>
        <pre class="widget-bytecode-area" style="display: none; margin: 0; padding: 6px 8px; font-size: 0.8rem; background: #0d1117; color: #58a6ff; border-radius: 4px; overflow-x: auto; max-height: 220px;"><code>// Click 'JMVM Bytecode' or 'Run' to compile...</code></pre>
      </div>
      <div class="widget-output" id="${widgetId}_output" style="display: none;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:600; color:var(--text-secondary);">Execution Result & Metrics:</span>
          <span class="status-tag" style="padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; background: #059669; color: white;">WHNF Reached</span>
        </div>
        <div class="res-line" style="margin: 6px 0; font-size: 0.95rem;">
          <strong>Result:</strong> <code style="background: rgba(56,189,248,0.15); color: #38bdf8; padding: 2px 6px; border-radius: 4px;" class="res-val">-</code>
        </div>
        <div class="widget-metrics">
          <div class="metric-box"><div class="label">Time</div><div class="val m-time">- ms</div></div>
          <div class="metric-box"><div class="label">Calls</div><div class="val m-steps">- calls</div></div>
          <div class="metric-box"><div class="label">Heap Allocations</div><div class="val m-creates" style="${isStrictnessEnabled ? '' : 'color: #8b5cf6; font-weight: bold;'}">- creates</div></div>
          <div class="metric-box"><div class="label">GC Cycles</div><div class="val m-gc">0</div></div>
        </div>
      </div>
    `;

    // Tab switching
    const btnCodeTab = container.querySelector('[data-tab="code"]');
    const btnBytecodeTab = container.querySelector('[data-tab="bytecode"]');
    const codeArea = container.querySelector('.widget-code-area');
    const bytecodeArea = container.querySelector('.widget-bytecode-area');

    btnCodeTab.onclick = () => {
      btnCodeTab.classList.add("active");
      btnBytecodeTab.classList.remove("active");
      codeArea.style.display = "block";
      bytecodeArea.style.display = "none";
    };

    btnBytecodeTab.onclick = () => {
      btnBytecodeTab.classList.add("active");
      btnCodeTab.classList.remove("active");
      codeArea.style.display = "none";
      bytecodeArea.style.display = "block";

      // Trigger compilation to show live bytecode
      const sourceCode = codeArea.value;
      const compileId = "comp_" + Math.random().toString(36).substring(2, 9);
      bytecodeArea.querySelector('code').textContent = "// Compiling via WebAssembly saplcomp...";

      state.pendingRuns.set(compileId, {
        path: "/workspace/temp.cfp",
        onSuccess: (msg) => {
          if (msg.bytecode) {
            bytecodeArea.querySelector('code').textContent = msg.bytecode;
          }
        },
        onError: (err) => {
          bytecodeArea.querySelector('code').textContent = "// Compilation Error:\n" + err;
        }
      });

      state.worker.postMessage({
        type: "COMPILE",
        id: compileId,
        source: sourceCode,
        path: "/workspace/temp.cfp",
        strictness: isStrictnessEnabled,
        backend: "saplcomp"
      });
    };

    // Run Handler
    const runBtn = container.querySelector(`#${widgetId}_run`);
    const outputDiv = container.querySelector(`#${widgetId}_output`);
    const resVal = container.querySelector('.res-val');
    const mTime = container.querySelector('.m-time');
    const mSteps = container.querySelector('.m-steps');
    const mCreates = container.querySelector('.m-creates');
    const mGc = container.querySelector('.m-gc');

    runBtn.onclick = () => {
      runBtn.disabled = true;
      runBtn.innerHTML = "<span>⏳ Running...</span>";
      outputDiv.style.display = "block";

      const sourceCode = codeArea.value;
      const runId = "run_" + Math.random().toString(36).substring(2, 9);

      state.pendingRuns.set(runId, {
        path: "/workspace/temp.cfp",
        onSuccess: (msg) => {
          runBtn.disabled = false;
          runBtn.innerHTML = "<span>▶ Run on JMVM</span>";

          const metrics = msg.metrics || {};
          resVal.textContent = metrics.res || msg.res || "WHNF Reached";
          mTime.textContent = metrics.elapsed_time ? `${(parseFloat(metrics.elapsed_time)*1000).toFixed(1)} ms` : `${msg.durationMs || 0.4} ms`;
          mSteps.textContent = `${metrics.calls || metrics.instr_executed || 0} calls`;
          mCreates.textContent = `${metrics.creates || 0} nodes`;
          mGc.textContent = `${metrics.gc_count || 0}`;

          if (msg.bytecode) {
            bytecodeArea.querySelector('code').textContent = msg.bytecode;
          }
        },
        onError: (err) => {
          runBtn.disabled = false;
          runBtn.innerHTML = "<span>▶ Run on JMVM</span>";
          resVal.textContent = "Error: " + err;
          resVal.style.color = "var(--error)";
        }
      });

      state.worker.postMessage({
        type: "COMPILE",
        id: runId,
        source: sourceCode,
        path: "/workspace/temp.cfp",
        strictness: isStrictnessEnabled,
        backend: "saplcomp"
      });
    };

    return container;
  }

  // --- STEPPER WIDGET GENERATION & SIMULATION ---
  function createStepperWidget(attrs) {
    const container = document.createElement("div");
    container.className = "live-stepper-widget";
    container.style.cssText = "margin: 1.5rem 0; border-radius: 12px; background: #0b1120; border: 1px solid rgba(56,189,248,0.25); color: #f8fafc; font-family: ui-monospace, SFMono-Regular, monospace; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.45);";

    const presetBytecode = {
      fac_strict: `; Strict Factorial in authentic JMVM bytecode
; Berekent fac(3) direct op de evaluatiestack
bipush 3
call 1, fac
stop

fac:
load 0
ifeq lb_zero
load 0
load 0
bipush 1
isub
call 1, fac
imult
ireturn

lb_zero:
bipush 1
ireturn`,

      fac_lazy: `; Lazy Factorial in authentic JMVM bytecode
; Berekent facl(3) met heap thunks en suspensies
pushfuncnr facl_1, 2
bipush 3
pushfuncnr facl, 1
create 2, closure
call 1, facl
stop

facl:
load 0
eval
ifeq lb_zero
load 0
load 0
bipush 1
isub
pushfuncnr facl, 1
create 2, closure
pushfuncnr facl_1, 2
create 3, closure
ireturn

lb_zero:
bipush 1
ireturn

facl_1:
load 0
eval
load 1
eval
imult
ireturn`
    ,
      twice_hof: `; Higher-Order Function: twice inc 5 = 7
; Demonstreert f (f 5) = inc (inc 5) met luie thunk & closures
start_lazy start twice_lazy twice inc_lazy inc #
call 1
print 4
stop
0           jmp 1
1           push 5
            pushfunc 1 6
            create 1 7
            call 5
            eval
            return 0
4           jmp 5
5           load 1
            load 0
            create 2 7
            load 0
            eval
            return 2
6           load 0
            eval
            store 0
7           loadadd 0 1
            return 1`,

      primes_stream: `; Lazy Stream Sieve: 3e priemgetal (el 2 primes = 5)
; Oneindige luie lijsten, filtering en in-place memoization
start el_lazy el lb1 lb2 lb3 take_lazy take lb5 lb7 lb8 nmz_lazy nmz lb9 filter_lazy filter lb11 lb12 lb13 from from_1 sieve_lazy sieve lb15 lb16 primes printlist_lazy printlist lb17 lb18 #
call 0
print 4
stop
0           call 25
            push 2
            tailcall 0 2
1           load 1
            eval
            store 1
            load 0
            eval
            store 0
2           load 1
            jmpt 2 3 4
3           debug 1
            return 2
4           load 2
            ifneq 5
            load 0
            return 4
5           load 1
            eval
            loadadd 2 -1
            tailcall 4 2
11          load 1
            eval
            store 1
            load 0
            eval
            store 0
12          load 1
            load 0
            mod
            ifeq 13
            return_const 2 1
13          return_const 2 0
14          load 1
            eval
            store 1
15          load 1
            jmpt 2 16 17
16          ccreatet 0 11 5 0
            return 2
17          load 0
            load 2
            eval
            ifeq 18
            load 1
            load 2
            pushfunc 2 14
            create 3 3
            load 0
            ccreatet 2 11 5 1
            return 4
18          load 1
            eval
            load 2
            tailcall 4 15
19          load 0
            pushfunc 1 20
            create 2 3
            pushfunc 1 19
            create 2 3
            load 0
            eval
            ccreatet 2 11 5 1
            return 1
20          load 0
            eval
            push 1
            add
            return 1
21          load 0
            eval
            store 0
22          load 0
            jmpt 2 23 24
23          debug 1
            return 1
24          load 1
            load 0
            pushfunc 2 11
            create 2 7
            pushfunc 2 14
            create 3 3
            pushfunc 1 21
            create 2 3
            load 0
            ccreatet 2 11 5 1
            return 3
25          push 2
            call 19
            tailcall 0 22`
    };

    let activeMode = attrs.mode || "fac_strict";
    let activeCode = attrs.initialBytecode || attrs.bytecode || "";
    if (!activeCode && presetBytecode[activeMode]) {
      activeCode = presetBytecode[activeMode];
    } else if (!activeCode) {
      activeCode = presetBytecode.fac_strict;
    }

    const title = attrs.title || (activeMode === "fac_strict" ? "Strict Factorial (fac 3)" : (activeMode === "fac_lazy" ? "Lazy Factorial (facl 3)" : (activeMode === "twice_hof" ? "Higher-Order Function (twice inc 5)" : (activeMode === "primes_stream" ? "Lazy Sieve Stream (primes)" : "JMVM Bytecode Visualizer"))));
    const widgetId = "stepper_" + Math.random().toString(36).substring(2, 9);

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; padding: 10px 16px; background:#1e293b; border-bottom:1px solid rgba(255,255,255,0.08); flex-wrap:wrap; gap:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="background: linear-gradient(135deg, #0ea5e9, #0284c7); color:white; font-size:0.72rem; font-weight:700; padding:3px 8px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px;">JMVM Stepper</span>
          <strong id="${widgetId}_title" style="font-size:0.9rem; color:#e2e8f0;">${escapeHtml(title)}</strong>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <select id="${widgetId}_mode" style="background:#0f172a; color:#38bdf8; border:1px solid rgba(56,189,248,0.3); padding:4px 8px; border-radius:6px; font-size:0.78rem; font-weight:600; cursor:pointer;">
            <option value="fac_strict" ${activeMode === 'fac_strict' ? 'selected' : ''}>Strict: fac(3)</option>
            <option value="fac_lazy" ${activeMode === 'fac_lazy' ? 'selected' : ''}>Lazy: facl(3)</option>
            <option value="twice_hof" ${activeMode === 'twice_hof' ? 'selected' : ''}>Hogere-orde: twice inc 5</option>
            <option value="primes_stream" ${activeMode === 'primes_stream' ? 'selected' : ''}>Luie Stream: 3e priem (5)</option>
          </select>
          <button id="${widgetId}_reset" style="background:#334155; color:#f8fafc; border:1px solid rgba(255,255,255,0.1); padding:5px 12px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer;">⏮ Reset</button>
          <button id="${widgetId}_step" style="background:#0284c7; color:#f8fafc; border:1px solid #38bdf8; padding:5px 12px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer;">⏯ Step</button>
          <button id="${widgetId}_play" style="background:#059669; color:#f8fafc; border:none; padding:5px 12px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer;">▶ Auto Run</button>
        </div>
      </div>
      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:8px 16px; background:#111c30; border-bottom:1px solid rgba(255,255,255,0.06); font-size:0.78rem;">
        <div style="background:rgba(15,23,42,0.85); padding:3px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);"><span style="color:#94a3b8; font-weight:600;">PC</span> <strong id="${widgetId}_pc" style="color:#38bdf8;">0</strong></div>
        <div style="background:rgba(15,23,42,0.85); padding:3px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);"><span style="color:#94a3b8; font-weight:600;">HV (Frame)</span> <strong id="${widgetId}_hv" style="color:#38bdf8;">0</strong></div>
        <div style="background:rgba(15,23,42,0.85); padding:3px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);"><span style="color:#94a3b8; font-weight:600;">Stack</span> <strong id="${widgetId}_sp" style="color:#38bdf8;">0</strong></div>
        <div style="background:rgba(15,23,42,0.85); padding:3px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);"><span style="color:#94a3b8; font-weight:600;">Heap</span> <strong id="${widgetId}_hp" style="color:#a78bfa;">0 nodes</strong></div>
        <div style="background:rgba(15,23,42,0.85); padding:3px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);"><span style="color:#94a3b8; font-weight:600;">Steps</span> <strong id="${widgetId}_steps" style="color:#38bdf8;">0</strong></div>
        <div style="background:rgba(15,23,42,0.85); padding:3px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);"><span style="color:#94a3b8; font-weight:600;">Status</span> <strong id="${widgetId}_status" style="color:#38bdf8;">READY</strong></div>
      </div>
      <div style="display:grid; grid-template-columns: 1.3fr 1fr 1.35fr; gap:1px; background:rgba(255,255,255,0.08); min-height:440px; max-height:480px; box-sizing:border-box;">
        <div style="background:#0b1120; display:flex; flex-direction:column; overflow:hidden;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 12px; background:#162238; font-size:0.78rem; font-weight:700; color:#cbd5e1; border-bottom:1px solid rgba(255,255,255,0.06);">
            <span>Bytecode Instructions</span>
            <span id="${widgetId}_code_count" style="font-size:0.68rem; background:rgba(255,255,255,0.1); padding:1px 6px; border-radius:999px; color:#94a3b8;">0 lines</span>
          </div>
          <div id="${widgetId}_code_lines" style="flex:1; overflow-y:auto; padding:8px; box-sizing:border-box;"></div>
        </div>
        <div style="background:#0b1120; display:flex; flex-direction:column; overflow:hidden;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 12px; background:#162238; font-size:0.78rem; font-weight:700; color:#cbd5e1; border-bottom:1px solid rgba(255,255,255,0.06);">
            <span>Evaluation Stack</span>
            <span id="${widgetId}_sp_top" style="font-size:0.68rem; background:rgba(255,255,255,0.1); padding:1px 6px; border-radius:999px; color:#94a3b8;">SP: 0</span>
          </div>
          <div id="${widgetId}_stack_items" style="flex:1; overflow-y:auto; padding:8px; box-sizing:border-box;"></div>
        </div>
        <div style="background:#0b1120; display:flex; flex-direction:column; overflow:hidden;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 12px; background:#162238; font-size:0.78rem; font-weight:700; color:#cbd5e1; border-bottom:1px solid rgba(255,255,255,0.06);">
            <span>Heap Graph Memory</span>
            <span id="${widgetId}_heap_count" style="font-size:0.68rem; background:rgba(255,255,255,0.1); padding:1px 6px; border-radius:999px; color:#94a3b8;">0 Nodes</span>
          </div>
          <div id="${widgetId}_heap_items" style="flex:1; overflow-y:auto; padding:8px; box-sizing:border-box;"></div>
        </div>
      </div>
      <div id="${widgetId}_log" style="display:flex; align-items:center; gap:10px; padding:10px 16px; background:#060a14; border-top:1px solid rgba(56,189,248,0.25); font-size:0.82rem; color:#38bdf8; line-height:1.45; min-height:44px; box-sizing:border-box; position:relative; z-index:2;">
        <span>💡</span> <span id="${widgetId}_log_text">JMVM geïnitialiseerd.</span>
      </div>
    `;

    // Authentic JMVM Interpreter Implementation inside Studio (100% simtypes.h / vm.cpp compatible)
    class StudioJmvm {
      constructor(codeText) {
        this.instructions = [];
        this.labels = new Map();
        this.labelNames = [];
        this.pc = 0;
        this.stack = [];
        this.hv = 0;
        this.heap = [];
        this.callStack = [];
        this.isHalted = false;
        this.steps = 0;
        this.output = [];
        this.lastMessage = "VM gereed.";
        this.load(codeText);
      }

      load(text) {
        this.instructions = [];
        this.labels.clear();
        this.labelNames = [];
        this.output = [];

        const lines = text.split("\n");
        let firstLine = "";
        const codeLines = [];

        for (let l of lines) {
          let trimmed = l.trim();
          if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("//")) continue;
          if (
            trimmed.startsWith(".metadata") ||
            trimmed.startsWith("types ") ||
            trimmed.startsWith("type ") ||
            trimmed.startsWith("constr ") ||
            trimmed.startsWith("functions ") ||
            trimmed.startsWith("func ") ||
            trimmed.startsWith(".endmetadata")
          ) {
            continue;
          }
          if (!firstLine && trimmed.endsWith("#")) {
            firstLine = trimmed.slice(0, -1).trim();
            continue;
          }
          codeLines.push(l);
        }

        if (firstLine) {
          this.labelNames = firstLine.split(/\s+/).filter(x => x.length > 0);
          for (let i = 0; i < this.labelNames.length; i++) {
            this.labels.set(String(i), -1);
            this.labels.set(this.labelNames[i].toLowerCase(), -1);
          }
        }

        let idx = 0;
        for (let rawLine of codeLines) {
          let line = rawLine.trim();
          if (!line || line.startsWith(";") || line.startsWith("||")) continue;
          let comment = "";
          if (line.includes("||")) {
            const p = line.split("||");
            line = p[0].trim();
            comment = p.slice(1).join("||").trim();
          } else if (line.includes(";")) {
            const p = line.split(";");
            line = p[0].trim();
            comment = p.slice(1).join(";").trim();
          }

          const matchNumLabel = line.match(/^(\d+)\s+(.*)$/);
          if (matchNumLabel) {
            const labelNum = matchNumLabel[1];
            this.labels.set(labelNum, idx);
            const labelNumInt = parseInt(labelNum, 10);
            if (this.labelNames[labelNumInt]) {
              this.labels.set(this.labelNames[labelNumInt].toLowerCase(), idx);
            }
            line = matchNumLabel[2].trim();
          }

          if (line.includes(":")) {
            const colonIdx = line.indexOf(":");
            const beforeColon = line.substring(0, colonIdx).trim();
            if (beforeColon && !beforeColon.includes(" ")) {
              this.labels.set(beforeColon.toLowerCase(), idx);
              this.instructions.push({ isLabel: true, labelName: beforeColon, comment: "", raw: beforeColon + ":" });
              idx++;
              line = line.substring(colonIdx + 1).trim();
              if (!line) continue;
            }
          }
          const tokens = line.split(/[\s,]+/).filter(t => t.length > 0);
          if (tokens.length === 0) continue;
          let op = tokens[0].toUpperCase();
          let args = tokens.slice(1);
          if (op === "LABEL") {
            this.labels.set(args[0].toLowerCase(), idx);
            this.instructions.push({ isLabel: true, labelName: args[0], comment, raw: rawLine.trim() });
            idx++;
            continue;
          }
          this.instructions.push({ isLabel: false, op, args, comment, raw: rawLine.trim() });
          idx++;
        }
        this.reset();
      }

      reset() {
        this.pc = 0;
        this.stack = [];
        this.hv = 0;
        this.heap = [];
        this.callStack = [];
        this.isHalted = false;
        this.steps = 0;
        this.output = [];
        this.lastMessage = "Simulatie gereset naar instructie 0.";
        this.skipLabels();
      }

      skipLabels() {
        while (this.pc < this.instructions.length && this.instructions[this.pc] && this.instructions[this.pc].isLabel) {
          this.pc++;
        }
        if (this.pc >= this.instructions.length) this.isHalted = true;
      }

      isHeapRef(v) { return typeof v === "object" && v !== null && v.ref !== undefined; }
      isFuncObj(v) { return typeof v === "object" && v !== null && v.isFunc; }

      resolveTarget(target) {
        if (target === undefined || target === null || target === "") return -1;
        const clean = String(target).toLowerCase();
        if (this.labels.has(clean)) return this.labels.get(clean);
        const p = parseInt(target, 10);
        if (!isNaN(p) && this.labels.has(String(p))) return this.labels.get(String(p));
        return isNaN(p) ? -1 : p;
      }

      step() {
        if (this.isHalted || this.pc >= this.instructions.length) {
          this.isHalted = true;
          this.lastMessage = "Programma voltooid.";
          return false;
        }
        const instr = this.instructions[this.pc];
        if (!instr) {
          this.isHalted = true;
          return false;
        }
        if (instr.isLabel) {
          this.pc++;
          this.skipLabels();
          return true;
        }
        this.steps++;
        const op = instr.op;
        const args = instr.args;

        switch (op) {
          case "BIPUSH":
          case "PUSH": {
            const val = parseInt(args[0], 10) || 0;
            this.stack.push(val);
            this.lastMessage = `bipush ${val}: Waarde ${val} op de stack geplaatst.`;
            this.pc++;
            break;
          }
          case "LOAD": {
            const offset = parseInt(args[0], 10) || 0;
            const targetIdx = this.hv - offset;
            const val = this.stack[targetIdx] !== undefined ? this.stack[targetIdx] : 0;
            this.stack.push(val);
            const valRepr = this.isHeapRef(val) ? `@Node ${val.ref}` : (this.isFuncObj(val) ? `λ ${val.name || val.func}` : val);
            this.lastMessage = `load ${offset}: Argument op stack[hv - ${offset}] (${valRepr}) naar top gekopieerd.`;
            this.pc++;
            break;
          }
          case "STORE": {
            const offset = parseInt(args[0], 10) || 0;
            const val = this.stack.pop();
            this.stack[this.hv - offset] = val;
            this.lastMessage = `store ${offset}: Top van stack opgeslagen in stack[hv - ${offset}].`;
            this.pc++;
            break;
          }
          case "LOADADD": {
            const offset = parseInt(args[0], 10) || 0;
            const addVal = parseInt(args[1], 10) || 0;
            const val = (this.stack[this.hv - offset] || 0) + addVal;
            this.stack.push(val);
            this.lastMessage = `loadadd ${offset}, ${addVal}: stack[hv - ${offset}] + ${addVal} = ${val} op stack geduwd.`;
            this.pc++;
            break;
          }
          case "DUP": {
            const top = this.stack[this.stack.length - 1];
            this.stack.push(top);
            this.lastMessage = `dup: Top van stack gedupliceerd.`;
            this.pc++;
            break;
          }
          case "SWAP": {
            if (this.stack.length >= 2) {
              const a = this.stack[this.stack.length - 1];
              const b = this.stack[this.stack.length - 2];
              this.stack[this.stack.length - 1] = b;
              this.stack[this.stack.length - 2] = a;
            }
            this.lastMessage = `swap: Bovenste 2 stack-elementen omgewisseld.`;
            this.pc++;
            break;
          }
          case "POP": {
            const count = parseInt(args[0], 10) || 1;
            for (let i = 0; i < count; i++) this.stack.pop();
            this.lastMessage = `pop ${count}: ${count} element(en) van stack verwijderd.`;
            this.pc++;
            break;
          }
          case "IADD":
          case "ADD": {
            const b = this.stack.pop();
            const a = this.stack.pop();
            const res = (a || 0) + (b || 0);
            this.stack.push(res);
            this.lastMessage = `iadd: ${a} + ${b} = ${res}`;
            this.pc++;
            break;
          }
          case "ISUB":
          case "SUB": {
            const b = this.stack.pop();
            const a = this.stack.pop();
            const res = (a || 0) - (b || 0);
            this.stack.push(res);
            this.lastMessage = `isub: ${a} - ${b} = ${res}`;
            this.pc++;
            break;
          }
          case "IMULT":
          case "MUL": {
            const b = this.stack.pop();
            const a = this.stack.pop();
            const res = (a || 0) * (b || 0);
            this.stack.push(res);
            this.lastMessage = `imult: ${a} * ${b} = ${res}`;
            this.pc++;
            break;
          }
          case "IDIV":
          case "DIV": {
            const b = this.stack.pop();
            const a = this.stack.pop();
            const res = Math.floor((a || 0) / (b || 1));
            this.stack.push(res);
            this.lastMessage = `idiv: ${a} / ${b} = ${res}`;
            this.pc++;
            break;
          }
          case "IMOD":
          case "MOD": {
            const b = this.stack.pop();
            const a = this.stack.pop();
            const res = (a || 0) % (b || 1);
            this.stack.push(res);
            this.lastMessage = `imod: ${a} % ${b} = ${res}`;
            this.pc++;
            break;
          }
          case "IFEQ": {
            const val = this.stack.pop();
            const target = this.resolveTarget(args[0]);
            if (val === 0 || val === false) {
              this.pc = target;
              this.lastMessage = `ifeq ${args[0]}: Waarde is 0 -> Sprong naar regel ${target}.`;
            } else {
              this.pc++;
              this.lastMessage = `ifeq ${args[0]}: Waarde is ${val} (!= 0) -> Geen sprong.`;
            }
            break;
          }
          case "IFNEQ": {
            const val = this.stack.pop();
            const target = this.resolveTarget(args[0]);
            if (val !== 0 && val !== false) {
              this.pc = target;
              this.lastMessage = `ifneq ${args[0]}: Waarde is niet 0 -> Sprong naar regel ${target}.`;
            } else {
              this.pc++;
              this.lastMessage = `ifneq ${args[0]}: Waarde is 0 -> Geen sprong.`;
            }
            break;
          }
          case "JMP": {
            const target = this.resolveTarget(args[0]);
            this.pc = target;
            this.lastMessage = `jmp ${args[0]}: Direct gesprongen naar regel ${target}.`;
            break;
          }
          case "CALL": {
            let nrargs = 1;
            let targetLabel = "";
            if (args.length >= 2) {
              nrargs = parseInt(args[0], 10) || 1;
              targetLabel = args[1] || "";
            } else {
              targetLabel = args[0] || "";
            }
            const target = this.resolveTarget(targetLabel);
            const oldHv = this.hv;
            const newHv = this.stack.length - 1;
            this.callStack.push({ returnPc: this.pc + 1, oldHv: oldHv, callerSp: newHv, nrargs: nrargs, isBoxValue: false });
            this.hv = newHv;
            this.pc = target;
            this.lastMessage = `call ${targetLabel}: Call Frame op stack[hv=${newHv}], spring naar regel ${target}.`;
            break;
          }
          case "TAILCALL": {
            let popCount = 1;
            let targetLabel = "";
            if (args.length >= 2) {
              popCount = parseInt(args[0], 10) || 0;
              targetLabel = args[1] || "";
            } else {
              targetLabel = args[0] || "";
            }
            const target = this.resolveTarget(targetLabel);
            const na = this.stack.length - 1 - this.hv;
            const newArgs = this.stack.slice(this.stack.length - na);
            this.stack.splice(this.stack.length - (popCount + na), popCount + na);
            for (let a of newArgs) this.stack.push(a);
            this.hv = this.stack.length - 1;
            this.pc = target;
            this.lastMessage = `tailcall ${popCount}, ${targetLabel}: Staartaanroep uitgevoerd (Call Frame hergebruikt).`;
            break;
          }
          case "RETURN":
          case "IRETURN": {
            const popCount = parseInt(args[0], 10) || 1;
            const retVal = this.stack.pop();
            if (this.callStack.length > 0) {
              const frame = this.callStack.pop();
              if (frame.isBoxValue && frame.boxTargetNode) {
                frame.boxTargetNode.type = "BOXED";
                frame.boxTargetNode.value = retVal;
                frame.boxTargetNode.isEvaluated = true;
                const cleanTo = frame.callerSp;
                this.stack.length = cleanTo;
                this.hv = frame.oldHv;
                this.pc = frame.returnPc;
                this.stack.push(retVal);
              } else {
                const cleanTo = Math.max(0, this.hv - popCount + 1);
                this.stack.length = cleanTo;
                this.hv = frame.oldHv;
                this.pc = frame.returnPc;
                this.stack.push(retVal);
              }
              const retRepr = this.isHeapRef(retVal) ? `@Node ${retVal.ref}` : JSON.stringify(retVal);
              this.lastMessage = `return ${popCount}: Resultaat ${retRepr} teruggegeven naar regel ${frame.returnPc}.`;
            } else {
              this.stack.push(retVal);
              this.isHalted = true;
              this.lastMessage = `return: Programma voltooid met ${JSON.stringify(retVal)}.`;
            }
            break;
          }
          case "RETURN_CONST":
          case "IRETURN_CONST": {
            let popCount = 1;
            let constVal = 0;
            if (args.length >= 2) {
              popCount = parseInt(args[0], 10) || 1;
              constVal = parseInt(args[1], 10) || 0;
            } else {
              constVal = parseInt(args[0], 10) || 0;
            }
            if (this.callStack.length > 0) {
              const frame = this.callStack.pop();
              if (frame.isBoxValue && frame.boxTargetNode) {
                frame.boxTargetNode.type = "BOXED";
                frame.boxTargetNode.value = constVal;
                frame.boxTargetNode.isEvaluated = true;
                const cleanTo = frame.callerSp;
                this.stack.length = cleanTo;
                this.hv = frame.oldHv;
                this.pc = frame.returnPc;
                this.stack.push(constVal);
              } else {
                const cleanTo = Math.max(0, this.hv - popCount + 1);
                this.stack.length = cleanTo;
                this.hv = frame.oldHv;
                this.pc = frame.returnPc;
                this.stack.push(constVal);
              }
              this.lastMessage = `return_const ${constVal}: Constante geretourneerd naar regel ${frame.returnPc}.`;
            } else {
              this.stack.push(constVal);
              this.isHalted = true;
              this.lastMessage = `return_const: Programma voltooid met ${constVal}.`;
            }
            break;
          }
          case "PUSHFUNCNR":
          case "PUSHFUNC": {
            let funcName = "func";
            let nrargs = 1;
            let targetPc = 0;
            if (args.length >= 2) {
              nrargs = parseInt(args[0], 10) || 1;
              const labelTarget = args[1];
              targetPc = this.resolveTarget(labelTarget);
              funcName = (this.labelNames[parseInt(labelTarget, 10)] || labelTarget);
            } else {
              funcName = args[0] || "func";
              targetPc = this.resolveTarget(funcName);
            }
            this.stack.push({ isFunc: true, func: funcName, name: funcName, nrargs: nrargs, targetPc: targetPc });
            this.lastMessage = `pushfunc ${funcName}, ${nrargs}: Functie-descriptor '${funcName}' op stack geduwd.`;
            this.pc++;
            break;
          }
          case "CREATE": {
            const size = parseInt(args[0], 10) || 1;
            const typeArg = args[1] || "3";
            const typeId = parseInt(typeArg, 10) || 3;
            const elems = [];
            for (let i = 0; i < size; i++) {
              if (this.stack.length > 0) elems.unshift(this.stack.pop());
            }
            const nodeId = this.heap.length + 1;
            const funcDesc = elems[elems.length - 1];
            const funcName = funcDesc && (funcDesc.name || funcDesc.func) ? (funcDesc.name || funcDesc.func) : "Thunk";
            const node = { id: nodeId, type: typeId === 7 ? "CURRIED" : "CLOSURE", typeId, func: funcName, elems, isEvaluated: false };
            this.heap.push(node);
            this.stack.push({ ref: nodeId, node: node });
            this.lastMessage = `create ${size}, ${typeId}: Thunk Node @${nodeId} gealloceerd op heap.`;
            this.pc++;
            break;
          }
          case "CCREATE":
          case "CCREATET": {
            const size = parseInt(args[0], 10) || 2;
            const typeId = parseInt(args[1], 10) || 11;
            const type_id = parseInt(args[2], 10) || 5;
            const constr_aux = parseInt(args[3], 10) || (size === 0 ? 0 : 1);
            const elems = [];
            for (let i = 0; i < size; i++) {
              if (this.stack.length > 0) elems.unshift(this.stack.pop());
            }
            const nodeId = this.heap.length + 1;
            const constrName = constr_aux === 1 ? "Cons" : (constr_aux === 0 && size === 0 ? "Nil" : `Constr_${constr_aux}`);
            const node = { id: nodeId, type: "CONSTR", typeId, type_id, aux: constr_aux, constrName, func: constrName, elems, isEvaluated: true };
            this.heap.push(node);
            this.stack.push({ ref: nodeId, node: node });
            this.lastMessage = `ccreatet ${size}, ${constrName}: Constructor Node @${nodeId} (${constrName}) gealloceerd op heap.`;
            this.pc++;
            break;
          }
          case "JMPT": {
            const targets = args.slice(1).map(x => this.resolveTarget(x));
            const top = this.stack[this.stack.length - 1];
            const node = top && top.node ? top.node : (top && top.ref ? this.heap.find(n => n.id === top.ref) : null);
            if (!node) throw new Error(`jmpt on non-node op pc=${this.pc}: ${JSON.stringify(top)}`);
            const aux = node.aux !== undefined ? node.aux : 0;
            const targetPc = targets[aux] !== undefined ? targets[aux] : targets[0];
            this.stack.pop();
            if (node.elems) {
              for (let e of node.elems) this.stack.push(e);
            }
            this.hv = this.stack.length - 1;
            this.pc = targetPc;
            this.lastMessage = `jmpt: Constructor ${node.constrName || node.func} (aux=${aux}) ontleed -> sprong naar regel ${targetPc}.`;
            break;
          }
          case "EVAL": {
            const top = this.stack[this.stack.length - 1];
            if (typeof top === "number") {
              this.lastMessage = `eval: Waarde ${top} is reeds gereduceerd.`;
              this.pc++;
            } else if (top) {
              const node = top.node ? top.node : (top.ref ? this.heap.find(n => n.id === top.ref) : null);
              if (!node) { this.pc++; break; }
              if (node.type === "CONSTR") {
                this.lastMessage = `eval: Constructor @${node.id} (${node.constrName || node.func}) is in WHNF.`;
                this.pc++;
              } else if (node.type === "BOXED") {
                this.stack.pop();
                this.stack.push(node.value);
                this.lastMessage = `eval: Node @${node.id} was gememoiseerd met ${JSON.stringify(node.value)}.`;
              } else if (node.type === "CLOSURE") {
                const func = node.elems[node.elems.length - 1];
                const boundArgs = node.elems.slice(0, -1);
                this.callStack.push({ returnPc: this.pc + 1, oldHv: this.hv, callerSp: this.stack.length - 1, isBoxValue: true, boxTargetNode: node });
                for (let a of boundArgs) this.stack.push(a);
                this.hv = this.stack.length - 1;
                this.pc = func.targetPc !== undefined ? func.targetPc : this.resolveTarget(func.name || func.func);
                this.lastMessage = `eval: Start reductie van Thunk @${node.id} (${func.name || func.func}).`;
              } else if (node.type === "CURRIED") {
                const boundArgs = [];
                let func = null;
                const unpack = (n) => {
                  const nd = n && n.node ? n.node : (n && n.ref ? this.heap.find(x => x.id === n.ref) : (n && n.typeId ? n : null));
                  if (nd && nd.type === "CURRIED" && nd.elems) {
                    for (let i = 0; i < nd.elems.length - 1; i++) {
                      boundArgs.push(nd.elems[i]);
                    }
                    unpack(nd.elems[nd.elems.length - 1]);
                  } else if (n && n.isFunc) {
                    func = n;
                  } else if (nd && nd.elems && nd.elems.length > 0) {
                    unpack(nd.elems[nd.elems.length - 1]);
                  } else {
                    func = n;
                  }
                };
                unpack(node);
                this.stack.pop();
                for (let a of boundArgs) this.stack.push(a);
                this.callStack.push({ returnPc: this.pc + 1, oldHv: this.hv, callerSp: this.stack.length - 1, isBoxValue: false });
                this.hv = this.stack.length - 1;
                this.pc = (func && func.targetPc !== undefined) ? func.targetPc : this.resolveTarget(func ? (func.name || func.func || func) : 0);
                this.lastMessage = `eval: Partiële functie @${node.id} (${func ? (func.name || func.func) : 'func'}) aangeroepen met ${boundArgs.length} argument(en).`;
              } else {
                this.pc++;
              }
            } else {
              this.pc++;
            }
            break;
          }
          case "PRINT": {
            const mode = parseInt(args[0], 10) || 0;
            const val = this.stack.pop();
            const display = (typeof val === "object" && val && (val.node || val.ref))
              ? (val.node && val.node.value !== undefined ? val.node.value : (val.node && val.node.constrName ? val.node.constrName : `@Node ${val.ref}`))
              : val;
            this.lastMessage = `print ${mode}: ${display}`;
            this.pc++;
            break;
          }
          case "DEBUG": {
            this.lastMessage = `debug: Breakpoint bereikt.`;
            this.pc++;
            break;
          }
          case "STOP":
          case "HALT": {
            this.isHalted = true;
            const finalVal = this.stack.length > 0 ? this.stack[this.stack.length - 1] : "OK";
            const valRepr = this.isHeapRef(finalVal) ? `@Node ${finalVal.ref}` : JSON.stringify(finalVal);
            this.lastMessage = `stop: JMVM executie beëindigd. Resultaat: ${valRepr}`;
            return false;
          }
          default: {
            this.lastMessage = `Instructie '${instr.raw}' uitgevoerd.`;
            this.pc++;
            break;
          }
        }
        this.skipLabels();
        return true;
      }
    }

    let vm = new StudioJmvm(activeCode);
    let runTimer = null;

    function renderUI() {
      const elPc = container.querySelector(`#${widgetId}_pc`);
      const elHv = container.querySelector(`#${widgetId}_hv`);
      const elSp = container.querySelector(`#${widgetId}_sp`);
      const elHp = container.querySelector(`#${widgetId}_hp`);
      const elSteps = container.querySelector(`#${widgetId}_steps`);
      const elStatus = container.querySelector(`#${widgetId}_status`);
      const elCodeCount = container.querySelector(`#${widgetId}_code_count`);
      const elSpTop = container.querySelector(`#${widgetId}_sp_top`);
      const elHeapCount = container.querySelector(`#${widgetId}_heap_count`);
      const elCode = container.querySelector(`#${widgetId}_code_lines`);
      const elStack = container.querySelector(`#${widgetId}_stack_items`);
      const elHeap = container.querySelector(`#${widgetId}_heap_items`);
      const elLogText = container.querySelector(`#${widgetId}_log_text`);

      if (elPc) elPc.textContent = vm.pc;
      if (elHv) elHv.textContent = vm.hv;
      if (elSp) elSp.textContent = vm.stack.length;
      if (elHp) elHp.textContent = `${vm.heap.length} nodes`;
      if (elSteps) elSteps.textContent = vm.steps;
      if (elStatus) {
        elStatus.textContent = vm.isHalted ? "HALTED" : (runTimer ? "RUNNING" : "READY");
        elStatus.style.color = vm.isHalted ? "#f43f5e" : (runTimer ? "#10b981" : "#38bdf8");
      }
      if (elCodeCount) elCodeCount.textContent = `${vm.instructions.length} lines`;
      if (elSpTop) elSpTop.textContent = `SP: ${vm.stack.length > 0 ? vm.stack.length - 1 : 0}`;
      if (elHeapCount) elHeapCount.textContent = `${vm.heap.length} Nodes`;
      if (elLogText) elLogText.textContent = vm.lastMessage;

      // Instructions
      if (elCode) {
        elCode.innerHTML = vm.instructions.map((ins, idx) => {
          if (ins.isLabel) {
            return `<div style="padding:4px 6px 2px 6px; margin-top:4px; border-top:1px dashed rgba(255,255,255,0.08); color:#a78bfa; font-weight:700; font-size:0.78rem;">
              <span style="color:#64748b; font-size:0.7rem; display:inline-block; width:20px;">${String(idx).padStart(2, '0')}</span>
              ${ins.labelName}:
            </div>`;
          }
          const isActive = (idx === vm.pc);
          const isPassed = (idx < vm.pc);
          return `<div id="${widgetId}_line_${idx}" style="display:flex; align-items:center; padding:3px 6px; border-radius:4px; font-size:0.8rem; background:${isActive ? 'rgba(56,189,248,0.18)' : 'transparent'}; border-left:${isActive ? '3px solid #38bdf8' : 'none'}; opacity:${isPassed ? 0.4 : 1}; white-space:nowrap; gap:6px;">
            <span style="color:#64748b; font-size:0.7rem; width:20px; flex-shrink:0;">${String(idx).padStart(2, '0')}</span>
            <span style="width:14px; font-size:0.75rem; flex-shrink:0;">${isActive ? '👉' : ''}</span>
            <span style="color:#38bdf8; font-weight:600;">${ins.op.toLowerCase()}</span>
            <span style="color:#f1f5f9;">${ins.args.join(', ')}</span>
            ${ins.comment ? `<span style="color:#64748b; font-style:italic; font-size:0.72rem; margin-left:auto; padding-left:8px;">; ${ins.comment}</span>` : ''}
          </div>`;
        }).join("");

        const activeEl = elCode.querySelector(`#${widgetId}_line_${vm.pc}`);
        if (activeEl) {
          const top = activeEl.offsetTop - elCode.offsetTop;
          const bottom = top + activeEl.offsetHeight;
          if (top < elCode.scrollTop) {
            elCode.scrollTop = Math.max(0, top - 8);
          } else if (bottom > elCode.scrollTop + elCode.clientHeight) {
            elCode.scrollTop = bottom - elCode.clientHeight + 8;
          }
        }
      }

      // Stack
      if (elStack) {
        if (vm.stack.length === 0) {
          elStack.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.76rem; padding:24px 8px; font-style:italic;">Stack is leeg</div>';
        } else {
          elStack.innerHTML = [...vm.stack].reverse().map((item, idx) => {
            const origIdx = vm.stack.length - 1 - idx;
            const isHv = (origIdx === vm.hv);
            const isTop = (idx === 0);
            let valHtml = '';
            if (vm.isHeapRef(item)) {
              valHtml = `<span style="background:#8b5cf6; color:white; padding:2px 6px; border-radius:4px; font-size:0.72rem; font-weight:700;">@Node ${item.ref}</span>`;
            } else if (vm.isFuncObj(item)) {
              valHtml = `<span style="background:#ec4899; color:white; padding:2px 6px; border-radius:4px; font-size:0.72rem; font-weight:700;">λ ${item.func}/${item.nrargs}</span>`;
            } else {
              valHtml = `<span style="background:#0ea5e9; color:white; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:700;">${item}</span>`;
            }

            return `<div style="display:flex; justify-content:space-between; align-items:center; background:#1a253a; border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:5px 8px; margin-bottom:4px; font-size:0.8rem; ${isTop ? 'border-color:#38bdf8; background:rgba(56,189,248,0.12);' : ''} ${isHv ? 'border-left:3px solid #a78bfa;' : ''}">
              <div style="display:flex; align-items:center; gap:4px;">
                <span style="color:#94a3b8; font-size:0.7rem;">SP[${origIdx}]</span>
                ${isHv ? '<span style="background:#7c3aed; color:white; font-size:0.62rem; font-weight:800; padding:1px 4px; border-radius:3px;">HV</span>' : ''}
              </div>
              <div>${valHtml}</div>
              ${isTop ? '<div style="background:#38bdf8; color:#0b1120; font-size:0.62rem; font-weight:800; padding:1px 4px; border-radius:3px;">TOP</div>' : ''}
            </div>`;
          }).join("");
        }
      }

      // Heap
      if (elHeap) {
        if (vm.heap.length === 0) {
          elHeap.innerHTML = `<div style="text-align:center; color:#64748b; font-size:0.76rem; padding:24px 10px; line-height:1.4;">
            <span style="font-size:1.1rem; display:block; margin-bottom:4px;">⚡</span>
            Geen heap nodes. Alle operaties worden direct op de stack geëvalueerd (0 heap allocaties).
          </div>`;
        } else {
          elHeap.innerHTML = vm.heap.map(n => `
            <div style="background:#162238; border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:7px; margin-bottom:6px; font-size:0.76rem; border-left:3px solid ${n.type === 'CLOSURE' ? '#8b5cf6' : (n.type === 'CONSTR' ? '#10b981' : '#0ea5e9')};">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <strong style="color:#a78bfa;">@Node ${n.id}</strong>
                <span style="background:${n.type === 'CLOSURE' ? '#8b5cf6' : (n.type === 'CONSTR' ? '#10b981' : '#0ea5e9')}; color:white; font-size:0.62rem; padding:1px 5px; border-radius:3px; font-weight:700; text-transform:uppercase;">${n.type}</span>
              </div>
              <div style="color:#cbd5e1; margin-top:2px;"><span style="color:#94a3b8; font-size:0.7rem;">Func:</span> <code>${n.func}</code> (size: ${n.size})</div>
              ${n.args && n.args.length > 0 ? `<div style="color:#cbd5e1; margin-top:2px; display:flex; gap:4px; align-items:center; flex-wrap:wrap;"><span style="color:#94a3b8; font-size:0.7rem;">Args:</span> ${(n.args||[]).map(a => `<span style="background:#1e293b; border:1px solid rgba(255,255,255,0.1); padding:1px 5px; border-radius:3px; font-size:0.7rem;">${a && a.ref ? '<span style=\"color:#a78bfa; font-weight:600;\">@Node ' + a.ref + '</span>' : (a && a.isFunc ? 'λ ' + a.func : a)}</span>`).join('')}</div>` : ''}
              ${n.value !== undefined ? `<div style="margin-top:2px;"><span style="color:#94a3b8; font-size:0.7rem;">Value:</span> <strong style="color:#38bdf8;">${n.value}</strong></div>` : ''}
            </div>
          `).join("");
        }
      }
    }

    const stepBtn = container.querySelector(`#${widgetId}_step`);
    const resetBtn = container.querySelector(`#${widgetId}_reset`);
    const playBtn = container.querySelector(`#${widgetId}_play`);
    const modeSelect = container.querySelector(`#${widgetId}_mode`);

    stepBtn.onclick = () => {
      if (vm.isHalted) return;
      vm.step();
      renderUI();
    };

    resetBtn.onclick = () => {
      if (runTimer) { clearInterval(runTimer); runTimer = null; playBtn.textContent = "▶ Auto Run"; playBtn.style.background = "#059669"; }
      vm.reset();
      renderUI();
    };

    playBtn.onclick = () => {
      if (runTimer) {
        clearInterval(runTimer);
        runTimer = null;
        playBtn.textContent = "▶ Auto Run";
        playBtn.style.background = "#059669";
        renderUI();
      } else {
        if (vm.isHalted) return;
        playBtn.textContent = "⏸ Pause";
        playBtn.style.background = "#e11d48";
        renderUI();
        runTimer = setInterval(() => {
          if (!vm.step() || vm.isHalted) {
            clearInterval(runTimer);
            runTimer = null;
            playBtn.textContent = "▶ Auto Run";
            playBtn.style.background = "#059669";
          }
          renderUI();
        }, 350);
      }
    };

    if (modeSelect) {
      modeSelect.onchange = (e) => {
        const newMode = e.target.value;
        if (presetBytecode[newMode]) {
          if (runTimer) { clearInterval(runTimer); runTimer = null; playBtn.textContent = "▶ Auto Run"; playBtn.style.background = "#059669"; }
          const titleEl = container.querySelector(`#${widgetId}_title`);
          if (titleEl) {
            const titleMap = {
              fac_strict: "Strict Factorial (fac 3)",
              fac_lazy: "Lazy Factorial (facl 3)",
              twice_hof: "Higher-Order Function (twice inc 5)",
              primes_stream: "Lazy Sieve Stream (3e priem = 5)"
            };
            titleEl.textContent = titleMap[newMode] || "JMVM Stepper";
          }
          vm = new StudioJmvm(presetBytecode[newMode]);
          renderUI();
        }
      };
    }

    setTimeout(() => renderUI(), 50);
    return container;
  }

  function findCourseFileByName(name) {
    for (let mod of state.course.modules) {
      for (let file of mod.files) {
        if (file.name === name) return file;
      }
    }
    return null;
  }

  // --- TOOLBAR & EVENT HANDLERS ---
  function setupEventListeners() {
    // Quick Insert Buttons
    document.querySelectorAll("[data-insert]").forEach(btn => {
      btn.addEventListener("click", () => {
        const type = btn.getAttribute("data-insert");
        handleQuickInsert(type);
      });
    });

    // Run Code button (Code file view)
    if (el.btnRunCode) {
      el.btnRunCode.addEventListener("click", () => {
        const file = getActiveFile();
        if (!file) return;

        el.codeConsole.textContent = "Compiling and running on JMVM WASM...\n";
        const runId = "coderun_" + Math.random().toString(36).substring(2, 9);

        state.pendingRuns.set(runId, {
          path: "/workspace/" + file.name,
          onSuccess: (msg) => {
            const m = msg.metrics || {};
            const timeStr = m.elapsed_time ? `${(parseFloat(m.elapsed_time)*1000).toFixed(1)} ms` : `${msg.durationMs || 0} ms`;
            el.codeConsole.textContent = `=== Execution Finished ===\n` +
              `Result: ${m.res || 'WHNF reached'}\n` +
              `Time: ${timeStr}\n` +
              `Calls: ${m.calls || 0}\n` +
              `Heap Allocations: ${m.creates || 0}\n` +
              `GC Count: ${m.gc_count || 0}\n` +
              `Instructions: ${m.instr_executed || 0}\n\n` +
              `--- Console Output ---\n${msg.output || '(no stdout)'}`;
          },
          onError: (err) => {
            el.codeConsole.textContent = `[COMPILATION ERROR]\n${err}`;
          }
        });

        const isStrictChecked = document.getElementById("chk-code-strictness") ? document.getElementById("chk-code-strictness").checked : true;

        state.worker.postMessage({
          type: "COMPILE",
          id: runId,
          source: file.content,
          path: "/workspace/" + file.name,
          strictness: isStrictChecked,
          backend: "saplcomp"
        });
      });
    }

    // Insert as Playground Tag
    if (el.btnInsertPlayground) {
      el.btnInsertPlayground.addEventListener("click", () => {
        const file = getActiveFile();
        if (!file) return;
        const tag = `<SaplPlayground file="${file.name}" title="${file.name.replace('.cfp', '')}" />`;
        navigator.clipboard.writeText(tag).then(() => {
          alert(`Copied to clipboard:\n${tag}\n\nPaste this into your Markdown lesson!`);
        });
      });
    }

    // Save
    if (el.btnSave) {
      el.btnSave.addEventListener("click", () => {
        saveCourseData();
        alert("Course draft saved in browser!");
      });
    }

    // Publish to Live Site (GitHub API)
    if (el.btnPublish) {
      el.btnPublish.addEventListener("click", promptPublishToGitHub);
    }

    // Export ZIP
    if (el.btnExportZip) {
      el.btnExportZip.addEventListener("click", exportCourseZip);
    }

    // Reset Template
    if (el.btnReset) {
      el.btnReset.addEventListener("click", () => {
        if (confirm("Reset course to default IFL template? All custom changes in browser will be restored.")) {
          state.course = JSON.parse(JSON.stringify(window.DEFAULT_COURSE_DATA));
          saveCourseData();
          renderTree();
          selectFile("home", "index.md");
        }
      });
    }

    // Logout
    if (el.btnLogout) {
      el.btnLogout.addEventListener("click", () => {
        if (confirm("Log out from Course Studio on this device?")) {
          localStorage.removeItem("websapl_github_token");
          state.githubToken = "";
          state.githubUser = null;
          updateAuthUI();
          showAuthModal();
        }
      });
    }

    // Theme Toggle
    if (el.btnTheme) {
      el.btnTheme.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme") || "dark";
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("websapl_theme", next);
        updateThemeButton(next);
      });
    }

    // Auth Login Modal Button
    const btnAuthSubmit = document.getElementById("btn-auth-submit");
    if (btnAuthSubmit) {
      btnAuthSubmit.addEventListener("click", async () => {
        const tokenInput = document.getElementById("auth-token-input");
        const tokenVal = tokenInput ? tokenInput.value.trim() : "";
        if (!tokenVal) {
          showAuthModal("Please enter your GitHub Personal Access Token.");
          return;
        }

        btnAuthSubmit.disabled = true;
        btnAuthSubmit.textContent = "Verifying...";

        state.githubToken = tokenVal;
        localStorage.setItem("websapl_github_token", tokenVal);

        await checkAuth();
        btnAuthSubmit.disabled = false;
        btnAuthSubmit.textContent = "Unlock Course Studio";
      });
    }
  }

  function handleQuickInsert(type) {
    const doc = state.editor.getDoc();
    const cursor = doc.getCursor();

    let textToInsert = "";
    switch (type) {
      case "h1":
        textToInsert = "# Heading 1\n";
        break;
      case "h2":
        textToInsert = "## Heading 2\n";
        break;
      case "bold":
        textToInsert = "**bold text**";
        break;
      case "code":
        textToInsert = "`code`";
        break;
      case "paper":
        textToInsert = `\n> [!NOTE] Paper Insight\n> Based on Section X & Figure Y of the IFL research paper.\n\n`;
        break;
      case "math":
        textToInsert = `\n$$\\text{fac}(n) = \\begin{cases} 1 & \\text{if } n = 0 \\\\ n \\times \\text{fac}(n - 1) & \\text{otherwise} \\end{cases}$$\n\n`;
        break;
      case "challenge":
        textToInsert = `\n### 💡 Student Challenge\nTry modifying the function above to compute fibonacci numbers.\n\n<details>\n<summary>View Solution</summary>\n\n\`\`\`sapl\nfib !n = case n of 0 -> 0; 1 -> 1; _ -> fib (n - 1) + fib (n - 2)\n\`\`\`\n</details>\n\n`;
        break;
      case "stepper":
        showStepperInsertModal(doc, cursor);
        return;
      case "playground":
        showPlaygroundInsertModal(doc, cursor);
        return;
      default:
        break;
    }

    if (textToInsert) {
      doc.replaceRange(textToInsert, cursor);
      state.editor.focus();
    }
  }

  function showStepperInsertModal(doc, cursor) {
    const modal = document.createElement("div");
    modal.className = "studio-modal-overlay";
    modal.innerHTML = `
      <div class="studio-modal">
        <div class="modal-header">
          <span>Embed JMVM Stepper</span>
          <button class="sidebar-btn" onclick="this.closest('.studio-modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
          <label style="display:block; margin-bottom:6px; font-weight:600;">Default Benchmark / Programma:</label>
          <select id="modal-stepper-mode" style="width:100%; padding:6px; background:var(--bg-primary); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; margin-bottom:12px;">
            <option value="fac_strict">Strict Factorial: fac(3)</option>
            <option value="fac_lazy">Lazy Factorial: facl(3)</option>
            <option value="twice_hof">Hogere-orde: twice inc 5</option>
            <option value="primes_stream">Luie Stream: 3e priem (5)</option>
          </select>
          <label style="display:block; margin-bottom:6px; font-weight:600;">Widget Title (optioneel):</label>
          <input id="modal-stepper-title" type="text" placeholder="bv. Higher-Order Twice Stepper" style="width:100%; padding:6px; background:var(--bg-primary); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; box-sizing:border-box; margin-bottom:12px;" />
          <p style="font-size:0.78rem; color:var(--text-muted); margin:0;">
            💡 Studenten kunnen in de les via het keuzemenu altijd vrij wisselen tussen alle presets.
          </p>
        </div>
        <div class="modal-footer">
          <button class="toolbar-btn" onclick="this.closest('.studio-modal-overlay').remove()">Cancel</button>
          <button class="toolbar-btn btn-accent" id="modal-stepper-btn-insert">Insert Stepper</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector("#modal-stepper-btn-insert").onclick = () => {
      const mode = modal.querySelector("#modal-stepper-mode").value;
      const title = modal.querySelector("#modal-stepper-title").value;
      const titleAttr = title ? ` title="${title}"` : '';
      const tag = `\n<JmvmStepper mode="${mode}"${titleAttr} />\n\n`;
      doc.replaceRange(tag, cursor);
      modal.remove();
      state.editor.focus();
    };
  }

  function showPlaygroundInsertModal(doc, cursor) {
    const codeFiles = [];
    state.course.modules.forEach(m => {
      m.files.filter(f => f.type === "code").forEach(f => {
        codeFiles.push({ module: m.title, file: f.name });
      });
    });

    let optionsHtml = codeFiles.map(cf => `<option value="${cf.file}">${cf.file} (${cf.module})</option>`).join("");
    if (!optionsHtml) {
      optionsHtml = '<option value="">No code files yet (create one in sidebar)</option>';
    }

    const modal = document.createElement("div");
    modal.className = "studio-modal-overlay";
    modal.innerHTML = `
      <div class="studio-modal">
        <div class="modal-header">
          <span>Embed Code Playground</span>
          <button class="sidebar-btn" onclick="this.closest('.studio-modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
          <label style="display:block; margin-bottom:6px; font-weight:600;">Select Code File:</label>
          <select id="modal-select-file" style="width:100%; padding:6px; background:var(--bg-primary); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; margin-bottom:12px;">
            ${optionsHtml}
          </select>
          <label style="display:block; margin-bottom:6px; font-weight:600;">Widget Title:</label>
          <input id="modal-widget-title" type="text" placeholder="e.g. Strict Factorial Example" style="width:100%; padding:6px; background:var(--bg-primary); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; box-sizing:border-box; margin-bottom:12px;" />
          <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.85rem; color:var(--text-secondary); cursor:pointer; user-select:none;">
            <input type="checkbox" id="modal-chk-strict" checked style="cursor:pointer;" />
            <span>Enable Strictness Inference (Automatic ! optimization)</span>
          </label>
        </div>
        <div class="modal-footer">
          <button class="toolbar-btn" onclick="this.closest('.studio-modal-overlay').remove()">Cancel</button>
          <button class="toolbar-btn btn-accent" id="modal-btn-insert">Insert Component</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector("#modal-btn-insert").onclick = () => {
      const selectedFile = modal.querySelector("#modal-select-file").value;
      const title = modal.querySelector("#modal-widget-title").value || selectedFile;
      const isStrict = modal.querySelector("#modal-chk-strict") ? modal.querySelector("#modal-chk-strict").checked : true;
      const strictAttr = isStrict ? '' : ' strictness="false"';
      const tag = `\n<SaplPlayground file="${selectedFile}" title="${title}"${strictAttr} />\n\n`;
      doc.replaceRange(tag, cursor);
      modal.remove();
      state.editor.focus();
    };
  }

  // --- 1-CLICK PUBLISH TO GITHUB & LIVE SITE ---
  async function promptPublishToGitHub() {
    if (!state.githubToken) {
      showAuthModal("Please authenticate with your GitHub Token to publish.");
      return;
    }

    const commitMsg = prompt("Publish to Live Website:\nEnter commit message:", "Update course content via Course Studio");
    if (!commitMsg) return;

    const btn = el.btnPublish;
    btn.disabled = true;
    btn.innerHTML = "<span>⏳ Publishing to GitHub...</span>";

    try {
      // 1. Prepare files map (Path -> Content)
      const filesToPush = {};

      // Home index.md
      let homeContent = (state.course.home && state.course.home.content) ? state.course.home.content : "";
      if (homeContent.includes("/guide/01-lazy-evaluation")) {
        homeContent = homeContent.replace(/\/guide\/01-lazy-evaluation/g, "/guide/01_introduction");
        if (state.course.home) state.course.home.content = homeContent;
      }
      filesToPush["funcprog/vitepress-demo/index.md"] = homeContent;

      // Guide files & Code examples
      state.course.modules.forEach((mod, modIdx) => {
        const modSlug = String(modIdx + 1).padStart(2, "0") + "_" + mod.id.replace(/[^a-zA-Z0-9_]/g, "");
        mod.files.forEach(file => {
          if (file.type === "markdown") {
            filesToPush[`funcprog/vitepress-demo/guide/${file.name}`] = file.content || "";
          } else {
            filesToPush[`funcprog/vitepress-demo/examples/${file.name}`] = file.content || "";
          }
        });
      });

      // Full JSON course manifest
      filesToPush["funcprog/course_content.json"] = JSON.stringify(state.course, null, 2);

      // 2. Perform atomic Git Tree Commit via GitHub REST API
      const repoOwner = "janmartinjansen";
      const repoName = "Sapl";
      const branch = "main";
      const headers = {
        "Authorization": `token ${state.githubToken}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      };

      // Get latest commit SHA on main
      const refRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/heads/${branch}`, { headers });
      if (!refRes.ok) throw new Error("Could not fetch latest git branch reference.");
      const refData = await refRes.json();
      const latestCommitSha = refData.object.sha;

      // Get commit tree
      const commitRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/commits/${latestCommitSha}`, { headers });
      if (!commitRes.ok) throw new Error("Could not fetch commit tree.");
      const commitData = await commitRes.json();
      const baseTreeSha = commitData.tree.sha;

      // Create Blobs & Tree Entries
      const treeEntries = [];
      for (const [path, content] of Object.entries(filesToPush)) {
        treeEntries.push({
          path: path,
          mode: "100644",
          type: "blob",
          content: content
        });
      }

      // Create new Tree
      const treeRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/trees`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeEntries
        })
      });
      if (!treeRes.ok) throw new Error("Failed to create Git Tree.");
      const treeData = await treeRes.json();

      // Create Commit
      const newCommitRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/commits`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: commitMsg,
          tree: treeData.sha,
          parents: [latestCommitSha]
        })
      });
      if (!newCommitRes.ok) throw new Error("Failed to create Git Commit.");
      const newCommitData = await newCommitRes.json();

      // Update Ref (Push)
      const updateRefRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/refs/heads/${branch}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          sha: newCommitData.sha,
          force: false
        })
      });
      if (!updateRefRes.ok) throw new Error("Failed to update branch reference.");

      alert(`🎉 Successfully Published!\n\nCommit SHA: ${newCommitData.sha.substring(0, 7)}\nGitHub Actions is now rebuilding the course. The live website will update in ~60 seconds.`);
    } catch (err) {
      alert(`Publish Error:\n${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = "<span>🚀 Publish Live</span>";
    }
  }

  // --- EXPORT COURSE ZIP ---
  function exportCourseZip() {
    if (!window.SimpleZip) {
      alert("ZIP library not loaded");
      return;
    }

    const zip = new window.SimpleZip();

    // Add homepage & manifest
    if (state.course.home) {
      zip.addFile("index.md", state.course.home.content || "");
    }
    zip.addFile("course.json", JSON.stringify(state.course, null, 2));

    // Add all markdown files under guide/ and code under examples/
    state.course.modules.forEach((mod, modIdx) => {
      const modFolder = `guide/module_${modIdx + 1}_${mod.id}`;
      mod.files.forEach(file => {
        if (file.type === "markdown") {
          zip.addFile(`${modFolder}/${file.name}`, file.content || "");
        } else {
          zip.addFile(`examples/${file.name}`, file.content || "");
        }
      });
    });

    const blob = zip.generateBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "funcprog_course_bundle.zip";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  }

  // --- GLOBAL HELPERS FOR SIDEBAR ACTIONS ---
  window.Studio = {
    promptAddFile: (moduleId) => {
      const name = prompt("Enter new filename (e.g., '03_sharing.md' or 'my_test.cfp'):");
      if (!name) return;

      const mod = state.course.modules.find(m => m.id === moduleId);
      if (!mod) return;

      const isMd = name.endsWith(".md");
      const newFile = {
        name: name,
        type: isMd ? "markdown" : "code",
        content: isMd ? `# ${name.replace('.md', '')}\n\nWrite lesson content here...\n` : `|| ${name}\nmain = 42\n`
      };

      mod.files.push(newFile);
      saveCourseData();
      renderTree();
      selectFile(moduleId, name);
    },

    promptDeleteFile: (moduleId, fileName) => {
      if (!confirm(`Are you sure you want to delete '${fileName}'?`)) return;
      const mod = state.course.modules.find(m => m.id === moduleId);
      if (!mod) return;
      mod.files = mod.files.filter(f => f.name !== fileName);
      saveCourseData();
      renderTree();
      if (state.activeFileName === fileName) {
        selectFile("home", "index.md");
      }
    },

    promptAddModule: (title) => {
      const id = "mod_" + Date.now();
      state.course.modules.push({
        id: id,
        title: title,
        files: [
          {
            name: "01_intro.md",
            type: "markdown",
            content: `# ${title}\n\nLesson introduction...\n`
          }
        ]
      });
      saveCourseData();
      renderTree();
      selectFile(id, "01_intro.md");
    },

    promptDeleteModule: (moduleId) => {
      const mod = state.course.modules.find(m => m.id === moduleId);
      if (!confirm(`Delete module '${mod.title}' and all its files?`)) return;
      state.course.modules = state.course.modules.filter(m => m.id !== moduleId);
      saveCourseData();
      renderTree();
      selectFile("home", "index.md");
    }
  };

  function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Start Application
  init();
});
