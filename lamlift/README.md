# .lfp demo

`.lfp` is Sapl met als enige uitbreiding kale lambda-expressies
(`\x y -> body`) — geen guards, geen meerdere clausules per functienaam,
geen lijst-comprehensies (die blijven Sapl+-only, zie `sapl_plus_demo/`).
De preprocessor (`lamlift/lamlift.cfp` in de repo-root, zelf in Sapl
geschreven) lift elke lambda eager, op het moment dat hij geparsed wordt,
naar een verse top-level functie — net als `saplsimple_num/PARSE.CPP`'s
`readlocaldefinition()`, in tegenstelling tot Sapl+'s eigen lifter
(`preprocess/lambdalift.cfp`), die dat pas in een aparte pass ná het
parsen doet. Het verschil is niet cosmetisch: omdat een `\`-expressie hier
nooit als AST-node blijft bestaan, kan hij ook nooit de callee van een
toepassing zijn op het moment dat een latere pass dat zou moeten afhandelen
— dus **directe lambda-toepassing** (`(\x -> ...) arg`), inclusief
zelftoepassing (`(\c -> c c) (...)`), werkt hier gewoon, iets wat de
Sapl+-preprocessor bewust weigert.

Zelf proberen: open een van de bestanden hieronder in WebSapl en klik op
"Compileer & Run" — de vertaling naar `.cfp` gebeurt onderweg (zet onder
Instellingen het tussenformaat "cfp" aan om die `.cfp` ook te zien). In de
lokale Workbench: klik op "Preprocess (.lfp → .cfp)", daarna opent het
resultaat als gewoon `.cfp`-tabblad. Vanaf
de repo-root kan het ook met
`printf 'lamlift/tromp.lfp\nuit.cfp\n' | ./run lamlift/lamlift.jmvm`.

Volledige uitleg + de gevonden en opgeloste bugs onderweg:
`docs/programmas_overzicht.md`'s `lamlift/`-sectie en de git-geschiedenis
van `lamlift/lamlift.cfp`.

## Bestanden

| Bestand | Doel |
|---|---|
| `tromp.lfp` | De aan John Tromp toegeschreven "one-line" priemzeef met échte, onbeperkte zelftoepassing (`(\c -> c c) (...)`, Y-combinator-achtig geneste zelftoepassing) — precies wat de Sapl+-preprocessor weigert |
| `self_application.lfp` | Minimale zelftoepassing, `(\c -> c c) (\x -> x)` |
| `factorial.lfp` | Kleine recursieve `fac`, sanity-check van de gewone pijplijn |
| `case_map.lfp` | `case`/ADT-dispatch gecombineerd met een lambda als argument (`map (\x -> x*2) lijst`) |
| `shadowing.lfp` | Bewijst dat een geneste lambda-parameter die een buitenste naam schaduwt geen (onterechte) closure-capture oplevert |
| `feature_coverage.lfp` | Bredere dekkingstest: multi-binding en zelfrecursieve `let`, lambda binnen een `let`-binding, lambda binnen een `case`-tak die de pattern-variabele capturet, `nomatch` als kale tak |
| `lam25.lfp` | **Belangrijk voorbeeld**: port van `saplsimple_num/lam25.fp`, een self-interpreter voor uitgebreide lambda calculus. Codeert expressies Scott-encoded (`Var`/`App`/`Abs`/`Lit`) en interpreteert ze generiek via `seval`/`makeLam` — inclusief een zelf-geïnterpreteerde faculteitsfunctie (`res: 120`). Laat zien hoe een bare operator (`eq`/`sub`/`mult`) als eersteklas-DATA in een gecodeerde AST via een genoemde wrapper (`eqOp`/`subOp`/`multOp`) moet, omdat Sapl operatoren niet rechtstreeks als waarde toestaat (`docs/sapl_programmeer_regels.md` #6) — zie `docs/programmas_overzicht.md`'s `lamlift/`-sectie voor de volledige uitleg, inclusief de `lamlift.cfp`-bug die deze port blootlegde |

Alleen de `.lfp`-bronbestanden staan hier — de `.cfp`/`.jmvm`-output wordt
in de browser gegenereerd (zie de root `lamlift/`-map in de repo voor de
al-gegenereerde varianten, ter vergelijking).
