(function () {
  "use strict";

  // Er bestaat geen echt interactieve stdin-stream in deze WASM-opzet:
  // ../engine/worker.js's RUN-boodschap (dezelfde die studio.js voor de
  // "Run"-knop gebruikt) voert een heel stdin-blok in één keer uit en geeft
  // pas na afloop de volledige uitvoer terug. Daarom draait elke nieuwe
  // invoer een VERSE lc_repl-run, met als stdin:
  //
  //   alle eerder gelukte "naam = ..."-regels (in volgorde, dubbele namen
  //   inbegrepen -- lc_repl plakt een binding er al bij het parsen in, dus
  //   "a = 1", "b = a", "a = 2" moet exact zo terugkomen)
  //   + de nieuwe regel(s)
  //   + "quit" (lc_repl's readLine geeft bij een lege stdin geen EOF maar
  //     blijft eindeloos "lc> " printen)
  //
  // Alleen bindingen worden opnieuw afgespeeld, niet eerdere :nf/:seval/
  // :bits-regels: die veranderen de sessie niet, en hun uitvoer staat al in
  // `entries`. Een dure `:bits 2000 primes` draait dus één keer, niet bij
  // elke volgende regel opnieuw.
  //
  // lc_repl heeft geen foutherstel (een `error` stopt de VM), maar dat is
  // hier onschadelijk: een regel die faalt komt nooit in `bindings`, dus de
  // volgende run begint weer schoon. Een divergente term (`:nf` zonder
  // normaalvorm) komt nooit terug uit de worker -- na RUN_TIMEOUT_MS wordt
  // die worker gestopt en een verse gestart.

  var RUN_TIMEOUT_MS = 60000;

  var termEl = document.getElementById("terminal");
  var inputEl = document.getElementById("cmd-input");
  var runBtn = document.getElementById("run-btn");
  var resetBtn = document.getElementById("reset-btn");
  var listBtn = document.getElementById("list-btn");
  var statusEl = document.getElementById("status");
  var bindingsEl = document.getElementById("bindings");
  var chipsEl = document.getElementById("chips");

  var worker = null;
  var ready = false;
  var busy = false;
  var jmvmText = null;
  var banner = "";
  var entries = []; // { line, output, kind: "ok"|"error"|"skipped"|"timeout" }
  var bindings = []; // { name, line }, in sessievolgorde
  var runCounter = 0;
  var pending = null; // { id, newLines, timer, startedAt }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " status-" + kind : "");
  }

  function setBusy(v) {
    busy = v;
    var off = !ready || busy;
    inputEl.disabled = off;
    runBtn.disabled = off;
    listBtn.disabled = off;
    resetBtn.disabled = off;
    Array.prototype.forEach.call(chipsEl.querySelectorAll(".chip"), function (c) { c.disabled = off; });
  }

  function renderBindings() {
    var seen = {};
    var names = [];
    bindings.forEach(function (b) { if (!seen[b.name]) { seen[b.name] = true; names.push(b.name); } });
    bindingsEl.textContent = names.length ? "sessie-bindingen: " + names.join(", ") : "nog geen bindingen";
  }

  function span(cls, text) {
    var s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    return s;
  }

  function withNewline(text) {
    return text && text.charAt(text.length - 1) !== "\n" ? text + "\n" : text;
  }

  function render() {
    termEl.textContent = "";
    termEl.appendChild(span("t-banner", banner));
    entries.forEach(function (e) {
      termEl.appendChild(span("t-prompt", "lc> "));
      termEl.appendChild(span("t-in", e.line + "\n"));
      if (e.kind === "ok") termEl.appendChild(document.createTextNode(e.output));
      else if (e.kind === "error") termEl.appendChild(span("t-err", withNewline(e.output) + "[lc_repl stopte op deze regel; de sessie blijft zoals hij was]\n"));
      else if (e.kind === "timeout") termEl.appendChild(span("t-err", "[geen antwoord binnen " + (RUN_TIMEOUT_MS / 1000) + "s -- divergente term? Run gestopt; de sessie blijft zoals hij was]\n"));
      else termEl.appendChild(span("t-skip", "[niet uitgevoerd: een eerdere regel van dezelfde invoer faalde]\n"));
    });
    termEl.scrollTop = termEl.scrollHeight;
    renderBindings();
  }

  function startWorker() {
    worker = new Worker("../engine/worker.js");
    worker.onmessage = onWorkerMessage;
    worker.postMessage({ type: "INIT" });
  }

  function runLines(newLines) {
    if (!ready) return;
    setBusy(true);
    setStatus("bezig…", "busy");
    var id = "run" + (++runCounter);
    var stdinLines = bindings.map(function (b) { return b.line; }).concat(newLines).concat(["quit"]);
    pending = {
      id: id,
      newLines: newLines,
      startedAt: Date.now(),
      timer: setTimeout(function () { onTimeout(id); }, RUN_TIMEOUT_MS)
    };
    worker.postMessage({ type: "RUN", contentOrPath: jmvmText, isPath: false, stdin: stdinLines.join("\n") + "\n", id: id });
  }

  function onTimeout(id) {
    if (!pending || pending.id !== id) return;
    pending.newLines.forEach(function (l) { entries.push({ line: l, output: "", kind: "timeout" }); });
    pending = null;
    worker.terminate();
    ready = false;
    render();
    setStatus("timeout -- engine wordt opnieuw gestart…", "error");
    setBusy(true);
    startWorker();
  }

  function onRunComplete(msg) {
    var p = pending;
    clearTimeout(p.timer);
    pending = null;
    var nReplay = bindings.length;
    var r = window.lcParseTranscript(msg.output || "", nReplay, p.newLines.length);
    if (r.banner && !banner) banner = r.banner;
    var seconds = ((Date.now() - p.startedAt) / 1000).toFixed(2);

    if (r.failedAt >= 0 && r.failedAt < nReplay) {
      // Zou niet mogen gebeuren (elke opgeslagen binding liep eerder al goed).
      setStatus("opnieuw afspelen van binding \"" + bindings[r.failedAt].name + "\" faalde -- reset de sessie", "error");
      entries.push({ line: bindings[r.failedAt].line, output: r.errorText, kind: "error" });
      render();
      setBusy(false);
      return;
    }

    p.newLines.forEach(function (line, i) {
      if (i < r.outputs.length) {
        entries.push({ line: line, output: r.outputs[i], kind: "ok" });
        var m = /^gedefinieerd: (\S+)/.exec(r.outputs[i]);
        if (m) bindings.push({ name: m[1], line: line });
      } else if (i === r.outputs.length && r.failedAt >= 0) {
        entries.push({ line: line, output: r.errorText, kind: "error" });
      } else {
        entries.push({ line: line, output: "", kind: "skipped" });
      }
    });
    render();
    if (r.failedAt >= 0) setStatus("fout -- sessie ongewijzigd (" + seconds + "s)", "error");
    else setStatus("klaar (" + seconds + "s)", "ok");
    setBusy(false);
    inputEl.focus();
  }

  function onWorkerMessage(e) {
    var msg = e.data;
    if (msg.type === "INIT_DONE") {
      var afterLoad = function () {
        ready = true;
        setBusy(false);
        setStatus("klaar", "ok");
        if (!banner) runLines([]); // haalt alleen het opstartbericht op
        else inputEl.focus();
      };
      if (jmvmText) { afterLoad(); return; }
      fetch("lc_repl.jmvm")
        .then(function (r) { return r.text(); })
        .then(function (text) { jmvmText = text; afterLoad(); })
        .catch(function () { setStatus("kon lc_repl.jmvm niet laden", "error"); });
      return;
    }
    if (msg.type === "RUN_COMPLETE" && pending && msg.id === pending.id) onRunComplete(msg);
  }

  // Een chip kan meerdere regels tegelijk indienen (\n-gescheiden in
  // data-cmd): de ":seval"-chips nemen zo hun eigen voorwaarden
  // (Y/fact resp. primes/add/Y/decodeAcc) mee. Alle regels van één klik
  // draaien in één run; faalt er één, dan worden de volgende overgeslagen.
  function submitLines(text) {
    if (!ready || busy) return;
    var parts = (text || "").split("\n")
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0 && l !== "quit" && l !== "exit"; });
    if (!parts.length) return;
    runLines(parts);
  }

  // Invoergeschiedenis (pijl omhoog/omlaag), per browser bewaard.
  var HISTORY_KEY = "websapl_lcrepl_history";
  var history = [];
  try {
    var saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (Array.isArray(saved)) history = saved;
  } catch (e) {}
  var historyCursor = history.length;
  var draft = "";

  function submitFromInput() {
    var val = inputEl.value;
    if (!val.trim()) return;
    if (history[history.length - 1] !== val) {
      history.push(val);
      if (history.length > 500) history.shift();
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) {}
    }
    historyCursor = history.length;
    draft = "";
    inputEl.value = "";
    submitLines(val);
  }

  runBtn.addEventListener("click", submitFromInput);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitFromInput();
    } else if (e.key === "ArrowUp" && history.length && historyCursor > 0) {
      e.preventDefault();
      if (historyCursor === history.length) draft = inputEl.value;
      inputEl.value = history[--historyCursor];
    } else if (e.key === "ArrowDown" && historyCursor < history.length) {
      e.preventDefault();
      historyCursor++;
      inputEl.value = historyCursor === history.length ? draft : history[historyCursor];
    }
  });
  listBtn.addEventListener("click", function () { submitLines(":list"); });
  resetBtn.addEventListener("click", function () {
    if (busy) return;
    entries = [];
    bindings = [];
    render();
    setStatus("sessie gewist", "ok");
  });
  Array.prototype.forEach.call(chipsEl.querySelectorAll(".chip"), function (chip) {
    chip.addEventListener("click", function () { submitLines(chip.getAttribute("data-cmd")); });
  });

  setStatus("wordt geladen…", "busy");
  renderBindings();
  startWorker();
})();
