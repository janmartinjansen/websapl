# Contracts en fantoomtypen voor Sapl+

Twee van de vijf opties uit het onderzoek naar dependent-type-achtige
functionaliteit voor Sapl+ (zie `archive/docs/2026-09-18_sapl_plus_typechecker_status.md`
in de hoofdrepo en het gesprek dat daaraan voorafging): beide vandaag al
bruikbaar, zonder de typechecker of de compiler zelf aan te passen.

## Gebruik (in WebSapl)

Open een van de bestanden hieronder (of je eigen `.cfp`) in de editor.

- **▶ Run** compileert en voert het bestand meteen uit — handig voor
  `voorbeeld_precondities.cfp` (slaagt) versus
  `voorbeeld_precondities_fout.cfp` (crasht met een duidelijke
  contract-melding, precies het punt van dit mechanisme).
- **🧪 Typecheck** toont het afgeleide type per functie, zonder iets uit te
  voeren — handig voor `phantom_types.cfp` (`mixUp` geeft daar een
  typefout, geen runtime-crash, dat is het hele punt van optie 2).

Dit is dezelfde tool als `contracts/` in de hoofdrepo (zie ook
`contracts/README.md` daar); hier gewoon beschikbaar zonder dat je iets
hoeft te compileren of installeren.

## Optie 1: contracts als runtime-assertie (`contracts.cfp`)

**Geen statisch bewijs** — dat vraagt een principieel andere checker dan
de unificatie-gebaseerde typechecker (types die van waarden afhangen, met
normalisatie i.p.v. unificatie). Wel een **harde garantie bij elke
daadwerkelijke aanroep**, hetzelfde model als Racket's `contract`,
Clojure's `spec`, of Python's `pydantic`/`typeguard`: geen bewijs vooraf,
maar een programma dat een contract schendt crasht meteen, met een
duidelijke reden, op de plek waar het misging — nooit een stille, verderop
pas zichtbare corruptie.

- `require cond label body` — precondities.
- `ensure cond label val` — postcondities.
- `refine label pred val` — bouwsteen voor "smart constructors": bouw een
  verfijnde waarde, of crash meteen met een duidelijke reden.
- `safeMakeConstr0/1/2/3 tid conAux f0..` — een gevalideerde wrapper om
  `makeConstr` heen. Zie het "concrete gevaar" hieronder voor waarom dat de
  moeite waard is.

Voorbeelden: `voorbeeld_precondities(.cfp/_fout.cfp)`,
`voorbeeld_refine.cfp`, `voorbeeld_safe_makeconstr(.cfp/_fout.cfp)`.

### Het concrete gevaar dat dit oplost

`makeConstr` bouwt een ADT-waarde uit een los `type_id`/`aux`-paar, zonder
enige validatie. Een verkeerd paar geeft **stille tag-corruptie, geen
crash** — elke latere consument (case-dispatch, `getField`, GC) vertrouwt
de tag. De eerste, betere keus blijft altijd: bouw waarden dynamisch via
`applyDynamic (lookup naam) velden` (zie `reflection/generic.cfp`'s
`setField`) in plaats van rauwe `makeConstr`-aanroepen — dat pad kan per
definitie nooit een verkeerd paar produceren, omdat je een NAAM opgeeft,
geen getallen. `safeMakeConstr*` is voor de resterende gevallen waar je
toch met rauwe `type_id`/`aux` werkt (gegenereerde/geserialiseerde code):
een ronde-trip-check (`getConstrArity` leest de GEREGISTREERDE ariteit
terug via `constrName`+`lookup`+`funcArity`, niet het net-gezette
`admin.nrargs` van de waarde zelf) vangt een verkeerd paar dat toevallig
bij een bestaande constructor met een ANDERE ariteit hoort. Geen garantie:
een paar dat toevallig naar een constructor met DEZELFDE ariteit wijst
glipt er nog steeds doorheen — dit is een contract, geen bewijs.

### Een echte vondst onderweg

Tijdens het testen bleek `require (b != 0) "..." (a/b)` STIL het
omgekeerde antwoord te geven — de precondition-check op de succesvolle
weg faalde, en de fout-weg (delen door 0) liep juist door. Uitgebreid
geïsoleerd: dit is dezelfde bug als `docs/sapl_programmeer_regels.md` §1
(in de hoofdrepo) al documenteert voor `/\`/`\/` ("een kale expressie die
INLINE als aanroepargument wordt meegegeven compileert stil naar het
omgekeerde antwoord"), maar dan voor **gewone vergelijkingsoperatoren**
(`==`, `!=`, `>` bevestigd) — niet eerder opgemerkt voor die operatoren
specifiek. Bevestigd: gebeurt bij zowel `compile` als `compile_nostrict`,
en ongeacht een `!`-strictheidsvlag op de ontvangende parameter — dus geen
strictness-inferentie-artefact, en geen luiheids-kwestie.

**Regel, identiek aan de bestaande `/\`/`\/`-regel**: bind een vergelijking
EERST aan een naam (`let ok = (a == b) in ...`) vóórdat je 'm als argument
doorgeeft. Nooit `f (a == b) ...` inline. Alle voorbeelden in deze map
volgen dit al; `contracts.cfp`'s eigen `safeMakeConstr*` doet het ook
intern (zie de commentaren daar).

## Optie 2: fantoomtypen via het bestaande ADT-mechanisme (`phantom_types.cfp`)

Geen nieuwe infrastructuur: een wrapper-ADT met precies één constructor
(`::Meters = Meters !n`) geeft nominaal onderscheid tussen "vormelijk
identieke" waarden, puur via de polymorfe constructor-schema's die de
typechecker al kent. Typecheck `phantom_types.cfp` om het te zien:

```
metersToFeet :: (Meters -> Feet)
addMeters :: (Meters -> (Meters -> Meters))
mixUp: FOUT: mixUp: kan niet unificeren: Meters met Feet
unwrapSorted :: (Sorted -> t0)
```

`mixUp` probeert een `Feet`-waarde te gebruiken waar `addMeters` een
`Meters` verwacht — gevangen zonder dat er ooit een getal fout hoeft te
gaan, puur op de nominale ADT-naam. Hetzelfde patroon werkt voor "bewezen
gesorteerd vs. onbekend" (`::Sorted = Sorted !a`, zie het bestand): een
downstream-functie die een gesorteerde lijst NODIG heeft, eist een
`Sorted`-argument in plaats van een kale lijst, en de typechecker
controleert dat er nergens per ongeluk een ongesorteerde lijst
doorgegeven wordt — zonder ooit runtime te hoeven checken of hij ECHT
gesorteerd is. Dat laatste ("is hij echt gesorteerd") is precies waar
optie 1 (runtime-contracts) wél voor bedoeld is — de twee opties zijn
complementair, niet concurrerend.

## Grens van beide opties

Geen van beide bewijst iets over de vorm van een waarde (sized vectors,
`Vec n a`-achtige garanties) — dat is optie 4 uit het onderzoek (echte
lichte dependent/indexed types), een uitbreiding van de typechecker zelf,
niet iets wat via preprocessing of een bibliotheek te doen is.
