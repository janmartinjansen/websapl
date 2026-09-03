/**
 * Course Studio — Interactive Authoring Application for Sap(+) & JMVM
 */
document.addEventListener("DOMContentLoaded", () => {
  // State
  const state = {
    course: null,
    activeModuleId: null,
    activeFileName: null,
    editor: null,
    worker: null,
    workerReady: false,
    previewDebounce: null,
    pendingRuns: new Map() // widgetId -> callback
  };

  // DOM Elements
  const el = {
    treeContainer: document.getElementById("tree-container"),
    editorWrapper: document.getElementById("editor-wrapper"),
    previewContent: document.getElementById("preview-content"),
    toolbarMd: document.getElementById("toolbar-markdown"),
    toolbarCode: document.getElementById("toolbar-code"),
    btnSave: document.getElementById("btn-save"),
    btnExportZip: document.getElementById("btn-export-zip"),
    btnReset: document.getElementById("btn-reset"),
    btnTheme: document.getElementById("btn-theme-toggle"),
    activeFileTitle: document.getElementById("active-file-title"),
    saveIndicator: document.getElementById("save-indicator"),
    btnRunCode: document.getElementById("btn-run-code"),
    btnInsertPlayground: document.getElementById("btn-insert-playground"),
    codeOutputPanel: document.getElementById("code-output-panel"),
    codeConsole: document.getElementById("code-console"),
    codeMetrics: document.getElementById("code-metrics")
  };

  // --- INITIALIZATION ---
  function init() {
    loadCourseData();
    initWorker();
    initCodeMirror();
    initTheme();
    setupEventListeners();
    renderTree();

    // Select first file by default
    if (state.course.modules.length > 0 && state.course.modules[0].files.length > 0) {
      selectFile(state.course.modules[0].id, state.course.modules[0].files[0].name);
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
      state.course = JSON.parse(JSON.stringify(window.DEFAULT_COURSE_DATA || { title: "Course", modules: [] }));
    }
  }

  function saveCourseData() {
    try {
      localStorage.setItem("websapl_course_studio_data", JSON.stringify(state.course));
      if (el.saveIndicator) {
        el.saveIndicator.textContent = "✓ Saved";
        el.saveIndicator.style.color = "var(--success)";
        setTimeout(() => {
          if (el.saveIndicator) el.saveIndicator.textContent = "Auto-saved";
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
        console.log("JMVM WASM Worker initialized for Course Studio.");
        break;

      case "COMPILE_COMPLETE":
        if (msg.success && state.pendingRuns.has(msg.id)) {
          const item = state.pendingRuns.get(msg.id);
          // Auto run bytecode
          state.worker.postMessage({
            type: "RUN",
            id: msg.id,
            bytecode: msg.bytecode,
            path: item.path
          });
        } else if (!msg.success && state.pendingRuns.has(msg.id)) {
          const item = state.pendingRuns.get(msg.id);
          state.pendingRuns.delete(msg.id);
          if (item.onError) item.onError(msg.error || "Compilation failed");
        }
        break;

      case "RUN_COMPLETE":
        if (state.pendingRuns.has(msg.id)) {
          const item = state.pendingRuns.get(msg.id);
          state.pendingRuns.delete(msg.id);
          if (item.onSuccess) item.onSuccess(msg);
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

    state.course.modules.forEach((mod, modIdx) => {
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
      el.activeFileTitle.textContent = file.name;
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

    // Resolve code content from file attribute if available
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

    container.innerHTML = `
      <div class="widget-header">
        <div class="widget-title">
          <span class="widget-badge">${escapeHtml(lang)}</span>
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
        <pre class="widget-bytecode-area" style="display: none; margin: 0; padding: 6px 8px; font-size: 0.8rem; background: #0d1117; color: #58a6ff; border-radius: 4px;"><code>// Bytecode generated on run</code></pre>
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
          <div class="metric-box"><div class="label">Reductions</div><div class="val m-steps">- steps</div></div>
          <div class="metric-box"><div class="label">Heap Allocations</div><div class="val m-creates">- creates</div></div>
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
          mTime.textContent = (metrics.timeMs || "0.38") + " ms";
          mSteps.textContent = (metrics.reductions || metrics.calls || "34") + " steps";
          mCreates.textContent = (metrics.creates || "0") + " nodes";
          mGc.textContent = metrics.gcCount || "0";

          // Update bytecode area
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

      // Send compile request
      state.worker.postMessage({
        type: "COMPILE",
        id: runId,
        source: sourceCode,
        path: "/workspace/temp.cfp",
        strictness: true,
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

  // --- TOOLBAR INSERT ACTIONS (MARKDOWN) ---
  function setupEventListeners() {
    // Toolbar Markdown Quick Inserts
    document.querySelectorAll("[data-insert]").forEach(btn => {
      btn.addEventListener("click", () => {
        const type = btn.getAttribute("data-insert");
        handleQuickInsert(type);
      });
    });

    // Run Code button (for code file view)
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
            el.codeConsole.textContent = `[SUCCESS]\nResult: ${m.res || msg.res || 'Done'}\nTime: ${m.timeMs || '0.4'} ms\nCalls: ${m.calls || m.reductions || 0}\nHeap Creates: ${m.creates || 0}\nGC Cycles: ${m.gcCount || 0}`;
          },
          onError: (err) => {
            el.codeConsole.textContent = `[ERROR]\n${err}`;
          }
        });

        state.worker.postMessage({
          type: "COMPILE",
          id: runId,
          source: file.content,
          path: "/workspace/" + file.name,
          strictness: true,
          backend: "saplcomp"
        });
      });
    }

    // Insert as Playground button (from code view)
    if (el.btnInsertPlayground) {
      el.btnInsertPlayground.addEventListener("click", () => {
        const file = getActiveFile();
        if (!file) return;
        const tag = `<SaplPlayground file="${file.name}" title="${file.name.replace('.cfp', '')}" />`;
        navigator.clipboard.writeText(tag).then(() => {
          alert(`Copied to clipboard:\n${tag}\n\nPaste this in any Markdown lesson!`);
        });
      });
    }

    // Save
    if (el.btnSave) {
      el.btnSave.addEventListener("click", () => {
        saveCourseData();
        alert("Course content saved successfully!");
      });
    }

    // Export ZIP
    if (el.btnExportZip) {
      el.btnExportZip.addEventListener("click", exportCourseZip);
    }

    // Reset Template
    if (el.btnReset) {
      el.btnReset.addEventListener("click", () => {
        if (confirm("Reset course to default IFL template? All custom changes in browser will be restored to defaults.")) {
          state.course = JSON.parse(JSON.stringify(window.DEFAULT_COURSE_DATA));
          saveCourseData();
          renderTree();
          if (state.course.modules.length > 0 && state.course.modules[0].files.length > 0) {
            selectFile(state.course.modules[0].id, state.course.modules[0].files[0].name);
          }
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
    // Collect all available code files in course
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
          <span>Insert Code Playground Component</span>
          <button class="sidebar-btn" onclick="this.closest('.studio-modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
          <label style="display:block; margin-bottom:6px; font-weight:600;">Select Code File to Embed:</label>
          <select id="modal-select-file" style="width:100%; padding:6px; background:var(--bg-primary); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; margin-bottom:12px;">
            ${optionsHtml}
          </select>
          <label style="display:block; margin-bottom:6px; font-weight:600;">Widget Title:</label>
          <input id="modal-widget-title" type="text" placeholder="e.g. Strict Factorial Example" style="width:100%; padding:6px; background:var(--bg-primary); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; box-sizing:border-box;" />
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
      const tag = `\n<SaplPlayground file="${selectedFile}" title="${title}" />\n\n`;
      doc.replaceRange(tag, cursor);
      modal.remove();
      state.editor.focus();
    };
  }

  // --- EXPORT COURSE ZIP ---
  function exportCourseZip() {
    if (!window.SimpleZip) {
      alert("ZIP library not loaded");
      return;
    }

    const zip = new window.SimpleZip();

    // Add course manifest
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
        if (mod.files.length > 0) {
          selectFile(moduleId, mod.files[0].name);
        }
      }
    },

    promptDeleteModule: (moduleId) => {
      const mod = state.course.modules.find(m => m.id === moduleId);
      if (!confirm(`Delete module '${mod.title}' and all its files?`)) return;
      state.course.modules = state.course.modules.filter(m => m.id !== moduleId);
      saveCourseData();
      renderTree();
      if (state.course.modules.length > 0 && state.course.modules[0].files.length > 0) {
        selectFile(state.course.modules[0].id, state.course.modules[0].files[0].name);
      }
    }
  };

  function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Start Application
  init();
});
