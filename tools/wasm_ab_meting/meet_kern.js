// websapl/tools/wasm_ab_meting/meet_kern.js -- warme A/B-meting van twee
// VM-wasms (zie README.md hier). Gedeeld door meet_node.js en meet.html.
//
// Eerst opwarmen (de opwarmrun van warmUpEngine in worker.js, dan elk
// programma drie keer, dan wachten), daarna afwisselend A en B, elke run in
// een vers exemplaar. Met `module` (een gecompileerde WebAssembly.Module)
// maken alle exemplaren van een variant die ene module aan, zodat ze dezelfde
// geoptimaliseerde code gebruiken; zonder compileert elk exemplaar zelf (zoals
// de worker, met `wasmBinary`).
//   varianten: [{naam, create, wasmBinary, module?}]
//   progs:     [{naam, jvb (Uint8Array)}]
const BENCHMARKS = ["fib", "primes", "queens", "twice", "knights", "match", "sprimes",
                    "eval", "eval2", "hamming", "sort", "parsetest", "prolog"];

// De opwarmrun van de worker (WARMUP_JVB in websapl/engine/worker.js), uit de
// tekst van worker.js gehaald zodat hij niet uit de pas loopt.
function opwarmJvb(workerTekst, vanBase64) {
  const m = /const WARMUP_JVB = "([^"]+)";/.exec(workerTekst);
  if (!m) throw new Error("WARMUP_JVB niet gevonden in worker.js");
  return vanBase64(m[1]);
}

async function meetAB(varianten, progs, warmJvb, rondes, log) {
  async function draai(v, jvb) {
    const uit = [];
    const opties = v.module
      ? { instantiateWasm: (imp, klaar) => { WebAssembly.instantiate(v.module, imp).then((i) => klaar(i, v.module)); return {}; } }
      : { wasmBinary: v.wasmBinary };
    const m = await v.create({ noInitialRun: true, ...opties,
      print: (s) => uit.push(s), printErr: () => {}, stdin: () => null });
    m.FS.writeFile("/tmp/p.jvb", jvb);
    const t0 = performance.now();
    try { m.callMain(["/tmp/p.jvb"]); } catch (_) {}
    const ms = performance.now() - t0;
    // res: de regel met res:, anders de hele uitvoer zonder tijden.
    const res = uit.find((l) => /^res:/.test(l)) || ("uitvoer:" + uit.filter((l) => !/Elapsed|time|secs/i.test(l)).join("|"));
    return { ms, res };
  }
  const koud = {}, tijden = {}, res = {};
  // Koud: de eerste run van het eerste programma, vóór het opwarmen (ter info).
  for (const v of varianten) {
    koud[v.naam] = {};
    for (const p of progs.slice(0, 1)) koud[v.naam][p.naam] = (await draai(v, p.jvb)).ms;
  }
  // Opwarmen: de opwarmrun van de worker, en elk programma drie keer.
  // Daarna wachten: V8 compileert de geoptimaliseerde code (TurboFan) op de
  // achtergrond en gebruikt die pas bij een volgende aanroep.
  const slaap = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const v of varianten) {
    await draai(v, warmJvb);
    for (let k = 0; k < 3; k++) { for (const p of progs) await draai(v, p.jvb); await slaap(500); }
  }
  await slaap(1000);
  for (const v of varianten) { tijden[v.naam] = {}; res[v.naam] = {}; for (const p of progs) tijden[v.naam][p.naam] = []; }
  for (let r = 0; r < rondes; r++) {
    for (const p of progs) {
      const volg = r % 2 ? [...varianten].reverse() : varianten;
      for (const v of volg) {
        const x = await draai(v, p.jvb);
        tijden[v.naam][p.naam].push(x.ms);
        res[v.naam][p.naam] = x.res;
      }
    }
    log(`ronde ${r + 1}/${rondes} klaar`);
  }
  // De losse tijden (ms), om een tweetoppige verdeling te zien.
  log(JSON.stringify(Object.fromEntries(Object.entries(tijden).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([p, t]) => [p, t.map(Math.round)]))]))));
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const min = (a) => Math.min(...a);
  const [A, B] = varianten.map((v) => v.naam);
  const regels = [`benchmark      ${A} min   ${B} min   ${A} med   ${B} med    min Δ    med Δ  res gelijk`];
  for (const p of progs) {
    const a = tijden[A][p.naam], b = tijden[B][p.naam];
    const pct = (x, y) => ((y / x - 1) * 100).toFixed(1).padStart(6) + "%";
    regels.push(`${p.naam.padEnd(12)} ${min(a).toFixed(0).padStart(8)} ${min(b).toFixed(0).padStart(9)} ${med(a).toFixed(0).padStart(9)} ${med(b).toFixed(0).padStart(9)}  ${pct(min(a), min(b))}  ${pct(med(a), med(b))}  ${res[A][p.naam] === res[B][p.naam] && res[A][p.naam] !== "uitvoer:" ? "ja" : "NEE " + res[A][p.naam] + " / " + res[B][p.naam]}`);
  }
  regels.push(`koud (eerste run van ${progs[0].naam}): ${varianten.map((v) => `${v.naam} ${koud[v.naam][progs[0].naam].toFixed(0)} ms`).join(", ")}`);
  return regels.join("\n");
}
if (typeof module !== "undefined") module.exports = { meetAB, opwarmJvb, BENCHMARKS };
