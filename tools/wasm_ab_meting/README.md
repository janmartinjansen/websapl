# Warme A/B-meting van de VM-wasm (WebSapl)

De client is de belangrijkste doelgroep van Sapl. Meet een VM-wijziging
(dispatch, instructies, bodies) dus niet alleen native (`vm/tools/ab_meting.py`),
maar ook op de wasm van WebSapl, en dan **warm**. Native winst zegt niets over
wasm: native is de dispatch musttail (een functie per instructie), WebSapl
gebruikt de switch-vorm (één grote `runLoop`), en V8 compileert die heel
anders.

Waarom warm: V8 draait een wasm-functie eerst op de basiscompiler Liftoff en
optimaliseert hem (TurboFan) op de achtergrond. Een functie die al draait,
schakelt niet halverwege over. Eén lange, koude run meet dus de grote
`runLoop` op Liftoff, terwijl WebSapl hem na het opwarmen
(`warmUpEngine` in `websapl/engine/worker.js`) geoptimaliseerd draait.
Daar ging de musttail-meting van 24 oktober 2026 mis (verslag
`docs/2026-10-24_proef_dispatch_musttail_verslag.md`, §8): musttail leek
sneller op wasm, maar warm was switch 1,4-1,8x sneller.

## Gebruik (vanuit de repo-root, met emsdk)

```bash
W=/tmp/wasm-ab                                    # een werkmap
bash websapl/tools/wasm_ab_meting/bouw.sh $W main  ~/dev/jmvm          # A: main
bash websapl/tools/wasm_ab_meting/bouw.sh $W proef ~/dev/jmvm-proef    # B: de wijziging
cp -r $W/wasm_main $W/wasm_main2                                       # voor de ruiscontrole

node websapl/tools/wasm_ab_meting/meet_chrome.js $W                    # A tegen B in Chrome
node websapl/tools/wasm_ab_meting/meet_chrome.js $W --var main,main2   # de ruis
node websapl/tools/wasm_ab_meting/meet_node.js   $W                    # hetzelfde in node
```

Opties van beide meetscripts: `-n rondes` (standaard 7), `--var a,b`
(standaard `main,proef`: de mappen `wasm_a` en `wasm_b` in de werkmap),
`--los` (zie hieronder), en benchmarknamen (standaard alle 13). De
programma's zijn `benchmarks/<naam>.jvb` van de checkout waaruit je meet;
die mogen geen instructies gebruiken die in een van beide VM's ontbreken.

`bouw.sh` gebruikt de em++-regel van `websapl/tools/build_wasm.sh` (houd ze
gelijk) en meldt of de uitkomst byte-gelijk is aan de gecommitte
`websapl/engine/jmvm.wasm`; voor `main` moet dat zo zijn, anders meet je
iets anders dan WebSapl draait.

## Wat er gebeurt

1. Per variant één gecompileerde `WebAssembly.Module`; elke run is een vers
   exemplaar daarvan (`instantiateWasm`), zoals de worker per run een vers
   exemplaar maakt.
2. Koud: één run van het eerste programma (ter info).
3. Opwarmen: de opwarmrun van de worker (uit `worker.js` gelezen), dan elk
   programma drie keer, met een pauze, zodat TurboFan klaar is.
4. `-n` rondes, per programma A en B afwisselend (de volgorde wisselt per
   ronde). Per programma minimum en mediaan, het verschil van B tegen A, en
   of de uitvoer gelijk is (de `res:`-regel, of de hele uitvoer).
5. De losse tijden staan eronder: een tweetoppige verdeling betekent dat
   een deel van de runs niet warm was.

**Ruisvloer:** meet `main` tegen een kopie van `main` (`--var main,main2`).
Een ongebruikte functie erbij, zoals native bij `ab_meting.py`, werkt hier
niet: `wasm-ld` gooit hem weg, en V8 compileert elke functie apart.
Gemeten 26 oktober 2026: Chrome ±0,4%, node ±1,4% (mediaan).

**`--los`:** elk exemplaar compileert de wasm zelf (`wasmBinary`). In node
draaide `main` dan willekeurig de helft van de runs twee keer zo traag (koude
code); in Chrome was het stabiel. Meet daarom zonder `--los`, en altijd ook in
Chrome: node tiert anders.

## Uitkomsten

- 26 oktober 2026, de proef "ongebruikte instructies weghalen"
  (tag `proef/ongebruikte-instructies`): native ±0 met musttail, maar in
  Chrome `fib` +21% warm. Zie `docs/performance_bevindingen.md`.
