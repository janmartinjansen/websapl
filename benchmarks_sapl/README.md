# Kernbenchmarks (plain Sapl)

De 12 kernbenchmarks waarmee de JMVM/Sapl-compiler zichzelf al jaren test —
elk klein genoeg om te lezen, groot genoeg om de VM (recursie, lazy
evaluatie, ADT's, strings) écht op de proef te stellen. Dit zijn de
bestanden die de repo-CI (`allrun`) gebruikt om te controleren dat een
wijziging aan de compiler of de VM niets stilzwijgend breekt.

Zelf proberen: open een bestand, kies **saplcomp** als Compiler Backend en
klik **Compileer & Run**. Voor `eval`/`parsetest`/`prolog` (interpreters
die zichzelf testdata voeren) duurt dat een fractie van een seconde; voor
`fib`/`primes`/`queens` kun je in het terminal-paneel de metrieken
(instructies, calls, creates) vergelijken tussen twee runs om het effect
van een wijziging te zien.

## Bestanden

| Bestand | Wat het test |
|---|---|
| `fib.cfp` | Naïeve dubbele recursie (`nfib`), puur functie-aanroep-overhead |
| `hamming.cfp` | Drie wederzijds-recursieve lui-geëvalueerde streams (Hamming-getallen) |
| `knights.cfp` | Backtracking-zoekprobleem (paardsprong) over een bord |
| `match.cfp` | Pattern-matching-zware lus |
| `parsetest.cfp` | Een kleine parser die zichzelf een testprogramma voert |
| `primes.cfp` | Zeef van Eratosthenes op een oneindige, lui geëvalueerde stroom |
| `prolog.cfp` | Een kleine Prolog-achtige unificatie-engine (grootste bestand, ~190 regels) |
| `queens.cfp` | Het klassieke n-koninginnenprobleem |
| `sort.cfp` | Sorteeralgoritmen op lijsten |
| `sprimes.cfp` | Priemgetallen met Peano-natuurlijke getallen (`Zero`/`Suc`) i.p.v. ingebouwde `Int` |
| `twice.cfp` | `twice twice twice twice inc 0` — herhaalde functiesamenstelling, `2^16` toepassingen |
| `eval.cfp` | Een kleine expressie-evaluator/interpreter |

## Zie ook

- `benchmarks_saplplus/` — dezelfde algoritmes (op een paar na) herschreven
  in Sapl+ (guards, lambdas, ZF, `:`-patronen) — een directe voor/na-
  vergelijking van hoeveel leesbaarder de sugar-laag dezelfde logica
  maakt.
- `paper_examples/` — kleinere, per-concept geïsoleerde voorbeelden uit
  het onderliggende IFL 2016-paper (lazy evaluatie, `let`-cycli, curried
  functies) als iets van deze benchmarks onduidelijk overkomt.
