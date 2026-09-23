(function () {
  "use strict";

  // Er bestaat geen truly-interactive stdin-stream in deze WASM-opzet --
  // ../engine/worker.js's RUN-boodschap (dezelfde die studio.js voor de
  // "Run"-knop gebruikt) voert het HELE stdin-blok in één keer uit en geeft
  // pas na afloop de volledige uitvoer terug. Elke ingetypte regel voegt
  // zich dus toe aan `lines` en de HELE sessie draait opnieuw vanaf het
  // begin -- deterministisch (dezelfde regels geven altijd dezelfde
  // uitvoer), dus dat is correct, alleen niet incrementeel uitgevoerd.
  // lc_repl.jmvm's eigen readLine-lus geeft bij een uitgeputte stdin geen
  // nette EOF terug maar blijft leeg doorlezen (leidt tot een oneindige
  // "lc> "-lus) -- daarom sluit elke run altijd af met een expliciete
  // "quit"-regel, nooit aan de gebruiker overgelaten.

  var worker = new Worker("../engine/worker.js");
  var termEl = document.getElementById("terminal");
  var inputEl = document.getElementById("cmd-input");
  var runBtn = document.getElementById("run-btn");
  var resetBtn = document.getElementById("reset-btn");
  var statusEl = document.getElementById("status");
  var chipsEl = document.getElementById("chips");

  var ready = false;
  var busy = false;
  var jmvmText = null;
  var lines = [];
  var runCounter = 0;
  var pendingId = null;

  function setStatus(text) { statusEl.textContent = text; }

  function setBusy(v) {
    busy = v;
    inputEl.disabled = !ready || busy;
    runBtn.disabled = !ready || busy;
    Array.prototype.forEach.call(chipsEl.querySelectorAll(".chip"), function (c) {
      c.disabled = !ready || busy;
    });
  }

  // Strip de vaste VM-harnas-regels (opstartmelding vóór het programma,
  // res:/stop/Elapsed time/.../creates: erna) zodat de terminal er als een
  // gewone REPL-sessie uitziet -- als een van beide patronen niet wordt
  // gevonden (bv. de sessie eindigde met een onafgevangen `error`-aanroep,
  // vóór de normale afsluitstatistieken) blijft de tekst gewoon ongewijzigd
  // staan, zodat een echte foutmelding nooit per ongeluk verdwijnt.
  function stripFraming(raw) {
    var text = raw;
    var startMarker = /execution started, progsize=\d+\r?\n/;
    var m = startMarker.exec(text);
    if (m) text = text.slice(m.index + m[0].length);
    var endMarker = /\r?\nres: [^\n]*\r?\nstop\r?\n[\s\S]*$/;
    var m2 = endMarker.exec(text);
    if (m2) text = text.slice(0, m2.index);
    return text;
  }

  function renderTranscript(raw) {
    termEl.textContent = stripFraming(raw);
    termEl.scrollTop = termEl.scrollHeight;
  }

  function buildStdin() {
    var body = lines.join("\n");
    return (body.length ? body + "\n" : "") + "quit\n";
  }

  function runSession() {
    if (!ready) return;
    setBusy(true);
    setStatus("bezig…");
    var id = "run" + (++runCounter);
    pendingId = id;
    worker.postMessage({
      type: "RUN",
      contentOrPath: jmvmText,
      isPath: false,
      stdin: buildStdin(),
      id: id
    });
  }

  worker.onmessage = function (e) {
    var msg = e.data;
    if (msg.type === "INIT_DONE") {
      fetch("lc_repl.jmvm")
        .then(function (r) { return r.text(); })
        .then(function (text) {
          jmvmText = text;
          ready = true;
          setBusy(false);
          setStatus("klaar");
          runSession();
        })
        .catch(function () { setStatus("kon lc_repl.jmvm niet laden"); });
      return;
    }
    if (msg.type === "RUN_COMPLETE" && msg.id === pendingId) {
      renderTranscript(msg.output || "");
      setBusy(false);
      setStatus("klaar");
      inputEl.focus();
    }
  };

  worker.postMessage({ type: "INIT" });

  // Een chip kan meerdere regels tegelijk indienen (\n-gescheiden in
  // data-cmd) -- de "voer dit uit"-chips (":seval fact 6", ":seval
  // priemzeef") nemen zo hun eigen voorwaarden (Y/fact resp.
  // primes/add/Y/decodeAcc) mee, zodat ze ook werken als je ze als eerste
  // klikt, zonder eerst de losse definitie-chips te hebben aangeklikt --
  // anders krijg je precies lc_repl.cfp's eigen "onbekende of ongebonden
  // variabele"-foutmelding voor een naam die simpelweg nog niet bestond in
  // de sessie. Alle regels van één klik draaien in ÉÉN sessie-run, niet
  // apart per regel.
  function submitLines(text) {
    if (!ready || busy) return;
    var parts = (text || "").split("\n").filter(function (l) { return l.trim().length > 0; });
    if (!parts.length) return;
    parts.forEach(function (l) { lines.push(l); });
    runSession();
  }

  function submitFromInput() {
    var val = inputEl.value;
    inputEl.value = "";
    submitLines(val);
  }

  runBtn.addEventListener("click", submitFromInput);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") submitFromInput();
  });
  resetBtn.addEventListener("click", function () {
    if (busy) return;
    lines = [];
    runSession();
  });
  Array.prototype.forEach.call(chipsEl.querySelectorAll(".chip"), function (chip) {
    chip.addEventListener("click", function () { submitLines(chip.getAttribute("data-cmd")); });
  });
})();
