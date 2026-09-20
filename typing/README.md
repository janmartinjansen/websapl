# Sapl+ typechecker

`preprocess/typecheck.cfp` is een Hindley-Milner-achtige type-inferentiepas
voor Sapl+ (unificatie + occurs-check + schema-instantiatie, een poort van
`ama_interpreter/evaltype.ama`'s eigen algoritme naar Sapl+'s bestaande
parser). Het is een **losstaande** tool, niet geïntegreerd in
`preprocess/driver.cfp`'s desugar-pijplijn: hij draait op de rauwe, net
geparste AST (`parseProgramText`), vóór lambda-lift/ZF-desugar/patroon-
compilatie, zodat foutmeldingen naar jouw eigen brontekst verwijzen en niet
naar intern gegenereerde namen.

Het is een aanvulling op, geen vervanging voor, de compiler of de linter
(`linter/sapl_lint.py`, structurele checks uit `sapl_programmeer_regels.md`)
— dit hier is écht type-inferentie: het leidt typen af en meldt waar ze niet
kunnen kloppen, zonder dat je zelf ooit een type hoeft op te schrijven.

## Gebruik

**Vanaf de command line**, vanuit de repo-root:

```bash
./compile preprocess/typecheck.cfp        # eenmalig, of na een wijziging aan typecheck.cfp
echo "typing/01_basis.cfp" | ./run preprocess/typecheck.jmvm
```

Het protocol is bewust minimaal: precies één regel op stdin (het pad naar
het te checken bestand, relatief aan de repo-root), en de uitvoer op stdout
is één regel per topniveaufunctie — `naam :: type` bij succes, of
`naam: FOUT: ...` bij een gevonden probleem.

**Via de Workbench**: start `./workbench/workbench.sh` (of
`node workbench/server.js <poort>` voor een aparte instantie naast een al
draaiende Workbench), open het bestand dat je wilt checken in de editor, en
klik op de **🧪 Typechecker**-knop in de werkbalk (naast Linter/Debugger).
Dat opent een aparte tab met een doelbestand-veld (automatisch ingevuld met
het laatst actieve bestand) en een "▶ Typecheck"-knop. De tab bouwt
`preprocess/typecheck.jmvm` zelf als het nog ontbreekt.

## Scope

Gedekt (allemaal getest tegen zowel eigen voorbeelden als de bestaande
`preprocess/tests/*.spp`-fixtures — zie elk genummerd bestand hieronder):

| Feature | Voorbeeld |
|---|---|
| Getallen, rekenkunde, vergelijkingen, `if`, recursie, currying | `01_basis.cfp` |
| Lijsten (Nil/Cons, polymorf) | `02_lijsten.cfp` |
| `case`-expressies (constructor-takken, `_`) | `03_case.cfp` |
| Gebruikers-ADT's | `04_adt.cfp` |
| ZF-comprehensies (generatoren, filters, parallelle generatoren) | `05_zf.spp` |
| Guards, multi-clause functies, geneste patronen in clausulekoppen | `06_guards_multiclause.spp` |
| Lambda-expressies | `07_lambda.spp` |
| `try`/`throw` | `08_try_throw.cfp` |
| VM-primitieven (float-wiskunde, IO, reflectie, generieke arrays, strings) | `11_vm_primitieven.cfp` |

Booleans krijgen hier gewoon `Num` (geen apart `Bool`-type): Sapl+'s eigen
parser herschrijft `True`/`False` al naar `1`/`0` vóórdat de typechecker de
AST ooit ziet, dus er is geen onderscheid meer te maken.

## VM-primitieven (`preprocess/typecheck.cfp`'s `primSchemes`)

Elke naam uit `ast.cfp`'s `primNames` (findBuiltin's opcode-primitieven plus
parser.ama's losse `predefs`-tabel: `strlen`/`strat`/`update`/`get`/
`strappend`/`strslice`/`strcpy`) heeft een handgeschreven schema, zelfde
mechanisme als Nil/Cons. Signaturen komen uit
`docs/sapl_programmeer_regels.md` §7/§8/§10 (argumentvolgorde bij
`getField`/`update`/`get`/`strat` is niet wat de naam doet vermoeden, zie
daar) en uit echte call-sites elders in de repo.

