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
