/**
 * WebSapl Benchmark Suite & Runner Component
 * Manages running the 12 core benchmarks, verifying results, and rendering performance tables.
 */

class SaplBenchmarkSuite {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.options = Object.assign({
      onRunSingle: null,
      onRunAll: null,
      onLoadIntoEditor: null
    }, options);

    this.benchmarks = window.BENCHMARKS_DATA || [];
    this.results = new Map(); // id -> { status, timeMs, instructions, calls, creates, gcCount, output, res }
    this.isRunningAll = false;

    this.initDOM();
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="benchmark-header">
        <div class="benchmark-title-row">
          <h3>⚡ JMVM Benchmark Suite (12 Kernbenchmarks)</h3>
          <div class="benchmark-header-actions">
            <button class="btn btn-primary" id="btn-run-all-benchmarks">
              <span class="btn-icon">▶▶</span> Draai Alle 12 Benchmarks
            </button>
            <button class="btn btn-secondary" id="btn-export-benchmarks" title="Exporteer tabel naar Markdown">
              📋 Exporteer
            </button>
          </div>
        </div>
        <p class="benchmark-subtitle">
          Geijkte regressietests voor luie evaluatie, strictness analyse, recursie, geheugengebruik en patroonherkenning op de JMVM WASM interpreter.
        </p>
        <div class="benchmark-progress-bar" id="benchmark-progress" style="display:none;">
          <div class="progress-fill" id="progress-fill" style="width: 0%;"></div>
        </div>
      </div>

      <div class="benchmark-table-wrapper">
        <table class="benchmark-table" id="benchmark-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Benchmark</th>
              <th>Beschrijving</th>
              <th>Tijd (ms)</th>
              <th>Instructies</th>
              <th>Functie-aanroepen</th>
              <th>Allocaties (Creates)</th>
              <th>GC</th>
              <th>Acties</th>
            </tr>
          </thead>
          <tbody id="benchmark-tbody"></tbody>
        </table>
      </div>
    `;

    this.tbody = this.container.querySelector("#benchmark-tbody");
    this.progressBar = this.container.querySelector("#benchmark-progress");
    this.progressFill = this.container.querySelector("#progress-fill");

    this.container.querySelector("#btn-run-all-benchmarks").addEventListener("click", () => {
      this.runAll();
    });

    this.container.querySelector("#btn-export-benchmarks").addEventListener("click", () => {
      this.exportMarkdown();
    });

    this.renderRows();
  }

  renderRows() {
    this.tbody.innerHTML = "";
    this.benchmarks.forEach((b) => {
      const res = this.results.get(b.id);
      const row = document.createElement("tr");
      row.id = `bench-row-${b.id}`;

      let statusBadge = `<span class="badge badge-pending">Klaar</span>`;
      let timeStr = "-";
      let instrStr = "-";
      let callsStr = "-";
      let createsStr = "-";
      let gcStr = "-";

      if (res) {
        if (res.running) {
          statusBadge = `<span class="badge badge-running">⏳ Draait...</span>`;
        } else if (res.success) {
          statusBadge = `<span class="badge badge-pass">✔ PASS</span>`;
          timeStr = res.timeMs !== undefined ? `${res.timeMs.toFixed(1)} ms` : "-";
          instrStr = res.instructions ? res.instructions.toLocaleString() : "-";
          callsStr = res.calls ? res.calls.toLocaleString() : "-";
          createsStr = res.creates ? res.creates.toLocaleString() : "-";
          gcStr = res.gcCount !== undefined ? res.gcCount.toString() : "0";
        } else if (res.error) {
          statusBadge = `<span class="badge badge-fail">✖ FOUT</span>`;
        }
      }

      row.innerHTML = `
        <td class="col-status">${statusBadge}</td>
        <td class="col-name"><strong>${b.name}</strong><br><small class="text-muted">${b.file}</small></td>
        <td class="col-desc">${b.desc}</td>
        <td class="col-metric col-time">${timeStr}</td>
        <td class="col-metric">${instrStr}</td>
        <td class="col-metric">${callsStr}</td>
        <td class="col-metric">${createsStr}</td>
        <td class="col-metric">${gcStr}</td>
        <td class="col-actions">
          <button class="btn btn-sm btn-outline btn-run-single" data-id="${b.id}" title="Draai deze benchmark">▶ Run</button>
          <button class="btn btn-sm btn-ghost btn-load-code" data-id="${b.id}" title="Laad code in editor">📝 Code</button>
        </td>
      `;

      row.querySelector(".btn-run-single").addEventListener("click", () => {
        this.runSingle(b);
      });

      row.querySelector(".btn-load-code").addEventListener("click", () => {
        if (this.options.onLoadIntoEditor) {
          this.options.onLoadIntoEditor(`/benchmarks/${b.file}`, b.source);
        }
      });

      this.tbody.appendChild(row);
    });
  }

  setRunning(id, isRunning) {
    let entry = this.results.get(id) || {};
    entry.running = isRunning;
    this.results.set(id, entry);
    this.renderRows();
  }

  setResult(id, resultData) {
    this.results.set(id, Object.assign({ success: true, running: false }, resultData));
    this.renderRows();
  }

  setError(id, errorMsg) {
    this.results.set(id, { success: false, running: false, error: errorMsg });
    this.renderRows();
  }

  async runSingle(benchmark) {
    if (this.options.onRunSingle) {
      this.setRunning(benchmark.id, true);
      try {
        await this.options.onRunSingle(benchmark);
      } catch (err) {
        this.setError(benchmark.id, err.message);
      }
    }
  }

  async runAll() {
    if (this.isRunningAll) return;
    this.isRunningAll = true;
    this.progressBar.style.display = "block";
    this.progressFill.style.width = "0%";

    const btn = this.container.querySelector("#btn-run-all-benchmarks");
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-icon">⏳</span> Uitvoeren...`;

    let completed = 0;
    for (const b of this.benchmarks) {
      this.setRunning(b.id, true);
      try {
        if (this.options.onRunSingle) {
          await this.options.onRunSingle(b);
        }
      } catch (err) {
        this.setError(b.id, err.message);
      }
      completed++;
      this.progressFill.style.width = `${Math.round((completed / this.benchmarks.length) * 100)}%`;
    }

    this.isRunningAll = false;
    btn.disabled = false;
    btn.innerHTML = `<span class="btn-icon">▶▶</span> Draai Alle 12 Benchmarks`;
    setTimeout(() => {
      this.progressBar.style.display = "none";
    }, 2000);
  }

  exportMarkdown() {
    let md = `## WebSapl Benchmark Resultaten\n\n`;
    md += `| Benchmark | Tijd (ms) | Instructies | Calls | Allocaties | GC |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: | :---: |\n`;

    this.benchmarks.forEach((b) => {
      const res = this.results.get(b.id);
      if (res && res.success) {
        md += `| **${b.id}** | ${res.timeMs.toFixed(1)} | ${res.instructions.toLocaleString()} | ${res.calls.toLocaleString()} | ${res.creates.toLocaleString()} | ${res.gcCount} |\n`;
      } else {
        md += `| **${b.id}** | - | - | - | - | - |\n`;
      }
    });

    navigator.clipboard.writeText(md).then(() => {
      alert("Benchmark resultaten zijn gekopieerd naar het klembord als Markdown tabel!");
    });
  }
}

window.SaplBenchmarkSuite = SaplBenchmarkSuite;
