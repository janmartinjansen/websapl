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
    try {
      const saved = localStorage.getItem("websapl_course_studio_data");
      if (saved) {
        state.course = JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Failed to load saved course data:", e);
    }

    if (!state.course || !state.course.modules) {
      state.course = JSON.parse(JSON.stringify(window.DEFAULT_COURSE_DATA || { title: "Course", home: {}, modules: [] }));
    }

    if (!state.course.home) {
      state.course.home = {
        name: "index.md",
        type: "markdown",
        content: window.DEFAULT_COURSE_DATA.home ? window.DEFAULT_COURSE_DATA.home.content : "# Course Title\n"
      };
    }
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

    // Replace custom <SaplPlayground ... /> tags with placeholder divs before parsing markdown
    const playgrounds = [];
    const processedMarkdown = rawMarkdown.replace(/<SaplPlayground\s+([^>]*)\/?>/g, (match, attrsStr) => {
      const idx = playgrounds.length;
      const attrs = parseAttributes(attrsStr);
      playgrounds.push(attrs);
      return `\n\n<div class="sapl-playground-placeholder" data-idx="${idx}"></div>\n\n`;
    });

    // Parse Markdown with marked.js
    let htmlOutput = "";
    try {
      htmlOutput = marked.parse(processedMarkdown);
    } catch (e) {
      htmlOutput = `<div style="color:red">Markdown Parse Error: ${e.message}</div>`;
    }

    el.previewContent.innerHTML = htmlOutput;

    // Render interactive widgets into placeholders
    const placeholders = el.previewContent.querySelectorAll(".sapl-playground-placeholder");
    placeholders.forEach(ph => {
      const idx = parseInt(ph.getAttribute("data-idx"), 10);
      const attrs = playgrounds[idx];
      if (attrs) {
        const widget = createPlaygroundWidget(attrs);
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
      filesToPush["funcprog/vitepress-demo/index.md"] = state.course.home.content || "";

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
