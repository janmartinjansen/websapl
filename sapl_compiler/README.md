# `sapl_compiler/` — interne compilermodules, geen voorbeelden

De vier bestanden hier (`ast_helpers.cfp`, `lexer2.cfp`, `newparser_ast.cfp`,
`stage_dump.cfp`) zijn **geen zelfstandige voorbeelden** — het zijn kale
library-modules van de zelf-hostende Sapl-compiler ("gen1"), zonder eigen
`start`. Open je er één rechtstreeks en klik "Compileer", dan gebeurt er
niets nuttigs.

**Waarom staan ze dan toch in de bestandsboom?** `engine/worker.js` laadt
deze vier bestanden bij het opstarten in de virtuele bestandssysteem
(`/sapl_compiler/...`), omdat andere, wél-uitvoerbare voorbeelden ze via
`#import` nodig hebben:

- `parser_combinators/saplParse.spp` — een parser-combinator-kloon van de
  ECHTE compiler-parser, geverifieerd byte-voor-byte identieke output op
  alle kernbenchmarks. Gebruikt `lexer2.cfp` (tokenizer), `newparser_ast.cfp`
  (AST-vorm) en `ast_helpers.cfp`.
- `parser_combinators/saplParse_demo.spp` — draait `saplParse.spp` en toont
  het resultaat via `stage_dump.cfp`'s `dumpProgram`.
- `repl/repl_prelude.cfp` — hergebruikt een klein stukje van dezelfde
  bibliotheek.

**Wil je deze code echt IN ACTIE zien**: open `parser_combinators/
saplParse_demo.spp` (of `saplParse.spp` zelf) — dat is waar deze modules
voor bedoeld zijn. Verwijder deze map niet: dat breekt beide bestanden
hierboven stil (een ontbrekend `#import`-bestand geeft pas een fout zodra
je daadwerkelijk compileert).
