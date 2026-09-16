# REPL-voorbeelden

Kleine `.cfp`-bestanden die specifiek gekozen (en getest) zijn om
probleemloos te laden in de **⌨️ REPL**-tab — d.w.z. ze botsen niet met
`repl/repl_prelude.cfp`'s eigen namen (zie dat bestand se README voor
waarom dat een reëel risico is). Verschijnen automatisch in de REPL-tab
se "📁 Voorbeeld laden"-keuzelijst; kiezen doet meteen `:load
repl_examples/<bestand>`.

Bedoeld om na het laden verder te bevragen in de REPL zelf — typ een
expressie die een hier gedefinieerde functie gebruikt, of definieer er
zelf iets bovenop met `:def`.

| Bestand | Probeer na het laden |
|---|---|
| `fib.cfp` | `nfib 30` |
| `hamming.cfp` | `el 20 (hamming 1)` |
| `primes.cfp` | `el 100 primes` |
| `queens.cfp` | `length (queens 8)` |
| `twice.cfp` | `printlist (reptwice 10)` |
| `lists_demo.cfp` | `range 1 5`, `double (range 1 3)` — koptekst legt de rest uit |
| `maybe_demo.cfp` | Een eigen `::Maybe`-ADT (`Nothing`/`Just`) — probeer `showVal (Just 5)` |

**Zelf een voorbeeld toevoegen**: zet het `.cfp`-bestand hier neer en
draai `node websapl/tools/build_manifest.js` opnieuw — maar controleer
eerst met `:load` in de terminal-REPL (repo-root `repl/README.md`) dat
het schoon laadt, geen botsing met de prelude.
