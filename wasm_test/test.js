// test.js -- de testbank-pagina: per programma vier metingen (interpreter/compiler,
// elk koud en warm), elk paar in een eigen worker (worker.js). URL-parameters:
//   ?auto=1                 alles meteen draaien (voor headless tests)
//   ?alleen=primes,gen1     alleen deze programma's
//   ?variant=tail|driver    ?geheugen=groot|klein
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let manifest, stopped = false, results = {};

// tail calls: kan de engine een module met return_call valideren?
const tailCallModule = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 6, 1, 4, 0, 18, 0, 11]);
const hasTailCalls = (() => { try { return WebAssembly.validate(tailCallModule); } catch (e) { return false; } })();

function env() {
  const d = {
    'Browser': navigator.userAgent,
    'Platform': (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '?',
    'Kernen': navigator.hardwareConcurrency || '?',
    'Geheugen (deviceMemory)': navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'onbekend',
    'Tail calls': hasTailCalls ? 'ja' : 'nee (driverlus wordt gebruikt)',
    'Build': manifest ? manifest.gebouwd + ', commit ' + manifest.commit : '?',
  };
  $('env').innerHTML = Object.entries(d).map(([k, v]) => `<dt>${k}</dt><dd>${String(v).replace(/</g, '&lt;')}</dd>`).join('');
  return d;
}

const variantNaam = () => {
  const v = $('variant').value === 'auto' ? (hasTailCalls ? 'tail' : 'driver') : $('variant').value;
  return v + '_' + $('geheugen').value;
};

function programmas() {
  const all = manifest.benchmarks.map(b => b.naam).concat(['gen1']);
  const only = params.get('alleen');
  return only ? all.filter(n => only.split(',').includes(n)) : all;
}

function job(naam, soort) {
  const v = variantNaam();
  const j = { soort, naam };
  if (naam === 'gen1') {
    j.gen1 = { invoer: 'build/' + manifest.gen1.invoer, lengte: manifest.gen1.lengte, fnv: manifest.gen1.fnv };
    j.jmvm = '../engine/saplcomp.jmvm';
  } else {
    j.jmvm = 'build/' + naam + '.jmvm';
    j.verwacht = manifest.benchmarks.find(b => b.naam === naam).verwacht;
  }
  j.wasm = 'build/' + naam + '.' + v + '.wasm';
  j.pages = manifest.varianten[v].pages;
  j.variant = v;
  return j;
}

function inWorker(j) {
  return new Promise(resolve => {
    const w = new Worker('worker.js');
    w.onmessage = e => { w.terminate(); resolve(e.data); };
    w.onerror = e => { w.terminate(); resolve({ ok: false, fout: e.message || 'worker-fout' }); };
    w.postMessage(j);
  });
}

const fmt = x => (x == null ? '' : x >= 100 ? String(Math.round(x)) : x.toFixed(1));
const factor = (a, b) => (a && b ? (a / b).toFixed(2) + '×' : '');

function renderRow(naam) {
  const r = results[naam] || {};
  const tr = $('row-' + naam);
  const i = r.interpreter, c = r.compiler;
  const cell = (x, k) => x && x.ok ? fmt(x.res.runs[k].ms) : x && !x.ok ? '<span class="bad" title="' + x.fout.replace(/"/g, '&quot;') + '">fout</span>' : '';
  const ik = i && i.ok ? i.res.runs[0].ms : null, iw = i && i.ok ? i.res.runs[1].ms : null;
  const ck = c && c.ok ? c.res.runs[0].ms : null, cw = c && c.ok ? c.res.runs[1].ms : null;
  let correct = '';
  if ((i && i.ok) || (c && c.ok)) {
    const all = [].concat(i && i.ok ? i.res.runs : [], c && c.ok ? c.res.runs : []);
    correct = all.every(x => x.ok) ? '<span class="ok">ja</span>' : '<span class="bad">NEE</span>';
  }
  if ((i && !i.ok) || (c && !c.ok)) correct += ' <span class="bad">fout</span>';
  tr.innerHTML = `<td>${naam}</td><td>${cell(i, 0)}</td><td>${cell(i, 1)}</td><td>${cell(c, 0)}</td><td>${cell(c, 1)}</td>` +
    `<td class="factor">${factor(ik, ck)}</td><td class="factor">${factor(iw, cw)}</td><td>${correct}</td>` +
    `<td><button data-naam="${naam}">▶</button></td>`;
  tr.querySelector('button').onclick = () => runAll([naam]);
}

function report() {
  const e = env();
  const lines = ['WASM-compiler testbank, ' + new Date().toISOString()];
  for (const [k, v] of Object.entries(e)) lines.push(k + ': ' + v);
  lines.push('Variant: ' + variantNaam(), '');
  lines.push(['programma', 'interp_koud', 'interp_warm', 'comp_koud', 'comp_warm', 'factor_koud', 'factor_warm', 'correct', 'opmerking'].join('\t'));
  for (const naam of programmas()) {
    const r = results[naam]; if (!r) continue;
    const i = r.interpreter, c = r.compiler;
    const g = (x, k) => (x && x.ok ? x.res.runs[k].ms : '');
    const all = [].concat(i && i.ok ? i.res.runs : [], c && c.ok ? c.res.runs : []);
    const fouten = [i && !i.ok ? 'interpreter: ' + i.fout : '', c && !c.ok ? 'compiler: ' + c.fout : ''].filter(Boolean).join('; ');
    lines.push([naam, g(i, 0), g(i, 1), g(c, 0), g(c, 1), factor(g(i, 0), g(c, 0)), factor(g(i, 1), g(c, 1)),
                all.length && all.every(x => x.ok) ? 'ja' : 'NEE', fouten].join('\t'));
  }
  $('uitvoer').value = lines.join('\n');
  return lines.join('\n');
}

async function runAll(namen) {
  stopped = false;
  $('alles').disabled = true; $('stop').disabled = false;
  for (const naam of namen) {
    if (stopped) break;
    results[naam] = {};
    const tr = $('row-' + naam); tr.className = 'running';
    for (const soort of ['interpreter', 'compiler']) {
      if (stopped) break;
      $('status').textContent = naam + ': ' + soort + '…';
      renderRow(naam);
      results[naam][soort] = await inWorker(job(naam, soort));
      renderRow(naam);
      console.log('PROEF ' + naam + ' ' + soort + ' ' + JSON.stringify(results[naam][soort]));
    }
    tr.className = '';
    report();
  }
  $('status').textContent = stopped ? 'gestopt' : 'klaar';
  $('alles').disabled = false; $('stop').disabled = true;
  const txt = report();
  console.log('PROEF RAPPORT ' + JSON.stringify(txt));
  console.log('PROEF KLAAR');
}

$('alles').onclick = () => runAll(programmas());
$('stop').onclick = () => { stopped = true; $('status').textContent = 'stopt na deze meting…'; };
$('kopieer').onclick = async () => {
  const txt = report();
  try { await navigator.clipboard.writeText(txt); $('kopieerstatus').textContent = 'gekopieerd'; }
  catch (e) { $('uitvoer').focus(); $('uitvoer').select(); $('kopieerstatus').textContent = 'geselecteerd: kopieer met de hand (klembord niet beschikbaar op http)'; }
};
$('variant').onchange = $('geheugen').onchange = () => report();

(async () => {
  try {
    manifest = await (await fetch('build/manifest.json', { cache: 'no-store' })).json();
  } catch (e) {
    $('status').textContent = 'build/manifest.json niet gevonden: draai eerst bash wasm_compiler/build_websapl_test.sh';
    return;
  }
  if (params.get('variant')) $('variant').value = params.get('variant');
  if (params.get('geheugen')) $('geheugen').value = params.get('geheugen');
  env();
  $('rows').innerHTML = programmas().map(n => `<tr id="row-${n}"></tr>`).join('');
  programmas().forEach(renderRow);
  report();
  if (params.get('auto')) runAll(programmas());
})();
