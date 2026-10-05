// Regressietest voor het modulegewijs bouwen in WebSapl (worker.js's
// BUILD_MODULES, de JS-versie van sapl_compiler/tools/build_modules.py),
// in Node zonder browser. Bouwt een paar kleine manifesten, draait het
// resultaat en vergelijkt `res:`.
//
//   node websapl/tools/modules_test.js            (vanuit de repo-root)
const fs = require("fs");
const path = require("path");
const { call, init, repo } = require("./worker_harness.js");

const read = (p) => fs.readFileSync(path.join(repo, p), "utf8");

const cases = [
  {
    // docs/2026-09-13_modules_compileren_en_linken_gebruik.md, voorbeeld 1.
    name: "voorbeeld 1 (functies, dode code)",
    manifest: "module_a.cfp:\nmodule_b.cfp: module_a.cfp\n",
    entry: "module_b.cfp",
    sources: {
      "module_a.cfp": "double x = x + x\ntriple x = x + x + x\nunused_helper x = x * 999\n",
      "module_b.cfp": "combo n = double n + triple n\nstart = combo 5\n",
    },
    res: "25",
  },
  {
    // Een naam zonder argumenten uit een andere module (hier een CAF):
    // de defs van hoofd.cfp moeten tegen die van tabel.cfp gemaakt worden,
    // los gaf dat "findArgStrict: unknown variable" (5 oktober 2026).
    name: "caf/modules (CAF over de modulegrens)",
    manifest: read("caf/modules/manifest.txt"),
    entry: "hoofd.cfp",
    sources: { "tabel.cfp": read("caf/modules/tabel.cfp"), "hoofd.cfp": read("caf/modules/hoofd.cfp") },
    res: read("caf/modules/hoofd.cfp").match(/verwacht: *(\d+)/)[1],
    contains: "pushcaf",
  },
];

(async () => {
  await init();
  let fail = 0;
  for (const c of cases) {
    const b = await call({ type: "BUILD_MODULES", manifest: c.manifest, entryModule: c.entry, moduleSources: c.sources, outPath: "/tmp/mods/uit.jmvm" });
    if (!b.success) {
      fail = 1;
      console.log(`FOUT  ${c.name}: bouwen mislukt\n  ${String(b.error).split("\n").slice(0, 4).join("\n  ")}`);
      continue;
    }
    const content = b.files[0].content;
    const r = await call({ type: "RUN", contentOrPath: content, isPath: false });
    const res = String(r.metrics && r.metrics.res);
    const okRes = res === c.res;
    const okContains = !c.contains || content.includes(c.contains);
    if (okRes && okContains) console.log(`ok    ${c.name}: res ${res}`);
    else {
      fail = 1;
      console.log(`FOUT  ${c.name}: res ${res} (verwacht ${c.res})${okContains ? "" : `, geen ${c.contains}`}`);
    }
  }
  process.exit(fail);
})();
