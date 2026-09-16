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
  echte typen) — alleen het AANTAL velden telt.
- **Commentaar**: `//` tot het einde van de regel.
- **Literalen**: `123` (geheel getal), `'x'` (karakter — is gewoon een
  int), `"abc"` (string, zie §7), `True`/`False` (zie §2).
- **Geen unaire min**: schrijf `(0 - x)`, niet `-x`.
- **Functie-aanroep**: `f a b c` (naast elkaar zetten, links-
  geassocieerd, bindt STRAKKER dan elke infix-operator — `f n - 1` is
  `(f n) - 1`, niet `f (n - 1)`).

### Operator-precedentie (hoog → laag bindend)

```
* / %
+ - <#>
:                          (rechts-associatief, cons — bouwt een lijst)
== != < <= > >=
/\ \/
```

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

- Elke tak matcht **één niveau diep** op één constructor — géén geneste
  patronen zoals `(Cons x (Cons y ys) -> ...)`. Destructureer in stappen
  via losse hulpfuncties, of gebruik Sapl+'s patroon-definities
  (`parser_combinators/README.md`) als je dat vaak nodig hebt.
- Branches mogen in willekeurige volgorde staan.
- Je hoeft niet alle constructors af te dekken — een ontbrekende
  constructor crasht pas als hij ECHT geraakt wordt (`NoMatch`).
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

**Belangrijke beperking**: `if` en `case` mogen alleen in **staartpositie**
staan — als de hele body van een functie, of genest als tak van een
andere `if`/`case`. Gebruik ze **nooit** als argument van een aanroep of
als operand van een rekenkundige bewerking:

```sapl
// FOUT — compileert niet met een duidelijke fout ("unexpected: If")
g a b c = f (if (a == 0) b c)

// GOED — til de if/case naar een eigen naam
h a b c = if (a == 0) b c
g a b c = f (h a b c)
```

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
`if`). Zet zo'n `let` in een eigen naamgegeven hulpfunctie.

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

(Sapl+'s patroon-definities — `parser_combinators/README.md` — versmelten
zulke clausules zelf al tot precies zo'n `case`-vorm, vóórdat de
basiscompiler de tekst ooit ziet.)

## 6. Geen operators of constructors als eerste-klas waarde

Er is geen `(+)`-syntax om een operator als waarde door te geven, en een
constructor kun je ook niet zomaar als functiewaarde doorgeven. Wikkel
altijd in een naam:

```sapl
add a b = a + b
// gebruik `add` als waarde, nooit `+` zelf
```

Wil je écht een functie op naam kiezen (bijv. uit een tabel)? Gebruik dan
`lookup`/`applyDynamic` (§10) — nooit een operator/constructor als kale
Sapl-waarde.

## 7. Strings zijn gepakte arrays, geen char-lijst

- Een string-**literal** (`"abc"`) is een **gepakte array**
  (`readFile`/`readLine` geven hetzelfde formaat terug).
- Een **char-lijst** (`Cons 'a' (Cons 'b' Nil)`) is een gewone Sapl-lijst
  van karaktercodes.

**Vergelijk nooit een string-literal met `==` — ook niet twee strings
onderling.** `==` vergelijkt de HEAP-POINTER, niet de inhoud — twee
inhoudelijk identieke strings uit verschillende allocaties zijn zo goed
als nooit gelijk via `==`. Gebruik `strEqual` (`lib/README.md`) voor
echte inhoudsvergelijking van twee strings.

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

- **`error msg`** stopt de hele VM onmiddellijk — niet vangbaar. Gebruik
  dit alleen als verder draaien zinloos is.
- **`throw catchNr payload`** / **`try body handler`** is herstelbaar:

  ```sapl
  g !a !b = if (b == 0) (throw 1 "delen door 0") (a / b)
  f !x = try (g x 0) (handler 1)

  handler !n !err = if (n == 1) err 0
  ```

  De handler krijgt **precies één** extra argument (de payload) — geef
   'm dus zoveel vooraf-gebonden parameters als je nodig hebt, maar laat
  er precies één open.

  `try`/`throw` mogen, anders dan `if`/`case`, WEL op elke
  expressiepositie staan (ook als argument van een aanroep).

## 10. Reflectie en dynamische dispatch

Elke waarde heeft `typeId x` (1=Int, 2=Float, 3=String, 4=Functie, ≥5=een
ADT-constructor), `constrName x` (naam als string), `getField x idx`
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
