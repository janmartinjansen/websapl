# Sapl: taalgids

Sapl is een kleine, luie, functionele taal die naar JMVM-bytecode
compileert. Dit document beschrijft de **basistaal** (`.cfp`-bestanden) —
voor de Sapl+ (`.spp`) sugar-laag erbovenop (lambda's, guards,
lijst-comprehensies, `f"..."`-strings, `|>`) zie `parser_combinators/
README.md`, `sapl_plus_demo/README.md`, `lamlift/README.md` en
`records/README.md`. Elk voorbeeld hieronder is een echt, draaibaar
`.cfp`-fragment — probeer het gerust in een nieuw tabblad.

## 1. Basisgrammatica

Een `.cfp`-bestand is een reeks top-level definities:

```sapl
::TypeNaam = Constructor1 veld1 veld2 | Constructor2 veld
naam param1 param2 = body
```

- **Functiedefinitie**: `naam param1 param2 ... = body` — precies één
  body-expressie. Conditioneel gedrag gaat altijd via `if` of `case`
  (zie §2/§3), niet via guards zoals in Haskell (dat is Sapl+-sugar).
- **`!` voor een parameter- of veldnaam** markeert strictheid
  (`fac !n = ...`, `::pair = Pair !fst !snd`) — een optimalisatie-hint:
  het argument wordt geëvalueerd VOORDAT de functie start, in plaats van
  pas wanneer het echt gebruikt wordt. Voor gewone waardes (Int, String,
  al-volledig-toegepaste ADT's) verandert dit nooit het resultaat, alleen
  de performance — met één concrete uitzondering, zie
  `docs/veelgemaakte_fouten.md`'s sectie over `!` op partieel toegepaste
  functiewaarden.
- **ADT's** (algebraïsche datatypes): `::Naam = Cons1 v1 v2 | Cons2 v1`.
  De veldnamen na een constructor zijn vrije, cosmetische labels (geen
  echte typen) — alleen het AANTAL velden telt. Er zijn geen ingebouwde
  ADT's: ook `Nil`/`Cons` declareer je zelf (`::list = Nil | Cons !x xs`)
  of haal je uit `lib/stdlib.cfp`.
- **Commentaar**: `//` tot het einde van de regel (niet `--` of `||`).
- **Layout**: een regel in kolom 0 begint een nieuwe definitie; een
  vervolgregel springt in.
- **Literalen**: `123` (geheel getal), `1.5` (float), `'x'` (karakter;
  rekenen ermee geeft een int), `"abc"` (string, zie §7), `True`/`False`
  (zie §2).
- **Geen unaire min**: schrijf `(0 - x)`, niet `-x`.
- **Functie-aanroep**: `f a b c` (naast elkaar zetten, links-
  geassocieerd, bindt STRAKKER dan elke infix-operator — `f n - 1` is
  `(f n) - 1`, niet `f (n - 1)`).

### Operator-precedentie (hoog → laag bindend)

```
* / %
+ - <#>
== != < <= > >=
/\ \/                      (en, of)
```

Er is geen `:`-operator in `.cfp` (wel in Sapl+), en ook geen `&&`, `||`,
`$`, `.`, `++`, `/=` of `^`.

`<#>` is de sequencing-operator: evalueer links, geef rechts terug —
handig om side-effects (`print`, `writeChar`) na elkaar te zetten:

```sapl
start = print 1 <#> print 2 <#> writeChar 1 10
```

## 2. `case`: pattern matching

```sapl
::list = Nil | Cons !x xs

sumList xs =
  case xs
    (Cons x rest -> x + sumList rest)
    (Nil -> 0)
```

- Elke tak matcht **één niveau diep** op één constructor, met variabelen
  voor de velden — géén geneste patronen zoals `(Cons x (Cons y ys) -> ...)`.
  Destructureer in stappen, of gebruik Sapl+'s patroon-definities in de
  functiekop (`parser_combinators/README.md`).
- **Let op: een constructornaam op een veldplek wordt stil een variabele.**
  `(Cons x Nil -> ...)` matcht elke `Cons`. Schrijf
  `(Cons x rest -> case rest (Nil -> ...) (_ -> ...))`.
- Branches mogen in willekeurige volgorde staan.
- Je hoeft niet alle constructors af te dekken — een ontbrekende
  constructor geeft pas een fout als hij echt geraakt wordt
  (`nomatch for this case in function ...`).
- **Catch-all**: `(_ -> expr)` vangt elke niet-genoemde constructor op:
  ```sapl
  case xs (Cons x rest -> 1) (_ -> 0)   // Nil -> 0
  ```
- **`True`/`False` zijn géén constructors** — het zijn gewoon `1`/`0` als
  Int. Match er nooit op met `case`; gebruik `if` of `== 1`.

## 3. `if`: altijd drie delen

```sapl
if (conditie) (dan-tak) (anders-tak)
```

Geen `if` zonder `else`. Beide takken moeten echte waarden zijn.

`if` en `case` mogen **overal** staan waar een expressie mag: als hele
body, maar ook als argument, als operand of als veld van een constructor.
De compiler tilt ze zelf naar een hulpfunctie:

```sapl
f a b = a (if (b > 0) 4 6)
g xs = (case xs (Nil -> 0) (Cons y ys -> y)) + 1
```

Eén uitzondering: een `if`/`case` kan niet zelf de functie zijn die je
aanroept (`(if c h k) a b`). Bind die eerst aan een naam:
`f a b = let k = if (a > 1) add sub in k a b`.

## 4. `let`: precies één blok, nooit geketend

```sapl
naam args =
  let a = X, b = Y, c = Z in
  body
```

Meerdere bindingen horen in **één** `let` met komma's ertussen, niet als
losse, geketende `let ... in let ... in ...`. Latere bindingen mogen naar
eerdere verwijzen (en omgekeerd, en naar zichzelf — mutueel-recursieve
bindingen zijn toegestaan):

```sapl
hamming n =
  let h = Cons n (merge (merge as bs) cs),
      as = map (mult 2) h,
      bs = map (mult 3) h,
      cs = map (mult 5) h
  in h
```

`let` mag alleen de VOLLEDIGE body van een functie zijn — nooit als
sub-expressie ergens anders (niet rechts van `<#>`, niet als tak van een
`if` of `case`, niet als argument). De compiler meldt dan `'let'/'in' not
allowed here`. Zet zo'n `let` in een eigen naamgegeven hulpfunctie. Een
`if` of `case` als waarde van een binding mag wel.

## 5. Eén clausule per functienaam

In tegenstelling tot sommige andere functionele talen staat Sapl **geen**
meerdere top-level-definities voor dezelfde naam toe:

```sapl
// FOUT
evalNode (NNum n) = n
evalNode (NIdent name) = ...

// GOED — dispatch via case
evalNode nd =
  case nd
    (NNum n -> n)
    (NIdent name -> ...)
```

Ook een enkele clausule met een patroon in de kop (`hdOf (Cons x xs) = x`,
`fib 0 = 0`) gaat niet. **Let op:** een kale constructornaam in de kop
(`f Nil = 0`) is geen patroon maar een parameternaam; die functie geeft
stil 0 voor élke lijst.

(Sapl+'s patroon-definities — `parser_combinators/README.md` — versmelten
zulke clausules zelf al tot precies zo'n `case`-vorm, vóórdat de
basiscompiler de tekst ooit ziet.)

## 6. Operators zijn geen waarden; constructors wel

Een constructor mag gewoon als functiewaarde: `map Cirkel xs`, `Rechthoek 2`.
Een operator niet: er is geen `(+)`- of `(+1)`-syntax. Wikkel een operator
in een naam:

```sapl
add a b = a + b
// gebruik `add` als waarde, nooit `+` zelf
```

Wil je een functie op naam kiezen (bijv. uit een tabel)? Gebruik dan
`lookup`/`applyDynamic` (§10).

## 7. Strings zijn gepakte arrays, geen char-lijst

- Een string-**literal** (`"abc"`) is een **gepakte array**
  (`readFile`/`readLine` geven hetzelfde formaat terug).
- Een **char-lijst** (`Cons 'a' (Cons 'b' Nil)`) is een gewone Sapl-lijst
  van karaktercodes.

**Vergelijk geen strings met `==`.** In `.cfp` vergelijkt `==` de
HEAP-POINTER, niet de inhoud — twee inhoudelijk identieke strings uit
verschillende allocaties zijn zo goed als nooit gelijk via `==`. Gebruik
`strEqual` (`lib/README.md`). Hetzelfde geldt voor ADT-waarden (zie
`veelgemaakte_fouten.md`). In Sapl+ vergelijkt `==` wél de inhoud.

Nuttige functies (`lib/stdlib.cfp`, `#import "lib/stdlib.cfp"`):
`strlen`, `strat idx s`, `str2list`, `list2str`, `strcat`, `strUpper`,
`substr`, `strEqual`.

## 8. Ingebouwde functies (VM-primitieven)

- **I/O**: `readFile path`, `writeFile path content`, `readLine`,
  `printString s`, `openFile path mode`, `closeFile fd`, `readChar fd`,
  `writeChar fd c`, `print x`, `printC c` (karaktercode naar stdout).
- **Strings**: zie §7.
- Zie ook `docs/veelgemaakte_fouten.md` voor een paar niet voor de hand
  liggende argumentvolgordes bij een klein aantal van deze primitieven.

## 9. Foutafhandeling: `try`/`throw` versus `error`

- **`error msg`** drukt `msg` af en stopt de VM, tenzij een vang-alles-`try`
  (een handler zonder letterlijk getal, bv. `try body toon`) actief is: die
  vangt `error` en ook VM-fouten (heap of stack vol, ...).
- **`throw catchNr payload`** / **`try body handler`** is herstelbaar:

  ```sapl
  g !a !b = if (b == 0) (throw 1 "delen door 0") (a / b)
  f !x = try (g x 0) (handler 1)

  handler !n !err = if (n == 1) err 0
  ```

  De handler krijgt **precies één** extra argument (de payload) — geef
  'm dus zoveel vooraf-gebonden parameters als je nodig hebt, maar laat
  er precies één open. Met nul of twee open parameters gaat het stil fout.

  Alleen een **letterlijk getal** (`handler 1`) filtert op het
  throw-nummer; een naam (`handler code`) wordt stil een vang-alles.

  `try`/`throw` mogen, net als `if`/`case`, op elke expressiepositie
  staan (ook als argument van een aanroep).

## 10. Reflectie en dynamische dispatch

Elke waarde heeft `typeId x` (-1=Char, 1=Int, 2=Float, 3=String,
4=Functie, ≥5=een ADT-constructor), `constrName x` (naam als string), `getField x idx`
(veld op positie `idx`, brontekst-volgorde), `lookup "naam"` (vind een
top-level functie/constructor bij naam) en `applyDynamic fn argsLijst`.

Voor gewoon programmeerwerk: `#import "repl/stddyn.cfp"` geeft een
generieke pretty-printer `showVal`/`printVal` die op elke waarde werkt
zonder per-type code — gebruik die in plaats van de rauwe primitieven
hierboven. Zie `repl/README.md`.

## Verder lezen

- `docs/veelgemaakte_fouten.md` — een kleine, praktische lijst valkuilen
  die stil een verkeerd resultaat geven in plaats van een duidelijke
  compilerfout.
- `parser_combinators/README.md`, `sapl_plus_demo/README.md`,
  `lamlift/README.md`, `records/README.md` — Sapl+, de ergonomische
  sugar-laag bovenop deze basistaal.
