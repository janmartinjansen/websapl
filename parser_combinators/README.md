# Sapl+ parser combinators

Deze map bevat **Sapl+** (`.spp`) — een kleine Haskell/Clean-achtige taal die
naar gewone Sapl (`.cfp`) vertaalt via een in Sapl geschreven pre-processor
(`preprocess/`) — en de parser-combinatorbibliotheek in Sapl+ zelf, het
eigenlijke doel van dat hele project ("een pre-processor bouwen met parser
combinators als ultieme testcase"). Volledige uitleg, taalkenmerken en
gebruik: `docs/spp_taal_en_parser_combinators.md` (repo-root).

Alleen de `.spp`-bron zelf staat hier — bewust **geen** voorgecompileerde
`.cfp` of `.jmvm` ernaast. **WebSapl herkent de `.spp`-extensie zelf.** Open
een `.spp`-bestand en klik op "Preprocess (.spp → .cfp)" — dat draait
`preprocess/driver.jmvm` (de pre-processor zelf, ook gewoon gecompileerde
`.jmvm`-bytecode) rechtstreeks in de browser via WebAssembly, en opent het
resultaat als nieuw `.cfp`-tabblad. Vanaf daar werkt alles zoals altijd:
"Compileer" / "Compileer & Run" op die `.cfp` roept de normale Sapl-compiler
aan. Dezelfde twee stappen als de CLI (`docs/spp_taal_en_parser_combinators.md`
sectie 2), nu ook zonder terminal.

(De `.spp`-herschreven versies van 9 van de 12 kernbenchmarks staan niet
hier, maar op het top-niveau in `benchmarks_saplplus/`.)

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

De repo-root-versie van deze map (`parser_combinators/`, buiten `websapl/`)
bevat daarnaast ook `saplParse_test.spp` (regressietest tegen de 12
kernbenchmarks, heeft bestandstoegang nodig) en `amaexpr.spp`/
`codegenAma.spp`/`resolveAma.spp` — een apart lopend vervolgproject dat
`parser.ama` zelf herbouwt met deze parser combinators. Die hebben allemaal
bestandstoegang tot de rest van de repo nodig en draaien daarom niet in
WebSapl se sandbox.
