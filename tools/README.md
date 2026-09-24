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
