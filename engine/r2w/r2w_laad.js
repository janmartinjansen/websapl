// r2w_laad.js -- runtime (rt_wasm.c via emcc) + programma (sapl_naar_wasm.py) samen laden en
// draaien; voor node en de browser (proef retag2wasm, 20 nov 2026, README.md hier).
//
//   const { maakRuntime, draaiR2w } = require("./r2w_laad.js")
//   rt = await maakRuntime(maak_rt, rtModule)          // één keer: de gecompileerde runtime
//   x = await draaiR2w(rt, progModule, meta, io)       // elke run een vers exemplaar van beide
//
// De runtime krijgt per run een vers exemplaar (vers geheugen); het programma importeert
// zijn geheugen, functietabel en rt_*-functies. Vóór het instantiëren: de tabel groeit met
// meta.table plaatsen (tbase), en malloc reserveert meta.data bytes (dbase).
// De voortzettingsvorm (R2W_CPS, *.k.wasm) houdt de aanroepstack in het geheugen van de module;
// boven de grens env.kspl roept het programma env.kover aan, en dat gooit deze fout.
class EigenStackVol extends Error {}

async function draaiR2w(rt, progModule, meta, io = null) {
  const uit = [], fouten = [];
  const invoer = io ? new TextEncoder().encode(io.stdin) : new Uint8Array(0);
  let ip = 0, inst = null;
  const t0 = performance.now();
  const m = await rt.create({
    noInitialRun: true,
    instantiateWasm: (imp, klaar) => { WebAssembly.instantiate(rt.module, imp).then((i) => { inst = i; klaar(i, rt.module); }); return {}; },
    print: (s) => uit.push(s), printErr: (s) => fouten.push(s),
    stdin: () => (ip < invoer.length ? invoer[ip++] : null),
  });
  const ex = inst.exports;
  const table = ex.__indirect_function_table;
  const tbase = table.length;
  table.grow(meta.table);
  const dbase = ex.malloc(meta.data + 16);
  const g = (v, t = "i32") => new WebAssembly.Global({ value: t }, v);
  const contab = ex.rt_contab();
  const rtImp = {};
  for (const k of Object.keys(ex)) if (k.startsWith("rt_")) rtImp[k] = ex[k];
  // R2W_TEL=1 (node): tel de aanroepen per runtimefunctie (via een JS-omhulsel: traag, alleen om te tellen)
  const tel = typeof process !== "undefined" && process.env && process.env.R2W_TEL ? {} : null;
  if (tel) for (const k of Object.keys(rtImp)) { const f = rtImp[k]; tel[k] = 0; rtImp[k] = (...a) => { tel[k]++; return f(...a); }; }
  // proef stacksegmenten (meta.seg): seg.call schort de huidige stack op en draait het doel
  // via de promising export run_seg op een verse stack
  let runSeg = null, nSeg = 0;
  const segImp = meta.seg ? { call: new WebAssembly.Suspending(async (...a) => { nSeg++; return await runSeg(...a); }) } : undefined;
  const p = await WebAssembly.instantiate(progModule, {
    ...(segImp ? { seg: segImp } : {}),
    rt: rtImp,
    env: { memory: ex.memory, table, tbase: g(tbase), dbase: g(dbase), hendp: g(ex.rt_hend_addr()),
           contab: g(contab), contab64: g(BigInt(contab | 1), "i64"), caftab: g(ex.rt_caftab()),
           kspl: g(ex.rt_stack_lim ? ex.rt_stack_lim() : 0),
           kover: () => { throw new EigenStackVol("the program's own stack is full"); } },
  });
  if (meta.seg) runSeg = WebAssembly.promising(p.exports.run_seg);
  if (typeof process !== "undefined" && process.env && process.env.R2W_TOON) console.error(JSON.stringify({ tbase, dbase, hendp: ex.rt_hend_addr(), contab, caftab: ex.rt_caftab() }));
  p.exports.init();
  if (io) for (const [pad, b] of Object.entries(io.bestanden || {})) { const d = pad.slice(0, pad.lastIndexOf("/")); if (d) m.FS.mkdirTree(d); m.FS.writeFile(pad, b); }
  const t1 = performance.now();
  // fout: de melding; foutSoort: de naam van wat er gegooid werd (RangeError, InternalError, ...),
  // om een stack-overflow te herkennen zonder op de tekst te gokken
  let fout = null, foutSoort = null;
  const vang = (e) => { fout = String(e && e.message || e); foutSoort = (e && e.constructor && e.constructor.name) || typeof e; };
  // R2W_JSPI=1 (of io.jspi): main op een eigen stack via WebAssembly.promising (proef)
  const jspi = meta.seg || (io && io.jspi) || (typeof process !== "undefined" && process.env && process.env.R2W_JSPI === "1");
  if (jspi) {
    try { await WebAssembly.promising(ex.main)(0, 0); }
    catch (e) { if (!(e && e.name === "ExitStatus")) vang(e); }
  } else {
    try { m.callMain([]); } catch (e) { vang(e); }
  }
  const t2 = performance.now();
  let uitBestand = null;
  if (io && io.uitPad) { try { uitBestand = m.FS.readFile(io.uitPad); } catch (_) {} }
  if (tel) console.error(JSON.stringify(Object.fromEntries(Object.entries(tel).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]))));
  return { nSeg, ms: t2 - t1, totaal: t2 - t0, uit, fouten, fout, foutSoort, uitBestand, geheugen: ex.memory.buffer.byteLength };
}

// Was de fout van draaiR2w een stack-overflow van de engine (niet een eigen fout van de
// runtime)? V8 en JavaScriptCore gooien een RangeError, SpiderMonkey een InternalError.
// de eigen stack van de voortzettingsvorm vol (zie EigenStackVol)
draaiR2w.isOwnStackFull = function (x) { return x.foutSoort === "EigenStackVol"; };

draaiR2w.isStackOverflow = function (x) {
  if (!x.fout) return false;
  if (x.foutSoort === "RangeError") return /call stack|stack size|too much recursion/i.test(x.fout);
  if (x.foutSoort === "InternalError") return /recursion/i.test(x.fout);
  return false;
};

if (typeof module !== "undefined") module.exports = { draaiR2w };
