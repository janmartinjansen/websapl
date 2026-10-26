# `tools/` — bouwtooling, geen Sapl-inhoud

Node.js-scripts voor het onderhouden van WebSapl zelf, geen onderdeel van
de bestandsboom die een gebruiker ziet (`build_manifest.js` sluit deze
map zelf al uit van de scan).

- **`build_manifest.js`** — scant de hele `websapl/`-boom en schrijft
  `websapl/manifest.json`/`websapl/js/manifest.js` (de statische
  bestandsboom die de UI links toont). Draai dit na élke wijziging aan
  welk bestand dan ook onder `websapl/` (nieuw bestand, hernoemd,
  verwijderd) — zonder dat blijft de UI de oude boom tonen:

  ```bash
  node websapl/tools/build_manifest.js
  ```

- **`wasm_ab_meting/`** — warme A/B-meting van twee VM-wasms in headless
  Chrome en node (opwarmen zoals de worker, een gedeelde gecompileerde
  module, ruiscontrole). Voor elke VM-wijziging; zie de README daar.

- **`sync_from_repo.js`** — houdt de kopieën in `websapl/` gelijk aan hun
  bron elders in de repo (compiler-bytecode in `engine/`, `#import`-modules
  in `sapl_compiler/`, voorbeelden, benchmarks, de CodeMirror-bestanden uit
  `workbench/`). De bron is altijd leidend. Een paar kopieën krijgen een
  padvertaling, omdat websapl `benchmarks/` als `benchmarks_sapl/` en
  `benchmarks_spp/` als `benchmarks_saplplus/` toont. De lijst met
  kopieën (en de paar bewuste uitzonderingen) staat bovenin het script.

  ```bash
  node websapl/tools/sync_from_repo.js --check   # alleen melden, exit 1 bij afwijking
  node websapl/tools/sync_from_repo.js           # afwijkende kopieën bijwerken
  ```

  Draai `--check` na elke wijziging aan een bestand dat websapl
  kopieert (bijvoorbeeld na het herbouwen van `sapl_compiler/saplcomp.jmvm`
  of een aanpassing in `sapl_compiler/stage_dump.cfp`), en bij een nieuw
  of verdwenen bestand ook `build_manifest.js`.

- **`repl_test.js`** — draait de WebSapl-REPL (`engine/worker.js`) in Node
  op de REPL-regressietests in `repl/tests/` (dezelfde bestanden als
  `repl/tests/run_repl_tests.sh` voor de Python- en C++-REPL):

  ```bash
  node websapl/tools/repl_test.js
  ```

- **`build_wasm.sh`** — bouwt de VM (`engine/jmvm.{js,wasm}`, leest alleen
  `.jvb`) en de tool-wasm (`engine/jvbtool.{js,wasm}`: `jmvm2jvb` +
  `jvb2jmvm`) met emsdk. Zie `laadformaat/ANALYSE.md` §19.

- **`jvb_paths_test.js`** / **`jvb_browser_test.js`** — de paden van de
  worker sinds de VM-wasm geen tekst meer leest: compile en retag naar
  `.jvb` (de tekst gelijk aan de native compilers), een losse of kapotte
  `.jmvm`-tekst, LC_RUN; in Node resp. headless Chrome:

  ```bash
  node websapl/tools/jvb_paths_test.js
  node websapl/tools/jvb_browser_test.js
  ```

- **`notebook_values_test.js`** — waarden bewaren over sessies heen (fase F,
  `docs/2026-10-23_waarden_bewaren_plan.md`): een run met `@@values` bewaart
  de uitgerekende `=:`-waarden, een verse sessie zet ze terug (`:sprint`
  toont ze uitgerekend vóór er een cel rekent), een gewijzigde cel niet; en
  een waarde die de native REPL bewaarde komt in de worker terug:

  ```bash
  node websapl/tools/notebook_values_test.js
  ```
