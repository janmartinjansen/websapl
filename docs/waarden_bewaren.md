# Waarden bewaren — gebruiksaanwijzing

*24 oktober 2026. Voor wie notebooks, de REPL of eigen programma's in Sapl
gebruikt. Hoe het van binnen werkt, staat in de repo in
`docs/2026-10-23_waarden_bewaren_plan.md`.*

Een notebook of REPL-sessie rekent dingen uit die tijd kosten: een tabel,
een lijst priemgetallen, de stand van een interactieve cel. Tot nu toe was
dat allemaal weg als je de pagina sloot of de REPL stopte. Nu kan het
bewaard worden, ook als het nog maar half uitgerekend is, en ook als er
functies in zitten. Er zijn drie manieren om dat te gebruiken:

| waar | hoe | wat |
|---|---|---|
| het notebook (WebSapl en Workbench) | het vinkje **waarden bewaren** | elke uitgerekende `=:`-waarde en het model van elke interactieve cel |
| de REPL | `:save` en `:load` | alle uitgerekende `=:`-waarden en `resN` van de sessie |
| je eigen programma | `pack`, `packMax`, `unpack`; met typecontrole `W.packT`, `W.unpackT` | elke waarde die je wilt |

Het voorbeeldnotebook **Waarden bewaren** (`notebooks/waarden_bewaren.spp`, in
WebSapl in de keuzelijst van het notebook) laat alles hieronder zien.

---

## 1. In het notebook

### Aan en uit

Het vinkje **waarden bewaren** staat in de werkbalk bovenaan en is
standaard aan. Zet je het uit, dan komt dat in het bestand te staan, in de
eerste regel:

```
//%% [instellingen] waarden=uit
```

Zo gedraagt het notebook zich bij iedereen die het opent hetzelfde.

### Wat er bewaard wordt

- **Elke `=:`-definitie die uitgerekend is** (een CAF), na elke run. Een
  `=:` die nog niet nodig was, wordt niet bewaard: er is nog niets te
  bewaren.

  ```
  tabel =: [fib k | k <- [1 .. 32]]
  ```

  Een gewone definitie zonder argumenten (`tabel = ...`) rekent bij elk
  gebruik opnieuw en wordt dus ook niet bewaard. Wil je iets onthouden,
  schrijf dan `=:`.
- **Het model van elke interactieve cel** (`D.interactive`, `D.animated`),
  na elke klik, toets of tik die het model veranderde.

Een waarde gaat mee zoals ze er op dat moment bij ligt. Een oneindige lijst
waarvan je de eerste tien elementen gebruikte, wordt bewaard als die tien
elementen plus "de rest, nog niet uitgerekend". In een volgende sessie rekent
hij gewoon verder.

### Wanneer een waarde terugkomt

Bij een volgende sessie: de pagina opnieuw geopend of herladen, een nieuw
proces in de Workbench, of nadat de engine in de browser stopte (een
"trap", bijvoorbeeld `1 / 0`). Voer het notebook uit, en de statusregel
meldt bijvoorbeeld:

```
klaar (146 ms, alles), 3 waarden teruggezet
```

(Het model van een interactieve cel telt mee als waarde.)

Een waarde komt alleen terug als **niets waar ze van afhangt veranderde**:

- de cel zelf;
- elke definitiecel die ze gebruikt (en wat die weer gebruiken);
- de bibliotheken die het notebook importeert;
- de versie van WebSapl of de Workbench zelf.

Verandert er iets, dan rekent de cel gewoon opnieuw en wordt de nieuwe
waarde bewaard. Na een nieuwe versie van WebSapl rekent dus alles één keer
opnieuw; dat is zo bedoeld, want een nieuwe compiler kan dezelfde tekst
anders vertalen.

### Interactieve cellen

- Klik een paar keer, herlaad de pagina en voer het notebook uit: de cel
  gaat verder waar ze was.
- **Opnieuw beginnen:** voer de cel opnieuw uit. Binnen dezelfde sessie
  begint een interactieve cel dan, zoals altijd, bij haar startmodel, en dat
  startmodel wordt meteen bewaard. Een verse sessie daarna begint dus ook bij
  het begin.
- Verander je een definitie waar de cel van afhangt (`update`, `view`, het
  startmodel, of iets wat die gebruiken), dan begint ze bij het startmodel.
  Een oud model past dan misschien niet meer bij de nieuwe code.