Twee bewuste ontwerpkeuzes, geen bug:
- **`makeConstr` is intrinsiek variadisch** (ariteit = aantal velden,
  verschilt per aanroepplaats) en krijgt daarom een kale verse `TVar` als
  "functietype" — de gewone curry-machinerie (`applyArgs`) unificeert die bij
  elk toegepast argument met een nieuwe pijl, dus elke aanroepplaats past
  zich vanzelf aan zijn eigen argumentaantal aan. Resultaat: typet altijd,
  maar controleert niets aan het aantal/de typen velden.
- **Reflectieprimitieven op een willekeurige waarde** (`typeId`, `getField`,
  `funcName`, ...) nemen een verse `TVar` voor die waarde — ze typen dus
  altijd, maar controleren niet of de waarde er daadwerkelijk zo uitziet
  (dat kan pas ten dele: `showValAux`-achtige code die op basis van een
  `typeId`-uitkomst tussen `Num`/`Float`/`Str` dispatcht, geeft hier
  onvermijdelijk een (over-strenge, veilige) foutmelding zodra zo'n waarde
  ook via een concreet-getypeerde primitief als `ftoa`/`itoa` gebruikt
  wordt — zie `repl/stddyn.cfp`'s `showValAux` voor een voorbeeld. Dat is
  een fundamentele HM-beperking, geen los te maken bug in dit schema.)

## Bekende gaten (nog niet geregistreerd, geen ontwerpfout)

- **`let`** en de rest van de kernexpressies zijn wél gedekt, maar zijn
  bewust **monomorf** binnen hun eigen scope (geen let-polymorfie over
  meerdere gebruiksplekken van dezelfde naam) — zie hieronder.

## Foutmeldingen: een galerij

`09_foutmeldingen.cfp` demonstreert, met uitleg per functie, elke soort
foutmelding die de checker kan geven: een echte type-mismatch, een
occurs-check (oneindig type), een onbekende constructor (los in een
toepassing en in een case-tak/patroon), een arity-mismatch, en een
onbekende naam/functie. Draai het bestand en vergelijk de uitvoer met de
commentaren.

## Bekende beperkingen (bewust, veilig — geen crash, geen stil verkeerd resultaat)

`10_beperkingen.cfp` demonstreert er twee, allebei een gevolg van dezelfde
ontwerpkeuze: alle topniveaufuncties in één bestand worden tijdens het
infereren als één grote, monomorfe, wederzijds-recursieve groep behandeld
(geen sterk-samenhangende-componenten/SCC-analyse zoals een echte ML/
Haskell-typechecker zou doen).

1. **Geen let-polymorfie over topniveaufuncties.** Een niet-recursieve
   hulpfunctie die op twee plekken met verschillende typen gebruikt wordt
   (bijvoorbeeld `identiteit` eerst op een `Num`, dan op een lijst) krijgt
   op de TWEEDE gebruiksplek een foutmelding, ook al is er met de functie
   zelf niets mis.
2. **Foutattributie kan op de verkeerde (latere) functie landen** wanneer
   het probleem alleen zichtbaar wordt via een vooruitverwijzing: de
   plekhouder van de latere functie wordt dan stilzwijgend vastgezet door
   de eerdere, foute gebruiksplek, en de melding verschijnt bij die latere
   functie in plaats van bij de plek waar de fout eigenlijk zit.

Beide zijn *te streng*, nooit te soepel — je krijgt in het slechtste geval
een onterechte foutmelding op correcte code, nooit een gemiste fout op
incorrecte code. De natuurlijke oplossing (SCC-gebaseerde generalisatie per
groep, zoals een productie-Hindley-Milner-implementatie doet) is een
vervolgstap, geen fundamentele blokkade.
