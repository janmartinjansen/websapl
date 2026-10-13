# Veelgemaakte fouten in Sapl

De meeste fouten in Sapl geven een compileerfout. Deze lijst gaat over de
paar die dat **niet** doen: ze compileren en draaien gewoon, met een stil
verkeerd resultaat. Plus, onderaan, wat de minder duidelijke foutmeldingen
meestal betekenen. Zie `docs/sapl_taalgids.md` voor de basisgrammatica.

*Bijgewerkt op 13 oktober 2026; elk punt is getoetst met de huidige
compiler.*

## Een constructornaam op een veldplek of in de functiekop is een variabele

```sapl
::list = Nil | Cons !x xs

// FOUT — `Nil` is hier een nieuwe variabele, de tak matcht ELKE Cons:
f xs = case xs (Cons x Nil -> 1) (_ -> 2)

// FOUT — `Nil` is hier een parameternaam, g geeft 0 voor ELKE lijst:
g Nil = 0

// GOED — één niveau per case:
f xs = case xs (Cons x rest -> case rest (Nil -> 1) (_ -> 2)) (_ -> 2)
g xs = case xs (Nil -> 0) (_ -> 1)
```

In Sapl+ zijn patronen in de functiekop echte patronen (`g Nil = 0` werkt
daar), maar in een `case`-tak geldt dit ook.

## `==` vergelijkt pointers, niet de inhoud

- **Strings**: twee strings met dezelfde inhoud uit verschillende
  allocaties zijn zo goed als nooit `==` (`s == "admin"`). Gebruik
  `strEqual` (`lib/stdlib.cfp`).
- **ADT-waarden**: `Cons 1 Nil == Cons 1 Nil` is onwaar. Let op: een
  definitie zonder argumenten (`t1 = Thing 1`) maakt bij elk gebruik een
  nieuwe waarde, dus ook `t1 == t1` is onwaar. Met `t1 =: Thing 1` (één
  gedeelde waarde) is het waar.

Wil je weten of twee ADT-waarden "dezelfde" zijn, geef ze dan een uniek
`!id`-veld (een geheel getal) en vergelijk daarop. In Sapl+ vergelijkt
`==` wél de inhoud.

## De handler van `try`: precies één open parameter, en een letterlijk getal

```sapl
handler !n !err = if (n == 1) err 0
f !x = try (g x 0) (handler 1)      // GOED: één open parameter (err)
```

- Met **nul** open parameters (`try body (handler 1 2)`) wordt de payload
  genegeerd; met **twee** krijg je een functiewaarde als resultaat. Beide
  zonder foutmelding.
- Alleen een **letterlijk getal** (`handler 1`) filtert op het nummer van
  de `throw`. Een naam (`handler code`) wordt een vang-alles die elke
  `throw` opvangt.

## Te veel of te weinig argumenten

`inc 1 2` (bij `inc x = x + 1`) of `add 1 + 2` (bij `add x y = ...`)
compileren zonder klacht en geven onzin. De typechecker (🧪-knop) vangt
dit wel.

## `!` op een veld dat een gedeeltelijk toegepaste functie bevat

```sapl
::tup  = Tup !a !b
t x y = x + y
dub f x y = Tup (f x) (f y)          // (f x) is een gedeeltelijke toepassing
start = case (dub t 3 4) (Tup f g -> f 6 + g 6)
// geeft een leeg resultaat; met ::tup = Tup a b (zonder !) het juiste: 19
```

Een bekende fout, nog niet opgelost (op 13 oktober 2026 nog steeds zo). Zet geen `!` op
een veld of parameter die een gedeeltelijk toegepaste functie kan bevatten.
Zie `examples/curryvb.cfp` en `examples/curryvbns.cfp`.

## Deling door nul

`a / 0` en `a % 0` worden niet afgevangen. In de browser volgt een trap;
op een Mac geeft het stil `0`. Test zelf vooraf of een deler nul kan zijn.

## `strat`/`get`/`update`: de argumentvolgorde

`strat idx s` en `get idx s` hebben de index eerst; `update val idx arr`
de waarde eerst en de array laatst. Een verkeerde volgorde geeft een
runtimefout die de juiste volgorde noemt. Voor gewoon werk zijn er
`list2str`/`str2list`/`strcat`/`substr` (`lib/README.md`).

## Foutmeldingen lezen

Meldingen die met `saplcomp:` beginnen, noemen de oorzaak en de functie.
Een paar andere komen uit het binnenste van de parser:

| melding | meestal |
|---|---|
| `appendArg: unexpected argument in this position` | Haskell-syntax: `case … of`, `where`, `if … then … else`, een `let` zonder komma's |
| `findOpInfo: unknown operator` | een operator die Sapl niet kent: `\|\|` (commentaar is `//`, "of" is `\/`), `&&` (`/\`), `$`, `.`, `^`, `:` (alleen Sapl+), backticks |
| `parseAtom: unexpected operator` | unaire min (schrijf `(0 - x)`), een operator als waarde (`(+)`), `--` |
| `parseAtom: 'let'/'in' not allowed here` | een `let` die niet de hele functiebody is |
| `findAdtByCon: unknown constructor` | een niet-gedeclareerde constructor (`Nil`/`Cons` zonder `::`-declaratie), `True`/`False` in een `case`, of een variabele met een hoofdletter |
| `parseFuncArgs: unexpected token in argument position` | een patroon of literal in de functiekop (alleen in Sapl+) |
| `onbekende naam if` | een `if` als functie van een aanroep, of `then`/`else` |

"Geen crash" is nooit genoeg als testcriterium: de fouten hierboven
draaien zonder klacht en geven gewoon een fout antwoord.
