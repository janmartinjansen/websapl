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
