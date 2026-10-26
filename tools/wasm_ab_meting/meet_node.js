// Warme A/B-meting van twee VM-wasms in node (README.md hier).
//   node websapl/tools/wasm_ab_meting/meet_node.js <werkmap> [-n rondes] [--var a,b] [--los] [benchmark...]
// Vanuit de repo-root: de programma's zijn benchmarks/<naam>.jvb. Standaard
// --var main,proef, 7 rondes, alle 13 benchmarks. Met --los compileert elk
// exemplaar de wasm zelf. Meet daarnaast altijd in Chrome (meet_chrome.js):
// node tiert anders dan de browser.
const fs = require("fs"), path = require("path");
const { meetAB, opwarmJvb, BENCHMARKS } = require("./meet_kern.js");
const { zorgVoorJvb } = require("./jvb.js");

const args = process.argv.slice(2);
const werkmap = path.resolve(args.shift() || "");
let rondes = 7, varNamen = ["main", "proef"], los = false;
const namen = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-n") rondes = +args[++i];
  else if (args[i] === "--var") varNamen = args[++i].split(",");
  else if (args[i] === "--los") los = true;
  else namen.push(args[i]);
}
if (!fs.existsSync(werkmap) || varNamen.length !== 2) {
  console.error("gebruik: meet_node.js <werkmap> [-n rondes] [--var a,b] [--los] [benchmark...]");
  process.exit(2);
}
const varianten = varNamen.map((n) => {
  const d = path.join(werkmap, "wasm_" + n);
  const wasmBinary = fs.readFileSync(path.join(d, "jmvm.wasm"));
  return { naam: n, create: require(path.join(d, "jmvm.js")), wasmBinary, module: los ? null : new WebAssembly.Module(wasmBinary) };
});
const gekozen = namen.length ? namen : BENCHMARKS;
zorgVoorJvb(gekozen);
const progs = gekozen.map((n) => ({ naam: n, jvb: fs.readFileSync("benchmarks/" + n + ".jvb") }));
const warm = opwarmJvb(fs.readFileSync("websapl/engine/worker.js", "utf8"), (b) => Buffer.from(b, "base64"));
meetAB(varianten, progs, warm, rondes, (s) => console.error(s)).then((t) => console.log(`node ${process.version}${los ? ", --los" : ""}\n${t}`));
