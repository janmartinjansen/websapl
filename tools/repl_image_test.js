// Test van het blijvende beeld in de WebSapl-REPL (notebookplan §6.2,
// 6 oktober 2026), de tegenhanger van repl/tests/beeld_test.sh voor
// repl-host. Elke reeks draait met en zonder beeld (noImage); de uitvoer
// moet gelijk zijn, en het aantal aanroepen per regel laat zien of een
// CAF bewaard of opnieuw berekend werd.
//
//   node websapl/tools/repl_image_test.js     (vanuit de repo-root)
const { call, init } = require("./worker_harness.js");

async function session(lines, noImage) {
  await call({ type: "REPL_INIT" });
  await call({ type: "REPL_EVAL", cmd: "reset" });
  const out = [];
  for (const line of lines) {
    let r;
    if (line.startsWith(":def ")) r = await call({ type: "REPL_EVAL", cmd: "def", text: line.slice(5) });
    else if (line === ":undo" || line === ":reset") r = await call({ type: "REPL_EVAL", cmd: line.slice(1) });
    else r = await call({ type: "REPL_EVAL", cmd: "eval", line, noImage });
    out.push({ line, text: r.success ? String(r.output === undefined ? r.name || "" : r.output).split("\n")[0] : "fout: " + r.error.split("\n")[0], image: r.image });
  }
  return out;
}

(async () => {
  await init();
  let fail = 0;
  const check = (name, ok, info) => { console.log(`${ok ? "ok  " : "FOUT"}  ${name}${info ? ": " + info : ""}`); if (!ok) fail = 1; };
  const scenarios = {
    "CAF met it ertussen": [":def tel !a !n = if (n == 0) a (tel (a + n) (n - 1))", ":def big =: tel 0 1000000", "big", "it + 1", "big + 1", "it * 2"],
    "stap 4": [":def tel !a !n = if (n == 0) a (tel (a + n) (n - 1))", ":def big =: tel 0 1000000", "big", ":def f x = x + 1", ":def g =: f 5", "g", ":def f x = x * 10", "g", "big", ":def tel !a !n = if (n == 0) a (tel (a + n + 1) (n - 1))", "big"],
    "ingebouwde naam": [":def abs x y = x + y", "abs 1 2", "abs 3 4", ":def abs x y = x * y", "abs 2 3"],
    "herdefinitie na undo": [":def f x = x + 1", "f 1", "f 2", ":def f x = x * 10", "f 1", ":undo", "f 1", ":undo", ":def f x = x * 100", "f 1"],
    "ADT": [":def ::V = A x | B y", ":def vs =: [A 1, B 2, A 3]", "vs", ":def ::V = B y | A x | C", "vs", "[C, A 1]"],
  };
  const results = {};
  for (const [name, lines] of Object.entries(scenarios)) {
    const a = await session(lines, true);
    const b = await session(lines, false);
    results[name] = b;
    const same = JSON.stringify(a.map((x) => x.text)) === JSON.stringify(b.map((x) => x.text));
    const chunks = b.filter((x) => x.image && x.image.chunk).length;
    check(`${name}: gelijk met en zonder beeld`, same, same ? `${chunks} regel(s) als los stuk` : JSON.stringify(b.map((x) => x.text)));
  }
  const calls = (name) => results[name].filter((x) => x.image).map((x) => x.image.calls);
  const c1 = calls("CAF met it ertussen");
  check("CAF één keer berekend, ook met it ertussen", c1[0] > 1000000 && c1.slice(1).every((c) => c < 1000), c1.join(" "));
  const c2 = calls("stap 4");
  // big, g, g (na f opnieuw), big, big (na tel opnieuw)
  check("stap 4: big bewaard na f opnieuw, opnieuw berekend na tel opnieuw", c2.length === 5 && c2[0] > 1000000 && c2[3] < 1000 && c2[4] > 1000000, c2.join(" "));
  // Beslissing 5: resN is een momentopname (zie repl/tests/beeld_test.sh, 6).
  const texts = async (lines) => (await session(lines, false)).map((x) => x.text);
  const s1 = await texts([":def f x = x + 1", "f 10", ":def f x = x * 10", "res0", "f 10"]);
  check("momentopname: res0 blijft 11 na f opnieuw", s1[3] === "11" && s1[4] === "100", s1.join(" | "));
  const s2 = await texts([":def ::V = A x | B y", "[A 1]", ":def ::V = B y | A x | C", "res0", "[A 2]"]);
  check("verlopen momentopname gemeld na een gewijzigd type", /res0 is verlopen/.test(s2[3]) && s2[4] === "[A(2)]", s2.join(" | "));
  const s3 = await texts([":def f x = x + 1", "f 1", ":def f x = x * 10", "f 1", ":undo", ":undo", ":def f x = x * 100", "f 1", "res1"]);
  check("na :undo krijgt een hergebruikte resN de nieuwe waarde", s3[7] === "100" && s3[8] === "100", s3.join(" | "));
  process.exit(fail);
})();
