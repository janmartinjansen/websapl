# Kernbenchmarks (Sapl+)

Dezelfde algoritmes als `benchmarks_sapl/`, met één op één (op `fib`/
`sprimes`/`twice` na, die er geen bij hebben — zie hieronder) — maar hier
handgeschreven in Sapl+ (`.spp`) i.p.v. plain Sapl (`.cfp`). Het doel is
een directe voor/na-vergelijking: dezelfde logica, maar met guards,
lambda's, ZF-expressies en `:`-cons-patronen i.p.v. geneste `if`/`case`-
ketens. Elk bestand se koptekst legt uit wát er precies leesbaarder werd
t.o.v. de `benchmarks_sapl/`-tegenhanger.

Zelf proberen: open een bestand en klik **Preprocess (.spp → .cfp)** —
dat zet de Sapl+-syntax om naar gewone Sapl en opent het resultaat als
nieuw `.cfp`-tabblad; vanaf daar werkt **Compileer**/**Compileer & Run**
zoals altijd. Vergelijk het gegenereerde `.cfp`-tabblad met het
handgeschreven origineel in `benchmarks_sapl/` om te zien wat de
pre-processor er precies van maakt.

## Bestanden

| Bestand | Tegenhanger in `benchmarks_sapl/` |
|---|---|
| `eval.spp` | `eval.cfp` |
| `hamming.spp` | `hamming.cfp` |
| `knights.spp` | `knights.cfp` |
| `match.spp` | `match.cfp` |
| `parsetest.spp` | `parsetest.cfp` |
| `primes.spp` | `primes.cfp` |
| `prolog.spp` + `prologlib.spp` | `prolog.cfp` (de Sapl+-versie splitst de parser-combinator-/unificatiebibliotheek in een apart, `#import`ed bestand, `prologlib.spp` — niet apart uitvoerbaar, alleen bruikbaar via `prolog.spp`/`parsetest.spp`) |
| `queens.spp` | `queens.cfp` |
| `sort.spp` | `sort.cfp` |

Geen Sapl+-versie (de plain-Sapl `.cfp` is al zo klein dat sugar niets
toevoegt): `fib.cfp`, `sprimes.cfp`, `twice.cfp`.

Volledige taalgids voor de syntax die hier gebruikt wordt:
`parser_combinators/README.md`, of het kortere overzicht in
`sapl_plus_demo/README.md`.
