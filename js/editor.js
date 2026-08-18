/**
 * WebSapl Code Editor (CodeMirror 5 Engine)
 * Multi-document tab management with persistent per-tab state,
 * Sapl syntax highlighting, and keyboard shortcuts.
 */

class SaplEditor {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.options = Object.assign({
      tabSize: 2,
      theme: "light",
      onChange: null,
      onSave: null,
      onRun: null
    }, options);

    this.currentFile = null;
    this.openTabs = new Map(); // path -> { path, title, doc, modified }
    this.cm = null;

    this.initDOM();
    this.initCodeMirror();
  }

  setTheme(themeName) {
    const cmTheme = themeName === "dark" ? "websapl-dark" : "websapl-light";
    if (this.cm) {
      this.cm.setOption("theme", cmTheme);
    }
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="editor-tabs-bar" id="editor-tabs"></div>
      <div class="editor-cm-wrapper" id="editor-cm-wrapper"></div>
      <div class="editor-status-bar">
        <div class="status-left">
          <span class="status-badge" id="editor-file-badge">Geen bestand</span>
          <span class="status-item" id="editor-cursor-pos">Ln 1, Col 1</span>
        </div>
        <div class="status-right">
          <span class="status-item" id="editor-length">0 regels</span>
          <span class="status-item">Sapl / JMVM</span>
          <span class="status-item">UTF-8</span>
        </div>
      </div>
    `;

    this.tabsBar = this.container.querySelector("#editor-tabs");
    this.cmWrapper = this.container.querySelector("#editor-cm-wrapper");
    this.fileBadge = this.container.querySelector("#editor-file-badge");
    this.cursorPos = this.container.querySelector("#editor-cursor-pos");
    this.lengthBadge = this.container.querySelector("#editor-length");
  }

  initCodeMirror() {
    const extraKeys = {
      "Tab": function(cm) {
        if (cm.somethingSelected()) {
          cm.indentSelection("add");
        } else {
          cm.replaceSelection("  ", "end", "+input");
        }
      },
      "Shift-Tab": function(cm) {
        cm.indentSelection("subtract");
      },
      "Ctrl-S": () => {
        if (this.options.onSave) this.options.onSave(this.getValue(), this.currentFile);
        this.markSaved();
      },
      "Cmd-S": () => {
        if (this.options.onSave) this.options.onSave(this.getValue(), this.currentFile);
        this.markSaved();
      },
      "Ctrl-Enter": () => {
        if (this.options.onRun) this.options.onRun(this.getValue(), this.currentFile);
      },
      "Cmd-Enter": () => {
        if (this.options.onRun) this.options.onRun(this.getValue(), this.currentFile);
      },
      "F5": () => {
        if (this.options.onRun) this.options.onRun(this.getValue(), this.currentFile);
      }
    };

    this.cm = CodeMirror(this.cmWrapper, {
      value: "",
      mode: "sapl",
      theme: this.options.theme === "dark" ? "websapl-dark" : "websapl-light",
      lineNumbers: true,
      lineWrapping: false,
      matchBrackets: true,
      autoCloseBrackets: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      extraKeys: extraKeys
    });

    this.cm.on("change", (cm, changeObj) => {
      this.updateStatus();
      if (changeObj && changeObj.origin !== "setValue") {
        this.markModified(true);
        if (this.options.onChange) this.options.onChange(this.getValue(), this.currentFile);
      }
    });

    this.cm.on("cursorActivity", () => {
      this.updateCursorPos();
    });
  }

  updateCursorPos() {
    if (!this.cm) return;
    const pos = this.cm.getCursor();
    this.cursorPos.textContent = `Ln ${pos.line + 1}, Col ${pos.ch + 1}`;
  }

  updateStatus() {
    if (!this.cm) return;
    const count = this.cm.lineCount();
    this.lengthBadge.textContent = `${count} ${count === 1 ? "regel" : "regels"}`;
  }

  getValue() {
    return this.cm ? this.cm.getValue() : "";
  }

  setValue(val) {
    if (!this.cm) return;
    this.cm.setValue(val || "");
    this.cm.clearHistory();
    this.updateStatus();
    this.updateCursorPos();
  }

  refresh() {
    if (this.cm) {
      setTimeout(() => this.cm.refresh(), 20);
    }
  }

  markModified(isModified) {
    if (!this.currentFile) return;
    const tab = this.openTabs.get(this.currentFile);
    if (tab && tab.modified !== isModified) {
      tab.modified = isModified;
      this.renderTabs();
    }
  }

  markSaved(path = null) {
    const target = path || this.currentFile;
    if (!target) return;
    const tab = this.openTabs.get(target);
    if (tab) {
      tab.modified = false;
      this.renderTabs();
    }
  }

  openFile(path, content = null) {
    const filename = path.split("/").pop();

    if (!this.openTabs.has(path)) {
      const doc = CodeMirror.Doc(content || "", "sapl");
      this.openTabs.set(path, {
        path,
        title: filename,
        doc: doc,
        modified: false
      });
    } else if (content !== null && content !== undefined) {
      const tab = this.openTabs.get(path);
      // Only reload content if the tab has not been locally modified
      if (!tab.modified) {
        tab.doc.setValue(content);
        tab.doc.clearHistory();
        tab.modified = false;
      }
    }

    this.currentFile = path;
    const currentTab = this.openTabs.get(path);
    this.cm.swapDoc(currentTab.doc);
    this.fileBadge.textContent = path;
    this.renderTabs();
    this.updateStatus();
    this.updateCursorPos();
    this.cm.focus();
    setTimeout(() => this.cm.refresh(), 10);
  }

  closeTab(path, e) {
    if (e) e.stopPropagation();
    this.openTabs.delete(path);
    if (this.currentFile === path) {
      const remaining = Array.from(this.openTabs.keys());
      if (remaining.length > 0) {
        const next = remaining[remaining.length - 1];
        this.openFile(next);
      } else {
        this.currentFile = null;
        this.cm.swapDoc(CodeMirror.Doc("", "sapl"));
        this.fileBadge.textContent = "Geen bestand";
        this.updateStatus();
        this.updateCursorPos();
      }
    }
    this.renderTabs();
  }

  renderTabs() {
    this.tabsBar.innerHTML = "";
    this.openTabs.forEach((tab, path) => {
      const tabEl = document.createElement("div");
      tabEl.className = `editor-tab ${path === this.currentFile ? "active" : ""} ${tab.modified ? "modified" : ""}`;
      tabEl.innerHTML = `
        <span class="tab-icon">${path.endsWith(".jmvm") ? "⚙️" : "📄"}</span>
        <span class="tab-title">${tab.title}${tab.modified ? " •" : ""}</span>
        <button class="tab-close" title="Sluiten">&times;</button>
      `;
      tabEl.addEventListener("click", () => {
        this.openFile(path);
      });
      tabEl.querySelector(".tab-close").addEventListener("click", (e) => {
        this.closeTab(path, e);
      });
      this.tabsBar.appendChild(tabEl);
    });
  }
}

window.SaplEditor = SaplEditor;
