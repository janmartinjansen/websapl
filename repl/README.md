# `repl/repl_prelude.cfp` + `repl/stddyn.cfp`

## `repl_prelude.cfp`

Dit is **geen voorbeeld om te openen en te draaien** — het is een klein,
zelfstandig bestand dat de **⌨️ REPL**-tab (kopbalk, zie de hoofd-`README.md`
van WebSapl) automatisch als prelude laadt zodra je een sessie start.
Het bevat precies de minimale, zelf gekopieerde subset van `lib/
stdlib.cfp`/`repl/stddyn.cfp` die `showVal`/`printVal` (de generieke
pretty-printer die de REPL gebruikt om elk resultaat leesbaar te tonen)
nodig heeft — bewust **niet** de volledige standaardbibliotheek, zodat
`:load` op een doodgewoon `.cfp`-bestand dat zelf ook `::list`/`take`/
`map` declareert niet meteen op een naamsbotsing met de prelude struikelt.

Voor de volledige REPL-gebruikershandleiding (commando's, `:load`/`:save`,
bekende beperkingen, waarom dit bestand bestaat) zie de **repo-root**
`repl/README.md` — gedeeld tussen de terminal-REPL, Workbench en deze
WebSapl-tab, ze gedragen zich identiek.

Wil je dit bestand zelf lezen? Elke functie erin komt letterlijk uit
`lib/stdlib.cfp`/`repl/stddyn.cfp` — zie `lib/README.md` voor wat die twee
bestanden verder nog bieden.

## `stddyn.cfp`

**Dit is wél gewoon een letterlijke kopie van de repo-root `repl/
stddyn.cfp`** — een apart doel dan `repl_prelude.cfp` hierboven. Elk
`.spp`/`.cfp`-voorbeeld dat zelf `#import "repl/stddyn.cfp"` doet (bijv.
`records/records_showcase.spp`, voor de automatische `show_<Naam>`-
generatie in `preprocess/records.cfp`) heeft dat bestand nodig in de
Sapl+-preprocessor se WASM-VFS (`websapl/engine/worker.js`'s
`sppDepFiles`/`depDirs`, zie de commentaren daar) — die VFS is een
handmatig onderhouden allowlist van precies de bestanden die `#import`
ooit nodig heeft, niet de echte bestandssysteem. Ontbrak tot 17 september
2026 (gevonden doordat elk `#import "repl/stddyn.cfp"`-voorbeeld in de
browser stil zonder die inhoud preprocessede, en pas bij het compileren
strandde op `findAdtByCon: unknown constructor` zodra de gegenereerde
`show_<Naam>`-aanroep een niet-bestaande functie bleek — Workbench
(`workbench/server.js`) heeft dit gat nooit gehad, want die shellt
rechtstreeks naar `./run` met het echte repo-root-bestandssysteem, geen
VFS-allowlist).

Kom je een NIEUW `.spp`-voorbeeld tegen dat een ander repo-root-bestand
`#import`t dat nog niet in `sppDepFiles`/`depDirs` staat: zelfde patroon —
kopieer het bestand naar de juiste plek onder `websapl/`, voeg het toe aan
beide lijsten in `worker.js`, en draai `node websapl/tools/build_manifest.js`
opnieuw.
