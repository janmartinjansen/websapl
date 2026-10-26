// Zorgt dat benchmarks/<naam>.jvb er is en bij zijn .jmvm hoort: de .jvb's van
// de benchmarks staan niet in git (de native VM maakt ze bij het laden). Via
// ./jmvm2jvb (make jmvm2jvb), vanuit de repo-root.
const fs = require("fs");
const { spawnSync } = require("child_process");
function zorgVoorJvb(namen) {
  for (const n of namen) {
    const jmvm = `benchmarks/${n}.jmvm`, jvb = `benchmarks/${n}.jvb`;
    if (fs.existsSync(jvb) && fs.statSync(jvb).mtimeMs >= fs.statSync(jmvm).mtimeMs) continue;
    if (!fs.existsSync("jmvm2jvb")) spawnSync("make", ["-s", "jmvm2jvb"], { stdio: "inherit" });
    const r = spawnSync("./jmvm2jvb", [jmvm], { encoding: "utf8" });
    if (r.status !== 0 || !fs.existsSync(jvb)) throw new Error(`./jmvm2jvb ${jmvm} faalde:\n${r.stdout}${r.stderr}`);
  }
}
module.exports = { zorgVoorJvb };
