// Experiment: helpt een korte opwarmrun van de interpreter-engine de eerste
// zware run in een sessie? Laadt de engine zoals websapl/engine/worker.js
// (locateFile -> gestreamd), zonder nonce: elk scenario draait in een verse browser.
importScripts('../../engine/jmvm.js');
const fetchBytes = async u => new Uint8Array(await (await fetch(u, { cache: 'no-store' })).arrayBuffer());
async function run(prog, stdin = '', files = {}) {
  let i = 0;
  const m = await createJMVMModule({
    noInitialRun: true,
    locateFile: (p, prefix) => (p.endsWith('.wasm') ? '../../engine/jmvm.wasm' : (prefix || '') + p),
    stdin: () => (i < stdin.length ? stdin.charCodeAt(i++) : null), stdout: () => {}, stderr: () => {},
  });
  m.FS.writeFile('/p.jmvm', prog);
  for (const [k, v] of Object.entries(files)) m.FS.writeFile(k, v);
  const t = performance.now();
  try { m.callMain(['/p.jmvm']); } catch (e) {}
  return Math.round(performance.now() - t);
}
onmessage = async ({ data: { opwarm, wacht, doel } }) => {
  const log = [];
  const t0 = performance.now();
  if (opwarm) log.push('opwarm ' + opwarm + ': ' + await run(await fetchBytes(opwarm + '.jmvm')) + ' ms');
  if (wacht) { await new Promise(r => setTimeout(r, wacht)); log.push('wacht ' + wacht + ' ms'); }
  const opwarmTotaal = Math.round(performance.now() - t0);
  let prog, stdin = '', files = {};
  if (doel === 'gen1') {
    prog = await fetchBytes('../../engine/saplcomp.jmvm');
    files['/in.cfp'] = await fetchBytes('../build/gen1_input.cfp'); stdin = '/in.cfp\n/out.jmvm\njmvm\n';
  } else prog = await fetchBytes('../build/' + doel + '.jmvm');
  const t1 = await run(prog, stdin, files), t2 = await run(prog, stdin, files);
  postMessage(log.join(', ') + (log.length ? ' (samen ' + opwarmTotaal + ' ms) | ' : '') + doel + ' eerste ' + t1 + ' ms, tweede ' + t2 + ' ms');
};
