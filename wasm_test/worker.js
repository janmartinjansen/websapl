// worker.js -- één meting per worker: een programma koud en daarna warm draaien,
// ofwel met de interpreter (WebSapl's Emscripten-engine ../engine/jmvm.wasm met
// een .jmvm), ofwel als gecompileerde wasm (build/<naam>.<variant>.wasm, gemaakt
// door wasm_compiler/build_websapl_test.sh). De pagina start voor elke meting
// een nieuwe worker en beëindigt hem daarna, zodat het geheugen vrijkomt.
//
// Koud/warm: de wasm-bytes krijgen een willekeurige custom section ("nonce"),
// zodat de engine geen eerder gecompileerde of geoptimaliseerde code kan
// hergebruiken. Warm = een tweede instantie van hetzelfde WebAssembly.Module,
// direct na de koude run.
importScripts('host.js', '../engine/jmvm.js');

function withNonce(bytes) {
  const name = [110, 111, 110, 99, 101];          // "nonce"
  const payload = crypto.getRandomValues(new Uint8Array(8));
  const body = [name.length, ...name, ...payload];
  const out = new Uint8Array(bytes.length + 2 + body.length);
  out.set(bytes);
  out.set([0, body.length, ...body], bytes.length);   // custom section id 0, lengte < 128
  return out;
}

const fnv = b => { let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193) >>> 0; return h.toString(16).padStart(8, '0'); };
const norm = s => s.replace(/\s+/g, ' ').trim();
const fetchBytes = async url => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return new Uint8Array(await r.arrayBuffer()); };
const ms = t => Math.round(t * 10) / 10;

// vm.cpp print de uitvoer tussen "execution started, progsize=N" en "stop"
function engineOutput(txt) {
  const a = txt.indexOf('execution started');
  const b = txt.lastIndexOf('\nstop');
  if (a < 0) return txt;
  const start = txt.indexOf('\n', a) + 1;
  return txt.slice(start, b < 0 ? undefined : b);
}

async function runEngine(job) {
  const engineBytes = withNonce(await fetchBytes('../engine/jmvm.wasm'));
  const prog = await fetchBytes(job.jmvm);
  const input = job.gen1 ? await fetchBytes(job.gen1.invoer) : null;
  const t0 = performance.now();
  const mod = await WebAssembly.compile(engineBytes);
  const compileMs = performance.now() - t0;
  const runs = [];
  for (let r = 0; r < 2; r++) {
    const stdin = job.gen1 ? '/in.cfp\n/out.jmvm\njmvm\n' : '';
    let i = 0; const out = [];
    let m = await createJMVMModule({
      noInitialRun: true,
      instantiateWasm: (imports, cb) => { WebAssembly.instantiate(mod, imports).then(inst => cb(inst, mod)); return {}; },
      stdin: () => (i < stdin.length ? stdin.charCodeAt(i++) : null),
      stdout: c => out.push(c), stderr: c => out.push(c),
      print: () => {}, printErr: () => {},
    });
    m.FS.writeFile('/prog.jmvm', prog);
    if (input) m.FS.writeFile('/in.cfp', input);
    const t = performance.now();
    try { m.callMain(['/prog.jmvm']); } catch (e) { if (!(e && (e.name === 'ExitStatus' || /exit/i.test(String(e))))) throw e; }
    const runMs = performance.now() - t;
    let ok, info;
    if (job.gen1) {
      const o = m.FS.analyzePath('/out.jmvm').exists ? m.FS.readFile('/out.jmvm') : new Uint8Array(0);
      ok = o.length === job.gen1.lengte && fnv(o) === job.gen1.fnv;
      info = o.length + ' bytes, fnv ' + fnv(o);
    } else {
      const txt = new TextDecoder('latin1').decode(new Uint8Array(out));
      ok = norm(engineOutput(txt)) === norm(job.verwacht);
      info = norm(engineOutput(txt)).slice(0, 120);
    }
    runs.push({ ms: ms(runMs), ok, info });
    m = null;                                         // koude instantie loslaten vóór de warme
  }
  return { compileMs: ms(compileMs), runs };
}

async function runCompiled(job) {
  const bytes = withNonce(await fetchBytes(job.wasm));
  const input = job.gen1 ? await fetchBytes(job.gen1.invoer) : null;
  let mem;
  try { mem = new WebAssembly.Memory({ initial: job.pages }); }
  catch (e) { throw new Error('geheugen van ' + Math.round(job.pages * 64 / 1024) + ' MB niet beschikbaar: ' + e.message); }
  const t0 = performance.now();
  const mod = await WebAssembly.compile(bytes);
  const compileMs = performance.now() - t0;
  const runs = [];
  for (let r = 0; r < 2; r++) {
    const files = {}; if (input) files['/in.cfp'] = input;
    let out = '';
    const host = makeHost({
      readFile: p => files[p] || null,
      writeFile: (p, b) => { files[p] = new Uint8Array(b); return true; },
      readStdin: () => new TextEncoder().encode(job.gen1 ? '/in.cfp\n/out.jmvm\njmvm\n' : ''),
      write: s => { out += s; },
    });
    const inst = await WebAssembly.instantiate(mod, { env: Object.assign({ mem }, host.env) });
    host.attach(inst);
    const t = performance.now();
    inst.exports.run();
    host.finish();
    const runMs = performance.now() - t;
    let ok, info;
    if (job.gen1) {
      const o = files['/out.jmvm'] || new Uint8Array(0);
      ok = o.length === job.gen1.lengte && fnv(o) === job.gen1.fnv;
      info = o.length + ' bytes, fnv ' + fnv(o);
    } else {
      ok = norm(out) === norm(job.verwacht);
      info = norm(out).slice(0, 120);
    }
    const e = inst.exports;
    runs.push({ ms: ms(runMs), ok, info, tellers: e.calls.value + '/' + e.creates.value + '/' + e.ngc.value });
  }
  return { compileMs: ms(compileMs), runs };
}

onmessage = async ({ data: job }) => {
  try {
    const res = job.soort === 'interpreter' ? await runEngine(job) : await runCompiled(job);
    postMessage({ ok: true, res });
  } catch (e) {
    postMessage({ ok: false, fout: String(e && e.message || e) });
  }
};
