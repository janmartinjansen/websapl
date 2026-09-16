# Kleine voorbeeldprogramma's

Losse, kleine `.cfp`-bestanden die elk precies één ding demonstreren —
kleiner en gerichter dan `benchmarks_sapl/`, bedoeld om te lezen, niet om
prestaties te meten. Open een bestand, kies **saplcomp** als Compiler
Backend en klik **Compileer & Run**.

## De basis

| Bestand | Laat zien |
|---|---|
| `fac.cfp` | Kleinst mogelijke recursieve functie (faculteit) |
| `string.cfp` | String-indexering (`strat`) |
| `apply_demo.cfp` | Kleinst mogelijke hogere-orde-functie (`apply f x = f x`) |
| `maptest.cfp` | `map` over een lijst, met een eigen `Cons`/`Nil`-lijsttype |
| `hanoi.cfp` | Torens van Hanoi (klassieke recursie op een boom van zetten) |
| `tak.cfp` | Takeuchi-functie (klassieke drievoudig-recursieve benchmark) |

## Strictheid en luiheid

| Bestand | Laat zien |
|---|---|
| `fib1.cfp` / `fib43.cfp` | Identieke naïeve Fibonacci, met (`fib43`) en zonder (`fib1`) `!`-strictness-annotatie op het argument — vergelijk de metrieken (creates/instructies) na het draaien om het verschil te zien |
| `curryvb.cfp` / `curryvbns.cfp` | Dezelfde curry-truc (`dub f x y = Tup (f x) (f y)`, velden zijn PARTIEEL TOEGEPASTE functies), met een strikt (`curryvb`) en een lui (`curryvbns`) tupelveld — `curryvbns` geeft het juiste antwoord (`res: 19`), `curryvb` geeft een LEEG/kapot resultaat (`res: ` gevolgd door niets). Zie `docs/veelgemaakte_fouten.md` voor waarom |
| `tlazy.cfp` / `twice1.cfp` / `twice_direct.cfp` | Drie manieren om `2^16` functietoepassingen te forceren (`twice twice twice twice inc`, herhaalde lijstopbouw, en een rechttoe-rechtaan lus) — vergelijkbaar met `paper_examples/04_twicex.cfp`, hier drie varianten naast elkaar |

## Bestands-I/O

| Bestand | Laat zien |
|---|---|
| `iotest.cfp` | Kleinste vorm: `writeFile` gevolgd door `readFile`, zelfstandig (schrijft en leest hetzelfde bestand) |
| `lazy_io_test.cfp` | Karakter-voor-karakter kopiëren met `openFile`/`readChar`/`writeChar` (lui, geen hele bestandsinhoud in het geheugen) — leest `io/lazy_io_test_input.txt`, schrijft `io/lazy_io_test_output.txt` |
| `print_primes.cfp` | `readFile` op een ANDER bestand in de bestandsboom (`benchmarks_sapl/primes.cfp`) en de inhoud met een eigen opmaak afdrukken |

Zie ook `docs/sapl_taalgids.md` voor de basisgrammatica die al deze
bestanden gebruiken, en `benchmarks_sapl/README.md`/`benchmarks_saplplus/
README.md` voor grotere, prestatiegerichte voorbeelden.
