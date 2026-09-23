# selfinter/

Statische, echt-gehoste versie van de `saplsimple_direct`-voorbeeldengalerij
(broncode + README + live playground, WebAssembly), als sibling van
`funcprog/`, `graphics.html`, `studio.html` in deze site.

Was eerst een paar Claude Artifacts (single-file HTML, verplicht door de
Artifact-sandbox); deze versie hoort bij de repo zelf en laadt zijn
bestanden gewoon via `fetch()` in plaats van ingebakken JS-strings, zodat
`examples/*.fp` en `examples/README.md` de enige bron van waarheid zijn —
geen kopie die uit de pas kan lopen.

## Bestanden

- `index.html` — de pagina zelf (bestandsverkenner + README-weergave +
  playground).
- `driver.js` — de UI-logica: laadt `examples/README.md` (gerenderd met
  het al gevendorde `../js/marked.min.js`) en de gekozen `.fp`-bron via
  `fetch()`, initialiseert `sapl.js` en verbindt de chips/console.
- `sapl.js` — gecompileerde WASM-build van `../../saplsimple_direct`'s
  `REDUCT.CPP`/`PARSE.CPP`/`web.cpp` (Emscripten, `SINGLE_FILE=1`). Niet
  met de hand bewerken; regenereer met `../../saplsimple_direct/build_web.sh`
  en kopieer het resultaat hierheen na een wijziging in de reductor zelf.
- `examples/` — kopie van `../../saplsimple_direct/examples/` (dezelfde
  vier `.fp`-bestanden + hun eigen README.md). Bij een wijziging daar:
  kopieer opnieuw hierheen.

## Lokaal draaien

```
cd .. && node server.js 8080
```
en dan `http://localhost:8080/selfinter/`.
