# `lib/stdlib.cfp` — de standaardbibliotheek

Dit is **geen voorbeeld om te draaien** (geen `start`) — het is de
gedeelde bibliotheek die de meeste andere `.cfp`/`.spp`-bestanden in
WebSapl importeren met `#import "lib/stdlib.cfp"` bovenaan hun bestand.
Browse het als naslagwerk om te zien wat er al klaarstaat vóór je zelf
`map`/`filter`/`strcat` opnieuw uitvindt.

## Wat erin zit

- **String-conversie**: `str2list`/`list2str` (gepakte string ↔
  char-lijst — zie `docs/sapl_taalgids.md` §7 voor waarom dat onderscheid
  ertoe doet), `strEqual` (echte inhoudsvergelijking — `==` op strings
  vergelijkt pointers, niet inhoud), `strUpper`, `substr`, `strcat`,
  `itoa` (Int → char-lijst).
- **Lijstfuncties**: `length`, `map`, `filter`, `foldl`, `foldr`,
  `append`, `take`, `drop`, `reverse` — precies de Haskell-achtige set die
  je overal in de andere voorbeelden terugziet.
- **Lui bestand-lezen**: `readStream`/`writeStream` (karakter-voor-
  karakter, zie `examples/lazy_io_test.cfp` voor gebruik).

Alle overige ingebouwde functies (`readFile`, `typeId`, `lookup`,
`applyDynamic`, `try`/`throw`, ...) zijn VM-primitieven, geen Sapl-code —
die staan niet hier maar in `docs/sapl_taalgids.md` §8-10.

# `lib/dict.cfp` — dict/hashmap (string-sleutel -> waarde)

Een associatieve datastructuur (gebalanceerde binaire zoekboom), er was
nog geen enkele in de standaardbibliotheek — alleen lijsten. API:
`dictEmpty`, `dictSet`/`dictGet`/`dictGetOr`/`dictHas`/`dictRemove`,
`dictSize`, `dictKeys`/`dictValues` (altijd gesorteerd),
`dictToList`/`dictFromList`. Zie `dict/dict_basic.cfp` voor een werkend
voorbeeld en `docs/2026-09-20_sapl_plus_dict.md` voor het ontwerp.

# `lib/eqnum.spp` — handmatige `eqnum`/`neqnum`-ontsnappingsklep (infix)

In Sapl+ vergelijken `==`/`!=` STRUCTUREEL (waarde, niet pointer) — zie
`docs/2026-09-20_sapl_plus_structural_equality.md`. Dat kost een kleine
overhead op strakke numerieke vergelijkingslussen; `preprocess/numsafe.cfp`
neemt die automatisch weg waar het kan bewijzen dat beide kanten Num/Float
zijn, en `eqnum`/`neqnum` (geen import nodig) plus dit bestand se infix-
synoniemen `~~`/`<>` laten de programmeur het expliciet zeggen waar de
automatische analyse het niet kan zien — dezelfde rol als een handmatige
`!` naast automatische strictness-inferentie.
