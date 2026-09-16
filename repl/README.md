# `repl/repl_prelude.cfp` — de REPL-prelude

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
