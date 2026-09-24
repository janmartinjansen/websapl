// Pure transcript-parser voor lc_repl.jmvm-uitvoer, los van de UI zodat hij
// in Node te testen is (zie README.md, "Testen"). Gebruikt door driver.js.
//
// Eén run = stdin met eerst `nReplay` opnieuw afgespeelde bindingregels,
// dan `nNew` nieuwe regels, dan "quit". lc_repl print vóór elke regel zijn
// prompt "lc> ", dus de uitvoer na het opstartbericht valt uiteen in
// nReplay + nNew + 1 stukken (het laatste is "Tot ziens!"). Stopt de VM
// eerder (Sapl `error`: onbekende variabele, onbekend :commando, ...), dan
// is het LAATSTE stuk de foutmelding van de regel waar het misging.
(function (root) {
  "use strict";

  function stripRunner(raw) {
    var text = raw || "";
    var start = /execution started, progsize=\d+\r?\n/.exec(text);
    if (start) text = text.slice(start.index + start[0].length);
    // Normaal: "...Tot ziens!\nres: 0\nstop\nElapsed time: ...". Na een
    // `error`: "...<melding>stop\nElapsed time: ..." (geen res:-regel, en
    // geen newline vóór "stop"). Verankerd op "Elapsed time:" na "stop",
    // anders kapt een binding als "nonstop = ..." ("gedefinieerd: nonstop\n")
    // het transcript midden in de uitvoer af.
    return text.replace(/(\r?\n)?(res: [^\n]*\r?\n)?stop\r?\nElapsed time:[\s\S]*$/, "");
  }

  // Resultaat:
  //   banner     -- het opstartbericht van lc_repl
  //   replayed   -- uitvoer per opnieuw afgespeelde regel (normaal "gedefinieerd: x")
  //   outputs    -- uitvoer per nieuwe regel die normaal afliep
  //   failedAt   -- -1, of de index (0-based, over replay+nieuw samen) van
  //                 de regel waarop de VM stopte
  //   errorText  -- de uitvoer van die regel (de foutmelding)
  function parseTranscript(raw, nReplay, nNew) {
    var text = stripRunner(raw);
    var parts = text.split("lc> ");
    var banner = parts[0];
    var rest = parts.slice(1);
    var total = nReplay + nNew;
    var completed = rest.length === total + 1 && /^Tot ziens!/.test(rest[total]);
    var result = { banner: banner, replayed: [], outputs: [], failedAt: -1, errorText: "" };

    var nDone = completed ? total : Math.max(rest.length - 1, 0);
    for (var i = 0; i < nDone; i++) {
      if (i < nReplay) result.replayed.push(rest[i]);
      else result.outputs.push(rest[i]);
    }
    if (!completed) {
      result.failedAt = rest.length === 0 ? 0 : rest.length - 1;
      result.errorText = rest.length === 0 ? text : rest[rest.length - 1];
    }
    return result;
  }

  root.lcParseTranscript = parseTranscript;
  if (typeof module !== "undefined" && module.exports) module.exports = { parseTranscript: parseTranscript };
})(typeof self !== "undefined" ? self : this);
