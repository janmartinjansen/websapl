/**
 * WebSapl Metrics & Profiler Bar Component
 */

class SaplMetrics {
  constructor(containerElement) {
    this.container = containerElement;
    this.initDOM();
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="metrics-panel">
        <div class="metric-card">
          <span class="metric-label">⏱️ EXECUTIETIJD</span>
          <span class="metric-value" id="metric-time">-</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">🔄 INSTRUCTIES</span>
          <span class="metric-value" id="metric-instr">-</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">📞 FUNCTIE CALLS</span>
          <span class="metric-value" id="metric-calls">-</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">📦 ALLOCATIES (CREATES)</span>
          <span class="metric-value" id="metric-creates">-</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">🧹 GARBAGE COLLECTIES</span>
          <span class="metric-value" id="metric-gc">-</span>
        </div>
        <div class="metric-card metric-card-res">
          <span class="metric-label">🎯 RESULTAAT (RES)</span>
          <span class="metric-value metric-res" id="metric-res">-</span>
        </div>
      </div>
    `;

    this.timeEl = this.container.querySelector("#metric-time");
    this.instrEl = this.container.querySelector("#metric-instr");
    this.callsEl = this.container.querySelector("#metric-calls");
    this.createsEl = this.container.querySelector("#metric-creates");
    this.gcEl = this.container.querySelector("#metric-gc");
    this.resEl = this.container.querySelector("#metric-res");
  }

  update(metrics) {
    if (!metrics) return;

    this.timeEl.textContent = metrics.elapsedMs !== undefined ? `${metrics.elapsedMs.toFixed(1)} ms` : "-";
    this.instrEl.textContent = metrics.instructions ? metrics.instructions.toLocaleString() : "0";
    this.callsEl.textContent = metrics.calls ? metrics.calls.toLocaleString() : "0";
    this.createsEl.textContent = metrics.creates ? metrics.creates.toLocaleString() : "0";
    this.gcEl.textContent = metrics.gcCount !== undefined ? metrics.gcCount.toString() : "0";
    this.resEl.textContent = metrics.res !== null ? metrics.res : "(geen)";
  }

  reset() {
    this.timeEl.textContent = "-";
    this.instrEl.textContent = "-";
    this.callsEl.textContent = "-";
    this.createsEl.textContent = "-";
    this.gcEl.textContent = "-";
    this.resEl.textContent = "-";
  }
}

window.SaplMetrics = SaplMetrics;
