# WebSapl — Luie Functionele Programmeertaal & JMVM WebAssembly IDE

**WebSapl** is een complete browser-gebaseerde ontwikkel- en runtime-omgeving voor de luie functionele programmeertaal **Sapl** en de **JMVM** (Jansen's Minimal Virtual Machine) WebAssembly interpreter.

---

## Belangrijkste Functies

- 🚀 **100% Client-side Execution**: Zowel de JMVM interpreter als de Sapl compiler draaien volledig in de browser via WebAssembly (geen server/backend vereist voor het compileren/draaien zelf — `server.js` serveert alleen de statische bestanden).
- 💾 **Virtueel Bestandssysteem (VFS & IndexedDB)**: Volwaardige ondersteuning voor Sapl File I/O (`readFile`, `writeFile`, `openFile`, `readChar`, etc.) *vanuit draaiende Sapl-programma's*. Bestanden die zo'n programma zelf wegschrijft, blijven via IndexedDB bewaard tussen sessies.
- 🔤 **Sapl+ (`.spp`) preprocessing**: `.spp`-bestanden (een kleine Haskell/Clean-achtige uitbreiding — lambda's, guards, ZF-expressies, patroon-definities) worden met één knop naar gewone Sapl (`.cfp`) vertaald, zelf ook in de browser via WebAssembly.
- λ **`.lfp` preprocessing**: `.lfp`-bestanden (Sapl met als enige uitbreiding kale, onbeperkte lambda's — inclusief directe toepassing zoals zelftoepassing, wat Sapl+'s eigen lifter weigert) worden net zo met één knop naar gewone Sapl (`.cfp`) vertaald (`lamlift/lamlift.jmvm`, zie `lamlift/README.md`).
- ⏱️ **Realtime Profiler**: Direct inzicht in executietijd (ms), aantal instructies, functiecalls, heapallocaties (`creates`) en garbage collecties, na elke run.
- 📝 **Moderne Code Editor**: Syntax-highlighting voor Sapl (`.cfp`/`.spp`/`.lfp`), multi-tab beheer, auto-indentatie, tabulatie en foutmeldingen (via CodeMirror).
- ✏️ **Bewerken & opslaan**: bestanden rechtstreeks in de browser bewerken; "Opslaan" bewaart je wijziging in `localStorage` van je eigen browser (blijft dus lokaal, wordt niet teruggeschreven naar de repo).
- ⌨️ **Sapl+ REPL**: interactief expressies evalueren en eigen functies/ADT's
  definiëren, zonder ergens te compileren — zie hieronder.

---

## Hoe te gebruiken

1. **Bestandsverkenner (links)** — alle mappen staan bij het openen dicht; klik
   op een map om 'm uit te klappen, en op een bestand om het te openen. De
   originele bronbestanden (`.cfp`, `.spp`, `.lfp`) staan er altijd; alles wat je zelf
   kunt genereren door te compileren/preprocessen (`.jmvm`, tussenformaten)
   ontstaat pas zodra je daarop klikt — dat houdt de boom overzichtelijk.
2. **Een `.cfp`-bestand compileren** — open het bestand, kies rechts een
   **Compiler Backend** (`saplcomp`, de zelf-hostende Sapl-compiler in
   WebAssembly; `retagcomp` voor Stage-4 Retag-bestanden; of `modules`,
   zie hieronder), zet eventueel **Strictness Analyse** aan/uit, en kies
   welke **Tussenformaten (Stages)** je wilt zien naast de uiteindelijke
   `.jmvm`-bytecode (bijv. `parse`, `lift`, ...) — handig om de compiler-
   pipeline stap voor stap te inspecteren. Klik dan **Compileer** (alleen
   bouwen), **Compileer & Run** (bouwen en meteen uitvoeren), of **Run**
   (een reeds gecompileerd `.jmvm` bestand draaien).
3. **Een `.spp`-bestand (Sapl+) gebruiken** — open het bestand en klik op
   **Preprocess (.spp → .cfp)**. Dat zet de Sapl+ syntax om naar gewone Sapl
   en opent het resultaat als nieuw `.cfp`-tabblad; vanaf daar werkt stap 2
   hierboven precies zoals altijd.
4. **Een `.lfp`-bestand gebruiken** — hetzelfde idee, met **Preprocess
   (.lfp → .cfp)** (`lamlift/lamlift.jmvm`); zie `lamlift/README.md` voor wat
   `.lfp` toevoegt aan kale Sapl en waarom het (in tegenstelling tot
   `.spp`) directe lambda-toepassing wél toestaat.
5. **Terminal & metrieken (onder)** — toont compiler- en programma-uitvoer,
   en na elke run de metrieken (`res`, tijd, instructies, calls, creates, gc).
   Programma's die stdin lezen kun je invoer sturen via de prompt-balk
   onderaan.
6. **Graphics Studio** (rechtsboven) — een aparte pagina om de `.cfp`-
   programma's in `grafisch/` visueel te draaien.

### Modulegewijs compileren (backend "modules")

Een client-side poort van `sapl_compiler/tools/build_modules.py` (zie
`docs/2026-09-13_modules_compileren_en_linken_gebruik.md`): compileert
het geopende bestand (de entry-module) apart tegen alleen de gegenereerde
defs/typedefs-signaturen van zijn afhankelijkheden, en linkt+snoeit dat
daarna samen tot één `.jmvm`, allemaal via herhaalde, verse WASM-VM-
instanties (`engine/worker.js`'s `buildModules()`) — geen los proces of
echt bestandssysteem nodig, exact dezelfde `createJMVMModule()`/VFS-truc
als de bestaande `saplcomp.jmvm`/`retagcomp.jmvm`-integratie.

Kies `modules` als Compiler Backend en vul een **manifestbestand** in —
een gewoon `.txt`-bestand (virtueel pad, bv. `workspace/manifest.txt`)
met `<module>: <dep1> <dep2> ...` per regel, paden relatief aan de
manifest-locatie. Het geopende bestand is altijd de entry-module (geen
apart entry-veld — dat voorkomt dat het veld en het daadwerkelijk
gecompileerde bestand uit elkaar kunnen lopen).

**Hulp bij het manifest** ("Genereer suggestie"): een heuristische,
tekstuele naam-scan (dezelfde aanpak als `sapl_compiler/tools/
suggest_manifest.py`, hier zelfstandig in kale JS herschreven, geen
call-graph-analyse) door de `.cfp`-bestanden in de opgegeven scope-map —
een startpunt om te controleren en aan te vullen, geen afgeleide
waarheid. Opent de suggestie als nieuw, nog niet opgeslagen tabblad op
het manifestpad; controleer/bewerk en klik gewoon **Opslaan** zoals bij
elk ander bestand.

**Geen "force herbouw"-optie** (in tegenstelling tot de CLI/Workbench-
versie): zonder een echt bestandssysteem is er geen persistente "laatst
gebouwde versie" tussen paginaherladingen om tegen te vergelijken, dus
elke build herbouwt hier altijd alle modules opnieuw.

### Sapl+ REPL (⌨️ REPL)

Client-side poort van [`sapl_compiler/tools/repl_retag.py`](../sapl_compiler/tools/repl_retag.py)
(zie [`docs/2026-09-13_repl_gebruik.md`](../docs/2026-09-13_repl_gebruik.md)
voor de volledige gebruikershandleiding, gedeeld met de terminal- en
Workbench-versies) — de derde, gedrag-identieke implementatie van
dezelfde sessie-logica, hier tegen `engine/worker.js`'s WASM-VM-
instanties in plaats van een los proces of subprocessen. Hergebruikt
dezelfde vijf primitieven als de "modules"-backend hierboven
(`saplcomp.jmvm`, `saplcomp_module.jmvm`, `retaglink.jmvm`,
`retagcomp.jmvm`, en de bestaande JMVM-uitvoerder).

Klik **⌨️ REPL** in de kopbalk om het REPL-tabblad te openen. Typ een
expressie (Enter of **Uitvoeren**) of `:def naam ... = ...` voor een
eigen functie/ADT; de belangrijkste commando's hebben ook een eigen
knop (**Historie**, **Undo**, **Functies**, **Reset**), plus `:load`/
`:save` met een eigen padveld. Geen Start/Stop nodig — de sessie leeft
zolang de pagina open blijft.

**📁 Voorbeeld laden** — een keuzelijst boven het `:load`-padveld, gevuld
met de `.cfp`-bestanden in [`repl_examples/`](../websapl/repl_examples/)
(`primes.cfp`, `fib.cfp`, `hamming.cfp`, `queens.cfp`, `twice.cfp`,
`maybe_demo.cfp`) — allemaal al geverifieerd te laden zonder botsingen.
Kiezen laadt meteen (`:load repl_examples/<bestand>`), geen pad zelf
hoeven te typen. Nieuw voorbeeld toevoegen: zet het `.cfp`-bestand in
`websapl/repl_examples/` en draai `node websapl/tools/build_manifest.js`
opnieuw (regenereert `manifest.json`/`js/manifest.js`, waar de keuzelijst
zijn lijst uit haalt) — controleer wel eerst met `:load` in de terminal-
REPL of het bestand schoon laadt (geen botsing met de prelude anders dan
de getolereerde identieke-tekst-gevallen, zie
`docs/2026-09-13_repl_gebruik.md`'s "Bekende beperkingen").

**Twee verschillen met de terminal-/Workbench-versies**, allebei
inherent aan het ontbreken van een echt bestandssysteem:
- `:load <pad>` leest het bestand uit de bestandsboom/al-geopende
  tabbladen/localStorage (dezelfde bestandsresolutie als de modules-hulp
  hierboven), niet van schijf.
- `:save <pad>` opent de sessie als nieuw, nog niet opgeslagen tabblad
  op dat pad — klik daarna zelf op **Opslaan** om 'm echt te bewaren
  (in `localStorage`), in plaats van meteen naar schijf te schrijven
  zoals de terminal-versies.

Zie ook `parser_combinators/README.md` voor meer over Sapl+ specifiek,
`lamlift/README.md` voor `.lfp`, en `paper_examples/README.md` voor de
voorbeelden uit het onderliggende paper.

---

## Starten

Start de lokale ontwikkelserver via Node.js:

```bash
cd websapl
node server.js
```

Open vervolgens je browser op:
👉 **[http://localhost:8080](http://localhost:8080)**

---

## Systeemeisen & Bouwen van WebAssembly

De voorgebouwde WASM-bestanden (`websapl/engine/jmvm.wasm` en `websapl/engine/jmvm.js`) zijn al meegeleverd.
Wil je de WASM-engine opnieuw compileren vanuit de C++ bronbestanden? Zorg dat de Emscripten SDK geïnstalleerd is:

```bash
source ~/emsdk/emsdk_env.sh
em++ -O3 -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sMODULARIZE=1 \
     -sEXPORT_NAME=createJMVMModule \
     -sEXPORTED_RUNTIME_METHODS='["FS","callMain","stringToUTF8","UTF8ToString"]' \
     -lidbfs.js -DSWITCH_CASE parser.cpp vm.cpp -o websapl/engine/jmvm.js
```
