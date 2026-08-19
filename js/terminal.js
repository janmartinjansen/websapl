/**
 * WebSapl Terminal & Console Output Component
 * Displays live streaming output from the WASM VM and compiler with color syntax.
 */

class SaplTerminal {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.options = Object.assign({
      maxLines: 2000,
      autoScroll: true
    }, options);

    this.lines = [];
    this.initDOM();
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="terminal-header">
        <div class="terminal-title">
          <span class="terminal-dot red"></span>
          <span class="terminal-dot yellow"></span>
          <span class="terminal-dot green"></span>
          <span class="terminal-name">TERMINAL & OUTPUT</span>
        </div>
        <div class="terminal-actions">
          <label class="terminal-autoscroll-label">
            <input type="checkbox" id="terminal-autoscroll" checked /> Auto-scroll
          </label>
          <button class="btn btn-xs btn-ghost" id="btn-copy-terminal" title="Kopieer output">📋 Kopiëren</button>
          <button class="btn btn-xs btn-ghost" id="btn-clear-terminal" title="Wis terminal">🧹 Wissen</button>
          <button class="btn btn-xs btn-ghost" id="btn-close-terminal" title="Verberg onderpaneel">✕</button>
        </div>
      </div>
      <div class="terminal-body" id="terminal-body">
        <div class="terminal-content" id="terminal-content"></div>
      </div>
    `;

    this.bodyEl = this.container.querySelector("#terminal-body");
    this.contentEl = this.container.querySelector("#terminal-content");
    this.autoscrollCheckbox = this.container.querySelector("#terminal-autoscroll");

    this.container.querySelector("#btn-clear-terminal").addEventListener("click", () => {
      this.clear();
    });

    this.container.querySelector("#btn-copy-terminal").addEventListener("click", () => {
      this.copyToClipboard();
    });

    this.container.querySelector("#btn-close-terminal").addEventListener("click", () => {
      if (this.options.onClose) this.options.onClose();
    });
  }

  append(text, type = "stdout") {
    if (!text) return;

    const div = document.createElement("div");
    div.className = `term-line term-${type}`;

    // Colorize specific output patterns
    let formatted = this.escapeHtml(text);

    if (type === "stdout") {
      if (formatted.includes("res:")) {
        formatted = formatted.replace(/(res:\s*)([^\n]+)/g, '<span class="term-res">$1<strong>$2</strong></span>');
      }
      if (formatted.includes("[Compiler]")) {
        formatted = `<span class="term-compiler">${formatted}</span>`;
      }
      if (formatted.includes("[VM]")) {
        formatted = `<span class="term-vm">${formatted}</span>`;
      }
      if (formatted.includes("Elapsed time:")) {
        formatted = formatted.replace(/(Elapsed time:\s*)([0-9.]+\s*secs)/g, '<span class="term-metric">$1<strong>$2</strong></span>');
      }
    } else if (type === "stderr") {
      formatted = `<span class="term-error">${formatted}</span>`;
    }

    div.innerHTML = formatted;
    this.contentEl.appendChild(div);

    if (this.autoscrollCheckbox.checked) {
      this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
    }
  }

  clear() {
    this.contentEl.innerHTML = "";
  }

  copyToClipboard() {
    const text = this.contentEl.textContent || "";
    navigator.clipboard.writeText(text).then(() => {
      const btn = this.container.querySelector("#btn-copy-terminal");
      const oldText = btn.textContent;
      btn.textContent = "✔ Gekopieerd!";
      setTimeout(() => { btn.textContent = oldText; }, 1500);
    });
  }

  escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}

window.SaplTerminal = SaplTerminal;
