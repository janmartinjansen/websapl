# wasm_test — testbank voor de WASM-compiler

Een losse testpagina, geen onderdeel van de IDE. Hij vergelijkt per platform
twee manieren om Sapl-programma's te draaien:

- **interpreter:** WebSapl's Emscripten-engine (`../engine/jmvm.wasm`) met een
  `.jmvm`;
- **compiler:** hetzelfde programma, door `wasm_compiler/jmvm2wat.py` omgezet
  naar een eigen `.wasm`.

Elk wordt **koud** en **warm** gemeten. Achtergrond en de cijfers op de Mac
staan in [`../../wasm_compiler/README.md`](../../wasm_compiler/README.md).

## Bouwen

Vanuit de repo-root:

```bash
bash wasm_compiler/build_websapl_test.sh      # schrijft wasm_test/build/ en wasm_test/host.js
```

Alles in `build/` is gegenereerd:

- per programma vier `.wasm`-varianten;
- kopieën van de `.jmvm`'s;
- de geflattende bron van gen1;
- `manifest.json` met de verwachte uitvoer van `./run` en native gen1.

Opnieuw bouwen is nodig na een wijziging aan `benchmarks/`,
`sapl_compiler/saplcomp.jmvm` of `wasm_compiler/`. `host.js` is een kopie van
`wasm_compiler/host.js`; `node tools/sync_from_repo.js --check` bewaakt die.

## Draaien

```bash
node websapl/server.js 8080
```

Open daarna `http://localhost:8080/wasm_test/`. Voor een iPad of ander
apparaat op hetzelfde netwerk: `http://<ip-van-de-Mac>:8080/wasm_test/`. Het
IP-adres staat bij Systeeminstellingen → Wi-Fi → Details. Workers en `fetch`
werken niet vanaf `file://`, dus altijd via een server.

Kies **Alles draaien**. Dat duurt op een Mac ~40 s. Het resultaat staat
onderaan als tab-gescheiden tekst:

- **Kopieer** zet het op het klembord.
- Over gewoon http (zoals naar de iPad) mag de browser niet bij het klembord.
  De knop selecteert de tekst dan, en je kopieert met de hand.

URL-parameters (ook handig voor headless tests; zie
`wasm_compiler/chrome_testbank.sh`):

- `?auto=1`: meteen alles draaien.
- `?alleen=primes,gen1`: alleen deze programma's.
- `?variant=tail|driver`: de compiler-variant.
- `?geheugen=groot|klein`: de geheugengrootte.

## Wat er gemeten wordt

- **Koud:** de eerste run van een vers gecompileerde module.
  - De bytes krijgen een willekeurige custom section, zodat de browser geen
    eerder gecompileerde of geoptimaliseerde code kan hergebruiken.
  - In V8 (Chrome, Edge, Node) blijft bij de interpreter de hoofdlus dan op de
    basiscompiler (Liftoff) hangen; hij is zo ~2× trager dan warm.
- **Warm:** een tweede instantie van hetzelfde `WebAssembly.Module`, direct
  daarna. De engine kan dan zijn geoptimaliseerde code hergebruiken.
- **Factor:** interpreter / compiler. Boven de 1 is de compiler sneller.
- **Correct:** uitvoer (benchmarks) of lengte plus checksum van de
  gegenereerde `.jmvm` (gen1) gelijk aan de native referentie.
- **Isolatie:** elk paar (koud, warm) draait in een eigen Web Worker, die
  daarna wordt beëindigd, zodat het geheugen vrijkomt.

## Varianten

- **Compiler-variant:**
  - *tail calls* is de snelste variant in V8 (Chrome, Edge).
  - *driverlus* werkt ook zonder WASM tail calls, en is de snelste in
    JavaScriptCore (Safari, en elke browser op iPad/iPhone).
  - *automatisch* draait eerst een kort programma (nfib 32) in beide
    varianten en kiest de snelste. Ondersteuning zegt niets over snelheid: in
    Safari/JavaScriptCore zijn tail calls ~3× trager dan de driverlus, in
    Chrome andersom. De uitkomst staat in de omgevingsinfo en in het
    rapport.
- **Geheugen:**
  - *groot* gebruikt dezelfde heap als `vm.cpp`, in totaal ~460 MB.
  - *klein* gebruikt ~275 MB en doet meer GC's.

  Beide worden in één keer bij de start gereserveerd; de module groeit niet.
  WebSapl's interpreter-engine groeit zelf tot ~700 MB. Lukt de reservering
  niet, dan toont de cel `fout` met de melding als tooltip, en staat die ook
  in het rapport.
