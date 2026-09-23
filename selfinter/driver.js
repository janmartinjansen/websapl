(function () {
  "use strict";

  // Anders dan de Claude-Artifact-versie van deze pagina (die als één
  // zelfstandig HTML-bestand moet kunnen bestaan) haalt deze versie
  // README.md en de .fp-bronbestanden gewoon via fetch() op uit
  // examples/ -- de echte bestanden zijn hier de enige bron van
  // waarheid, geen ingebakken kopie die uit de pas kan lopen.

  var EXAMPLES = {
    list_demo: {
      title: "list_demo.fp",
      blurb: "lijsten, rechtstreeks geprint",
      file: "examples/list_demo.fp",
      chips: [
        { label: "cons 7 nil", expr: 'printList (cons 7 nil) ""' },
        { label: "geneste lijst", expr: 'printList (cons 1 (cons 2 (cons 3 nil))) ""' },
        { label: "6 × 7", expr: 'print 0 (mult 6 7) ""' },
        { label: "lijst van lijsten", expr: 'printListList (cons (cons 1 (cons 2 nil)) (cons (cons 3 nil) nil)) ""' }
      ]
    },
    sieve: {
      title: "sieve.fp",
      blurb: "de klassieke zeef van Eratosthenes",
      file: "examples/sieve.fp",
      chips: [
        { label: "eerste 10 priemgetallen", expr: 'printList (take 10 primes) ""' },
        { label: "eerste 25 priemgetallen", expr: 'printList (take 25 primes) ""' },
        { label: "eerste 50 priemgetallen", expr: 'printList (take 50 primes) ""' }
      ]
    },
    self_interpreter: {
      title: "self_interpreter.fp",
      blurb: "interpreteert een lambda-term als functie",
      file: "examples/self_interpreter.fp",
      chips: [
        { label: "testfac 5 (5!)", expr: 'print 0 (testfac 5) ""' },
        { label: "testfac 6 (6!)", expr: 'print 0 (testfac 6) ""' },
        { label: "testfac 7 (7!)", expr: 'print 0 (testfac 7) ""' },
        { label: "priemzeef via seval", expr: 'printPrimes 30 testprimes' },
        { label: "priemzeef, 1-regelversie", expr: 'printPrimesB 30 testprimesOneliner' }
      ]
    },
    minimal_primes: {
      title: "minimal_primes.fp",
      blurb: "priemzeef, pure zelftoepassing",
      file: "examples/minimal_primes.fp",
      chips: [
        { label: "printlist 20 primes", expr: "printlist 20 primes" },
        { label: "printlist 40 primes", expr: "printlist 40 primes" },
        { label: "printlist 20 pp", expr: "printlist 20 pp" }
      ]
    }
  };

  var filelistEl   = document.getElementById("filelist");
  var readmeViewEl = document.getElementById("readme-view");
  var exampleViewEl= document.getElementById("example-view");
  var topbarTitle  = document.getElementById("topbar-title");
  var topbarBlurb  = document.getElementById("topbar-blurb");
  var programEl    = document.getElementById("program");
  var consoleEl    = document.getElementById("console");
  var statsEl      = document.getElementById("stats");
  var exprEl       = document.getElementById("expr");
  var loadBtn      = document.getElementById("load-btn");
  var runBtn       = document.getElementById("run-btn");
  var chipsEl      = document.getElementById("chips");

  fetch("examples/README.md")
    .then(function (r) { return r.text(); })
    .then(function (md) {
      if (window.marked && window.marked.parse) {
        readmeViewEl.innerHTML = marked.parse(md);
      } else {
        readmeViewEl.textContent = md;
      }
    })
    .catch(function () {
      readmeViewEl.textContent = "kon examples/README.md niet laden";
    });

  var printSink = null;

  function appendLine(cls, text) {
    var div = document.createElement("div");
    div.className = "line " + cls;
    div.textContent = text;
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
  function clearConsole() { consoleEl.textContent = ""; }

  var web_init, web_load, web_eval, web_stats;
  var ready = false, loaded = false, currentId = "readme";
  var sourceCache = {};

  function updateStats() { statsEl.textContent = ready ? web_stats() : "—"; }

  function doLoad(showLine) {
    if (!ready) return;
    printSink = null;
    try {
      web_load(programEl.value);
      loaded = true;
      if (showLine) appendLine("sys", "» programma geladen");
    } catch (e) {
      loaded = false;
      appendLine("err", "» laden mislukt");
    }
    updateStats();
  }

  function doRun(expr) {
    if (!ready || !loaded || !expr) return;
    appendLine("prompt", "› " + expr);
    printSink = function (text) { appendLine("out", text.length ? text : "(geen uitvoer)"); };
    try { web_eval(expr); }
    catch (e) { appendLine("err", "(de evaluatie is afgebroken)"); }
    printSink = null;
    updateStats();
  }

  function renderExample(id, source) {
    var ex = EXAMPLES[id];
    topbarTitle.textContent = ex.title;
    topbarBlurb.textContent = ex.blurb;
    readmeViewEl.style.display = "none";
    exampleViewEl.style.display = "flex";

    programEl.value = source;
    chipsEl.innerHTML = "";
    ex.chips.forEach(function (c) {
      var b = document.createElement("button");
      b.className = "chip"; b.type = "button"; b.textContent = c.label;
      b.addEventListener("click", function () { exprEl.value = c.expr; doRun(c.expr); });
      chipsEl.appendChild(b);
    });
    exprEl.value = ex.chips.length ? ex.chips[0].expr : "";
    clearConsole();
    doLoad(false);
    if (ex.chips.length) doRun(ex.chips[0].expr);
  }

  function selectFile(id) {
    currentId = id;
    Array.prototype.forEach.call(filelistEl.querySelectorAll(".file-item"), function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-id") === id);
    });
    if (id === "readme") {
      topbarTitle.textContent = "README.md";
      topbarBlurb.textContent = "start hier";
      readmeViewEl.style.display = "";
      exampleViewEl.style.display = "none";
      return;
    }
    if (!ready) return;
    var ex = EXAMPLES[id];
    if (sourceCache[id]) { renderExample(id, sourceCache[id]); return; }
    exampleViewEl.style.display = "flex";
    readmeViewEl.style.display = "none";
    topbarTitle.textContent = ex.title;
    topbarBlurb.textContent = "laden…";
    fetch(ex.file)
      .then(function (r) { return r.text(); })
      .then(function (src) { sourceCache[id] = src; renderExample(id, src); })
      .catch(function () { topbarBlurb.textContent = "kon " + ex.file + " niet laden"; });
  }

  Array.prototype.forEach.call(filelistEl.querySelectorAll(".file-item"), function (btn) {
    btn.addEventListener("click", function () { selectFile(btn.getAttribute("data-id")); });
  });
  loadBtn.addEventListener("click", function () { doLoad(true); });
  runBtn.addEventListener("click", function () { doRun(exprEl.value.trim()); });
  exprEl.addEventListener("keydown", function (e) { if (e.key === "Enter") doRun(exprEl.value.trim()); });

  SaplModule({
    print: function (text) { if (printSink) printSink(text); },
    printErr: function (text) { if (printSink) printSink(text); },
    noExitRuntime: true
  }).then(function (M) {
    web_init  = M.cwrap("web_init", null, []);
    web_load  = M.cwrap("web_load", null, ["string"]);
    web_eval  = M.cwrap("web_eval", null, ["string"]);
    web_stats = M.cwrap("web_stats", "string", []);
    web_init();
    ready = true;
    if (currentId !== "readme") selectFile(currentId);
  }).catch(function (e) {
    appendLine("err", "kon de reductor niet initialiseren: " + (e && e.message ? e.message : e));
  });
})();
