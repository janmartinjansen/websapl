# Sapl+ (`.spp`) voorbeelden

Deze map bevat voorbeelden van **Sapl+** (`.spp`) — een kleine
Haskell/Clean-achtige taal die naar gewone Sapl (`.cfp`) vertaalt via een
in Sapl geschreven pre-processor (`preprocess/`). Volledige uitleg,
taalkenmerken en gebruik: `docs/spp_taal_en_parser_combinators.md` (repo-root).

Elk `.spp`-bestand hier staat naast zijn al vertaalde `.cfp` en gecompileerde
`.jmvm` — zo kun je de voorbeelden direct draaien (in WebSapl of Workbench)
zonder de preprocessor zelf te hoeven bouwen. De `.spp`-bronnen zijn er om te
LEZEN en als voorbeeld van de syntax; om zelf te wijzigen en opnieuw te
vertalen heb je de repo-brede toolchain nodig (zie het document hierboven,
sectie 2 — "Pipeline en gebruik").

## `benchmarks/`

De `.spp`-herschreven versies van 9 van de 12 kernbenchmarks
(`benchmarks/*.cfp`, CLAUDE.md) — dezelfde programma's, nu geschreven met
Sapl+'s pattern-definities, lijstletterlijken, ZF-expressies en
gebruiker-infix-operatoren in plaats van kale Sapl. Laat zien hoe Sapl+
er in de praktijk uitziet op niet-triviale, realistische programma's:
`eval`, `hamming`, `knights`, `match`, `parsetest`, `primes`, `prolog`
(+ `prologlib.spp`, gedeeld via `#import`), `queens`, `sort`.

## `parser_combinators/`

Voorbeelden van `preprocess/parsecomb/parsecomb.spp` — de parser-
combinatorbibliotheek in Sapl+ zelf, en het eigenlijke doel van dit hele
project ("een pre-processor bouwen met parser combinators als ultieme
testcase"):

- **`parsecomb.spp`** — de bibliotheek zelf (`POk`/`PErr`, `pMany`,
  `pChainl1`, `?`, ...).
- **`calc_demo.spp`** — de eenvoudigste evaluator: een rekenmachientje
  (`1+2*3` → `7`, met correcte operatorprioriteit via `pChainl1`).
- **`saplParse.spp`** — het grote, afsluitende voorbeeld: een parser die
  met parser combinators EXACT hetzelfde resultaat oplevert als
  `sapl_compiler/parser.cfp`'s eigen hand-geschreven parser (geverifieerd
  byte-voor-byte identiek op alle 12 kernbenchmarks, zie
  `preprocess/PLAN.md` sectie 17). Puur als bibliotheek meegeleverd (geen
  eigen `start`) — `saplParse_demo.spp` laat 'm draaien.
- **`saplParse_demo.spp`** — een klein, zelfstandig voorbeeld dat
  `saplParse.spp` gebruikt op een kort, ingebakken Sapl-fragment (geen
  bestand nodig) en het resultaat pretty-print via `sapl_compiler/
  stage_dump.cfp`'s eigen `dumpProgram` — dezelfde pretty-printer die
  `./compile-sapl --emit=parse` gebruikt op de ECHTE compiler se parse.
  Draait zonder bestandstoegang, dus ook probleemloos in WebSapl se
  in-browser WASM-VM (die geen toegang heeft tot de rest van de repo).