- Na een trap in de browser stoppen alle interactieve cellen (de sessie is
  weg). Voer het notebook uit: het laatst bewaarde model komt terug.

### Waar het staat

- **WebSapl:** in de browser (IndexedDB), per notebook (bestandsnaam).
  Alleen in die browser; een privévenster bewaart niets.
- **Workbench:** in `notebooks/.waarden/<notebook>/`, één bestand per
  waarde. Die map staat niet in git. Weggooien mag altijd: dan rekent alles
  opnieuw.

---

## 2. In de REPL: `:save` en `:load`

```
repl> :def fib n = if (n < 2) n (fib (n - 1) + fib (n - 2))
repl> :def tabel =: [fib k | k <- [1 .. 20]]
repl> :def som xs = case xs (Nil -> 0) (Cons x r -> x + som r)
repl> som tabel
17710
repl> :save sessie.cfp
opgeslagen naar sessie.cfp (met 2 waarden in sessie.cfp.waarden)
```

`:save` schrijft de definities naar `sessie.cfp`, en de uitgerekende
`=:`-waarden en `resN` naar `sessie.cfp.waarden` (hier `tabel` en `res0`).
Later, ook in een nieuwe REPL:

```
repl> :load sessie.cfp
geladen: fib, tabel, som, res0, it
2 waarden teruggezet
```

Dat lukt als het bestand en de bibliotheken niet veranderden; anders rekent
alles opnieuw.

Met `:sprint naam` zie je hoe ver een `=:`-waarde is uitgerekend, zonder dat
er iets bij rekent (zoals `:sprint` in GHCi). Een nog niet uitgerekend stuk
staat tussen `⟨` en `⟩`:

```
repl> neem 5 priemen
[2, 3, 5, 7, 11]
repl> :sprint priemen
[2, 3, 5, 7, 11 | ⟨zeef ⟨__zf_r981169398_1 11 [] ⟨…⟩⟩⟩]
```

(ingekort: de rest is de keten van filters die nog moet rekenen.)

In WebSapl geeft `:save` alleen de tekst van de sessie; de waarden gaan daar
niet mee.

---

## 3. In je eigen programma: `pack`, `packMax`, `unpack`, `packT`, `unpackT`

```
pack    :: a -> Str
packMax :: Num -> a -> Str
unpack  :: Str -> a
```

- `pack x` maakt van een waarde een tekst. Alles mag:
  - getallen, tekens en strings;
  - lijsten, records en andere constructors;
  - gedeelde stukken (die blijven gedeeld) en een cyclus;
  - een nog niet uitgerekend stuk (een thunk);
  - een functie of een gedeeltelijke toepassing.
- `packMax n x` doet hetzelfde, maar geeft `""` als de waarde meer dan `n`
  knopen heeft. Gebruik dit als een waarde onverwacht groot kan zijn.
- `unpack s` maakt van zo'n tekst weer een waarde.

```
pack [1, 2, 3]
-- "K list Cons 2 i1 K list Cons 2 i2 K list Cons 2 i3 K list Nil 0"

unpack (pack (neem 5 priemen))
-- [2, 3, 5, 7, 11]

strlen (packMax 10 tabel)
-- 0  (tabel heeft meer dan 10 knopen)
```

`pack` rekent de waarde alleen uit tot de buitenste constructor; alles
daaronder blijft zoals het is. Wat nog niet uitgerekend was, komt na
`unpack` als niet uitgerekend terug, en rekent pas als je het gebruikt.

### Naar een bestand en terug

```
bewaar pad x = writeFile pad (pack x)

haalTerug pad = unpack (readFile pad)
```

### Een functie terughalen

Functies staan in de tekst **bij naam**. Lees de tekst dus terug in
hetzelfde programma (of hetzelfde notebook), anders bestaat de naam niet en
krijg je een fout. Pas een functie uit `unpack` toe via een naam:

```
plus a b = a + b
tienErbij = unpack (pack (plus 10))

tienErbij 5          -- 15
(unpack s) 5         -- compileerfout: unpack krijgt 2 argumenten, verwacht 1
```

### Fouten

Een tekst die niet klopt, geeft een fout die je met `try` opvangt:

