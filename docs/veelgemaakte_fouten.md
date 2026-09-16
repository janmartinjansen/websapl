# Veelgemaakte fouten in Sapl

Sapl is een kleine taal met een paar niet voor de hand liggende
beperkingen die **niet crashen** — ze compileren en draaien gewoon door,
met een stil verkeerd resultaat, of geven een onbegrijpelijke foutmelding
op een heel andere plek dan waar de echte fout staat. Deze lijst is
bedoeld om je meteen naar de juiste verdachte te sturen als je een van
die twee dingen tegenkomt. Zie `docs/sapl_taalgids.md` voor de
basisgrammatica zelf.

## Een patroon tussen haakjes in de functiekop faalt altijd

```sapl
// FOUT — allemaal dezelfde contentloze foutmelding op een andere regel:
hdOf (Cons x xs) = x
ptx (Pt x y) = x
f (NoInput) = 1          // ook fout, ook al bindt dit geen velden

// GOED — kaal (zonder haakjes) werkt als de constructor nul velden heeft:
f NoInput = 1
f Nil = 0

// GOED — voor elk patroon dat wél velden bindt, altijd via case:
hdOf xs = case xs (Cons x rest -> x)
```

De scheidslijn is **haakjes rond het patroon in de functiekop**, niet het
aantal velden. Sapl+'s patroon-definities (`parser_combinators/README.md`)
hebben deze beperking niet — die vlakken het patroon zelf al uit naar een
`case` vóórdat de basiscompiler de tekst ziet.

## `!` op een veld dat een PARTIEEL TOEGEPASTE functie bevat

`docs/sapl_taalgids.md` §1 noemt `!` "puur een optimalisatie-hint, die
nooit het resultaat verandert" — dat klopt niet helemaal als het
geforceerde veld een CURRIED, nog-niet-volledig-toegepaste functiewaarde
is:

```sapl
t x y = x + y
dub f x y = Tup (f x) (f y)     // (f x) is hier een 1-arg-curried closure

::tup  = Tup !a !b               // STRICT: forceert (f x)/(f y) meteen
start = case (dub t 3 4) (Tup f g -> f 6 + g 6)
// geeft een LEEG/kapot resultaat (res: zonder waarde erachter)

::tup2 = Tup a b                 // LUI: forceert pas bij gebruik
start2 = case (dub t 3 4) (Tup f g -> f 6 + g 6)
// geeft het juiste antwoord: 19
```

Zie `examples/curryvb.cfp` (kapot, strikt) vs `examples/curryvbns.cfp`
(correct, lui) voor de volledige, draaibare versie van dit voorbeeld.
**Vermijd `!` op een veld/parameter die een partieel toegepaste functie
kan bevatten** — gebruik `!` alleen voor gewone waardes (Int, String,
al-volledig-toegepaste ADT-waarden).

## `update`/`strat`/`get`: argumentvolgorde is niet wat de naam doet vermoeden

- `strat idx s` / `get idx s` — **index eerst, string/array tweede**.
- `update val idx arr` — **waarde eerst, dan index, dan de array** — dit
  is dus PRECIES OMGEKEERD van wat de naam suggereert. `update arr idx
  val` compileert zonder klacht maar **crasht de VM**.

Gebruik in de praktijk niet rechtstreeks deze drie — `lib/stdlib.cfp`
biedt `list2str`/`str2list`/`strcat`/`substr` die dit al achter een
normale interface wegwerken (zie `lib/README.md`).

## `==` op strings en op ADT-waarden is onbetrouwbaarder dan je denkt

- **Strings**: `==` vergelijkt de heap-pointer, niet de inhoud. Twee
  inhoudelijk identieke strings uit verschillende allocaties (bijv. het
  resultaat van `constrName x` vergeleken met een letterlijke string)
  zijn zo goed als nooit `==`. Gebruik `strEqual` (`lib/stdlib.cfp`).
- **Een willekeurige ADT-waarde**: `==` lijkt de identiteit van "dezelfde
  logische waarde" te verliezen zodra die waarde als apart
  functie-argument is doorgegeven, ook met een `!`-strikte parameter:

  ```sapl
  ::Thing = Thing !n
  t1 = Thing 1

  eqCheck !a !b = if (a == b) 1 0

  start = print (eqCheck t1 t1) <#> print (t1 == t1) <#> writeChar 1 10
  // geeft "0 1", niet "1 1"
  ```

  Gebruik `==` dus nooit om te bepalen of twee ADT-waarden "dezelfde"
  zijn nadat een van beide door een functieaanroep is gegaan (bijv. voor
  identiteitscontroles in een event-loop of een figuur-/nodetracking-
  systeem). Geef in plaats daarvan een expliciet uniek `!id`-veld (een
  gewoon geheel getal) mee en vergelijk daarop — geheel-getal-`==` heeft
  dit probleem niet.

## Een kale `/\`/`\/`-expressie inline als aanroepargument

```sapl
idOf x = x
start = print (idOf (0 \/ 1))   // geeft 0, niet 1
```

Een booleaanse `/\`/`\/`-expressie die rechtstreeks (niet via een `let`
of een eigen naam) als aanroepargument wordt meegegeven, kan het
BITWISE-COMPLEMENT van het juiste antwoord opleveren. **Vermijd**: bind
zo'n expressie eerst aan een naam voordat je 'm doorgeeft:

```sapl
start = let d = (0 \/ 1) in print (idOf d)   // correct
```

## Geen constructor of operator als kale waarde doorgeven

```sapl
// FOUT — compileert en draait, maar corrumpeert stil verderop:
parseCompareTail l ts = ... (parseCmp NEq l ts) ...

// GOED — elke variant apart uitschrijven, nooit de operator/constructor
// zelf als waarde doorgeven:
parseCompareTail l ts =
  if (...) (... (NEq l r) ...)
  (if (...) (... (NLt l r) ...) ...)
```

Zie `docs/sapl_taalgids.md` §6. Dit is de gevaarlijkste categorie: geen
crash, geen foutmelding, alleen een stilletjes verkeerd antwoord — vaak
pas een paar functieaanroepen verderop zichtbaar.

## Foutmeldingen lezen

- Een syntaxfout geeft `"Error: Syntax error op regel N: unexpected
  '<token>'"` — bij gebruik van `#import` is `N` het regelnummer in de
  UITGEVOUWEN brontekst, niet in je eigen bestand.
- Een onbekende identifier geeft `"Error: <naam> not found"` — behalve
  in een `case`-patroon-constructornaam, die crasht nog wel direct.
- **`"run time error in function X"` waarbij `X` een bestaande functie
  is die je zelf niet geschreven hebt** (bijv. `printins`, `readprog`)
  **betekent vrijwel altijd dat JOUW code een niet-afgedekt geval raakt** —
  niet dat `X` stuk is. Isoleer je eigen bestand (stukken weglaten, apart
  compileren met een triviale `start`) tot je het minimale
  reproductiegeval hebt, in plaats van in `X` zelf te gaan zoeken.

"Geen crash" is nooit genoeg als testcriterium — meerdere fouten
hierboven compileren en draaien zonder klacht, en geven gewoon een fout
antwoord.
