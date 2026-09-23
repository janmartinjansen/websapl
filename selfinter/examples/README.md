# Voorbeelden

Vier `.fp`-bestanden, allemaal draaiend op dezelfde reductor
(`../REDUCT.CPP`/`../PARSE.CPP`) — geen ingebouwde datatypes: `cons`,
`nil`, een priemzeef en een self-interpreter zijn allemaal *gewoon
functies*, geen apart mechanisme.

## `list_demo.fp` — lijsten, rechtstreeks

`printList xs k = xs k (\h t -> print 0 h (print 1 " " (printList t k)))`
past een lijst toe op zijn twee eigen takken (`nil`/`cons`) om 'm te
ontleden — geen reflectie nodig, want het programma weet al dat het een
lijst van getallen print. Zie `../README.md` voor de volledige discussie
(en het contrast met `../../saplsimple_meta`, dat exact hetzelfde met
`seq`/`tag`/`getl`/`getr`/`funcname` oplost zonder dat vooraf te weten).

## `sieve.fp` — de klassieke zeef van Eratosthenes

Dezelfde `sieve`/`rem` als in het origineel uit 2009
(`saplsimple_num/num_example.fp`/`example.fp`), hier geprint via
`printList`.

## `self_interpreter.fp` — een self-interpreter

Ongewijzigd overgenomen van `saplsimple_num/lam25.fp` (JM Jansen,
2024-2025), met één toegevoegd voorbeeld. `seval` zet een Scott-encoded
representatie van een lambda-term (`Var`/`App`/`Abs`/`Lit`) om in een
échte, draaiende functie — interpreteren is hier letterlijk instantiëren.
`testfac = seval vbfac` herwint zo de faculteitsfunctie uit zijn eigen
codering: `testfac 6` → `720`.

Toegevoegd: `testprimes`, dezelfde priemzeef als `minimal_primes.fp`,
maar dan de "losse delen"-versie (`u`/`ustart`, met `I`/`D`/`r` er apart
in gecodeerd) teruggewonnen via `seval` — `printPrimes 30 testprimes` →
`110101000101000101000100000101`, identiek aan `minimal_primes.fp`'s
`primes`/`ustart`. En `testprimesOneliner`: dezelfde zeef, maar nu de
volledig ingevouwen één-regelversie (`primes`/`pp` zelf, met de
M-combinator `\r.r r` i.p.v. de losse `r`) — `printPrimesB 30
testprimesOneliner` → hetzelfde resultaat, andere codering. Hier is ook
`(\p.p p)` zelf als data gecodeerd (niet als kale Sapl-lambda om de
geëvalueerde stukken heen), zodat één enkele `seval`-aanroep de hele
`primes`-definitie — zelftoepassing inbegrepen — in één keer optilt tot
een draaiende functie.

## `minimal_primes.fp` — de minimalistische priemzeef

Ongewijzigd overgenomen van `saplsimple_num/t24b.fp`. `primes = (\p.p p)
(\p d c. ...)` — pure zelftoepassing, geen enkele genoemde recursieve
functie. Print via het originele, ongewijzigde `#c`-mechanisme
(`printlist`, gedefinieerd in het bestand zelf — geen conflict met onze
eigen `print`-opcode, die hier niet gebruikt wordt).

Verwante varianten van dezelfde zeef bestaan elders in hetzelfde archief
(`saplsimple_num/primes.fp`, met genoemde `sieve`/`rem`/`u` i.p.v. pure
zelftoepassing; `tromp.fp`/`tromp2.fp`, naar John Tromp's bekende
minimale lambda-calculus-priemzeef) — niet allemaal hier opgenomen, wel
authentiek onderdeel van dezelfde onderzoekslijn.

## Draaien

```
echo 'printList (take 10 primes) ""' | ./sapl examples/sieve.fp
echo 'print 0 (testfac 6) ""' | ./sapl examples/self_interpreter.fp
echo 'printPrimes 30 testprimes' | ./sapl examples/self_interpreter.fp
echo 'printPrimesB 30 testprimesOneliner' | ./sapl examples/self_interpreter.fp
echo 'printlist 30 primes' | ./sapl examples/minimal_primes.fp
```

Of interactief in de browser: zie de gepubliceerde voorbeeldengalerij
(WASM-build van deze map, `../build_web.sh`).