```
try (unpack "dit is geen waarde") (\melding -> strcat "fout: " melding)
-- "fout: unpack: onbekend teken 'dit' (bij teken 3)"
```

### Let op: `unpack` controleert het type niet

`unpack` weet niet welk type de tekst had. De typechecker gelooft wat je
ervan maakt (`unpack :: Str -> a`). Lees een tekst dus terug als het type dat
hij had; een andere lezing geeft onzin of een fout bij het gebruik. Het
notebook beschermt zich daartegen met de controle op "niets veranderd"
hierboven. In je eigen programma gebruik je daarvoor `packT` en `unpackT`.

### Met typecontrole: `packT` en `unpackT`

De module `lib/waarden.spp` doet hetzelfde als `pack` en `unpack`, maar met
het type erbij:

```
import "lib/waarden.spp" as W

s = W.packT "[Int]" [1, 2, 3]       -- "@type [Int]", een newline, dan pack [1, 2, 3]
W.unpackT "[Int]" s                 -- [1, 2, 3]
W.unpackT "[Str]" s                 -- fout: unpackT: verwacht [Str], gevonden [Int]
W.unpackT "[Int]" (pack [1, 2])     -- fout: unpackT: tekst zonder typekop (...)
W.typeOf s                          -- "[Int]"
```

Het type wordt twee keer gecontroleerd:

- **Bij het compileren**, door de typechecker, als het type een letterlijke
  tekst is. Bij `packT` moet de waarde dat type hebben, en `unpackT` geeft
  een waarde van dat type (niet het algemene `a`):

  ```
  repl> :type W.unpackT "[Int]"
  W.unpackT "[Int]" :: (Str -> [Num])
  repl> :type W.packT "[Int]" "x"
  fout: kan niet unificeren: [Num] met Str
  repl> :type W.unpackT "[Itn]" s
  fout: typetekst "[Itn]": onbekend type Itn
  ```

  In `./compile` en het notebook is dat, zoals altijd, een waarschuwing.
- **Bij het teruglezen**, door `unpackT`: is het type in de tekst een ander,
  dan volgt een fout die je met `try` opvangt.

De typetekst is geschreven zoals een veldtype in een record: `Int`, `Str`,
`Bool`, `Char`, `Float`, `[Int]`, `Stand`, `Tree Int`, `(Tree a)`. Grenzen:

- Er is geen functietype (`Int -> Int`). Een functie stop je in een record
  of ADT, of je gebruikt gewoon `pack`.
- Bij het teruglezen worden de teksten vergeleken, zonder spaties en met
  `Num` gelijk aan `Int` en `String` gelijk aan `Str`. Schrijf dus aan beide
  kanten hetzelfde type op.
- Een type uit een module (`D.Event`) en een typevariabele (`[a]`) controleert
  de typechecker niet; bij het teruglezen wordt alleen de tekst vergeleken.
- Een ADT met dezelfde naam maar een andere definitie (een veld erbij) komt
  door de controle. Na zo'n wijziging past een oude tekst niet meer.

---

## 4. Grenzen en tips

- **Grootte:** het notebook en `:save` bewaren een waarde tot 1.000.000
  knopen. Een grotere waarde rekent in de volgende sessie gewoon opnieuw.
- **Een closure uit een expressiecel zelf** in het model van een
  interactieve cel, zoals `D.interactive (\x -> x) ...`, komt alleen terug
  als de sessie op dezelfde manier begon. Anders begint de cel bij het
  startmodel (in de console van de browser staat dan waarom). Een functie
  uit een definitiecel komt altijd terug. Zet functies voor het model dus in
  een definitiecel.
- **Twee interactieve cellen met precies dezelfde tekst** delen hun
  bewaarde model.
- **Twee notebooks met dezelfde bestandsnaam** delen in WebSapl hun opslag.
  Ze krijgen nooit elkaars waarden, maar verdringen elkaars bestanden: dan
  rekent er soms iets opnieuw.
- **Oude waarden** van verwijderde of gewijzigde cellen blijven staan (in de
  Workbench zie je ze in `notebooks/.waarden/`). Ze kunnen geen kwaad;
  opruimen gebeurt nog niet vanzelf.
- **Niet bewaren** voor één notebook: haal het vinkje weg. Voor één waarde:
  schrijf `=` in plaats van `=:`.
