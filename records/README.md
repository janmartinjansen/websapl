# Records-demo

`records_showcase.spp` laat Sapl+'s record-syntax zien (`::Naam = { !veld
: Type, ... }`) en hoe de pre-processor (`preprocess/`, zelf in Sapl
geschreven, self-hosted) 'm afbeeldt op gewone Sapl vóórdat
`parser.ama`/`saplcomp.jmvm` het ooit ziet. Zelfde stijl als
`sapl_plus_demo/`: de fragmenten hieronder zijn de ECHTE gegenereerde
`.cfp`-tekst (`records_showcase.cfp`), met de auto-gegenereerde
`__pat_N`-variabelen hernoemd naar iets leesbaars. Volledig
ontwerp/implementatieverslag: `preprocess/PLAN.md` sectie 20.
Programmeerregels/beperkingen: `docs/sapl_programmeer_regels.md` #1.

Zelf proberen: `printf 'records/records_showcase.spp\nuit.cfp\n' | ./run
preprocess/driver.jmvm` (vanuit de repo-root), daarna `./compile uit.cfp`
en `./run uit.jmvm` zoals gewoonlijk. Of open het bestand in
WebSapl/Workbench en klik op "Preprocess (.spp → .cfp)".

## 1. Declaratie → gewone ADT + getters + setters

```sapl
::Persoon = { !naam : String, !leeftijd : Int, !woonplaats : String }
```

wordt (typenaam verdubbelt als constructornaam, precies één veld per
positie):

```sapl
::Persoon = Persoon !naam !leeftijd !woonplaats

naam p = getField p 0
leeftijd p = getField p 1
woonplaats p = getField p 2

setNaam p v = Persoon v (leeftijd p) (woonplaats p)
setLeeftijd p v = Persoon (naam p) v (woonplaats p)
setWoonplaats p v = Persoon (naam p) (leeftijd p) v
```

Elke getter is gewoon een naamgegeven functie — `p.naam`-puntsyntax bestaat
nog niet (bewust een latere stap, zie sectie 3 van dit document en PLAN.md
sectie 20's eigen noot). Elke setter is een **functionele update**: hij
bouwt een NIEUWE `Persoon` met alle overige velden via de andere getters
teruggelezen, nooit een mutatie in place.

**Belangrijk, v1-beperking**: elk veld moet `!` (strict) zijn. Een
`!`-loos veld wordt met een duidelijke compileertijdfout geweigerd —
`docs/sapl_programmeer_regels.md` #1 en `preprocess/PLAN.md` sectie 20
leggen uit waarom (een gevonden, whole-program-afhankelijke
`strictness.ama`-interactie rond `getField` op een lazy veld, niet lokaal
door de pre-processor te garanderen).

## 2. `show_<Naam>`: automatisch, alleen als je het al kunt gebruiken

```sapl
::Boek = { !titel : String, !prijs : Int }
```

genereert ook (maar ALLEEN als het bestand zelf al `strcat`/`showVal`
definieert, hier via `#import "repl/stddyn.cfp"` bovenaan het bestand —
zonder die import zou een onvoorwaardelijke aanroep de compilatie breken
voor elk programma dat records gebruikt zonder de REPL-bibliotheek nodig
te hebben):

```sapl
show_Boek b = strcat "Boek { " (strcat "titel = " (strcat (showVal (getField b 0))
              (strcat ", prijs = " (strcat (showVal (getField b 1)) " }"))))
```

Dit haakt automatisch in op `repl/stddyn.cfp`'s bestaande
`show_<ConstrName>`-dispatch binnen `showVal`/`printVal` — geen aparte
registratie nodig. `printAlle`/`printPersoon` in dit bestand demonstreren
dat: elke `Persoon` in de lijst `personen` print zichzelf mooi via
`printString (show_Persoon p)`, zonder dat `printAlle` iets van records
hoeft te weten.

## 3. `__fields_<Naam>`: een tabel voor een LATERE generieke consument

```sapl
__fields_Persoon = Cons (Cons "naam" (Cons "String" Nil))
                   (Cons (Cons "leeftijd" (Cons "Int" Nil))
                   (Cons (Cons "woonplaats" (Cons "String" Nil)) Nil))
```

Een pure-data `[[naam,type], ...]`-lijst, gratis meegegenereerd naast de
accessors. `describeField`/`describeFieldsFrom`/`printBeschrijving` in
`records_showcase.spp` zijn een kleine, ZELF geschreven demonstratie dat
die tabel écht leesbaar is (geeft `Persoon { naam : String, leeftijd :
Int, woonplaats : String }`) — geen ingebouwd mechanisme, puur om te laten
zien dat een toekomstige generieke consument (een autoForm, een
JSON-serialisator — zie `docs/2026-09-14_visie_sapl_als_functionele_
python.md` sectie 3.B) hier iets zinnigs mee kan zonder de statische
Sapl-typen van dit bestand te kennen. Waarom niet alleen de naam, ook het
type: een `Bool` heeft geen eigen runtime-tag (`typeId` geeft gewoon `1`,
net als voor een willekeurig getal), dus `typeId` alleen is niet genoeg om
bijvoorbeeld een toggle-switch van een tekstveld te onderscheiden.

**Let op de decision-tree-vorm van `describeField`**: `Cons naam (Cons typ
rest)` is een GENESTE patroon — dat mag NIET als kale `case`-tak (die zijn
altijd plat, `docs/sapl_programmeer_regels.md` #2), maar wél als
clausulekop-patroon van een pattern-definitie, via Sapl+'s eigen
decision-tree-compiler (`preprocess/patcompile.cfp`):

```sapl
describeField (Cons naam (Cons typ rest)) = strcat naam (strcat " : " typ)
```

---

`start`'s volledige uitvoer (`./run records/records_showcase.jmvm`):

```
Hallo Jan
42 43
Persoon { naam = Jan, leeftijd = 43, woonplaats = Rotterdam }
Persoon { naam = Jan, leeftijd = 42, woonplaats = Utrecht }
Persoon { naam = Marie, leeftijd = 35, woonplaats = Amsterdam }
Persoon { naam : String, leeftijd : Int, woonplaats : String }
Boek { titel : String, prijs : Int }
```

De tweede en derde regel (`42 43`, dan de volle `janVerhuisd`-regel)
bewijzen de functionele update: `jan` zelf (regel 4, in de `personen`-
lijst) blijft `leeftijd = 42, woonplaats = Utrecht` — `verjaar`/`verhuis`
bouwden allebei een NIEUWE waarde, geen mutatie.
