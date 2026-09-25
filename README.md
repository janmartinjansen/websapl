# WebSapl — Luie Functionele Programmeertaal & JMVM WebAssembly IDE

**WebSapl** is een complete browser-gebaseerde ontwikkel- en runtime-omgeving voor de luie functionele programmeertaal **Sapl** en de **JMVM** (Jansen's Minimal Virtual Machine) WebAssembly interpreter.

---

## Belangrijkste Functies

- 🚀 **100% Client-side Execution**: Zowel de JMVM interpreter als de Sapl compiler draaien volledig in de browser via WebAssembly (geen server/backend vereist voor het compileren/draaien zelf — `server.js` serveert alleen de statische bestanden).
- 💾 **Virtueel Bestandssysteem (VFS & IndexedDB)**: Volwaardige ondersteuning voor Sapl File I/O (`readFile`, `writeFile`, `openFile`, `readChar`, etc.) *vanuit draaiende Sapl-programma's*. Bestanden die zo'n programma zelf wegschrijft, blijven via IndexedDB bewaard tussen sessies.
- 🔤 **Sapl+ (`.spp`) preprocessing**: `.spp`-bestanden (een kleine Haskell/Clean-achtige uitbreiding — lambda's, guards, ZF-expressies, patroon-definities) worden bij het compileren automatisch naar gewone Sapl (`.cfp`) vertaald, zelf ook in de browser via WebAssembly.
- λ **`.lfp` preprocessing**: `.lfp`-bestanden (Sapl met als enige uitbreiding kale, onbeperkte lambda's — inclusief directe toepassing zoals zelftoepassing, wat Sapl+'s eigen lifter weigert) worden net zo automatisch naar gewone Sapl (`.cfp`) vertaald (`lamlift/lamlift.jmvm`, zie `lamlift/README.md`).
- ⏱️ **Realtime Profiler**: Direct inzicht in executietijd (ms), aantal instructies, functiecalls, heapallocaties (`creates`) en garbage collecties, na elke run.
- 📝 **Moderne Code Editor**: Syntax-highlighting voor Sapl (`.cfp`/`.spp`/`.lfp`), multi-tab beheer, auto-indentatie, tabulatie en foutmeldingen (via CodeMirror).
- ✏️ **Bewerken & opslaan**: bestanden rechtstreeks in de browser bewerken; "Opslaan" bewaart je wijziging in `localStorage` van je eigen browser (blijft dus lokaal, wordt niet teruggeschreven naar de repo).
- ⌨️ **Sapl+ REPL**: interactief expressies evalueren en eigen functies/ADT's
  definiëren, zonder ergens te compileren — zie hieronder.

---

## Hoe te gebruiken

WebSapl opent op een **beginpagina** (`index.html`) die kort uitlegt wat er
is en naar de onderdelen verwijst: deze Workbench (`ide.html`), de Sapl+
REPL, de Graphics Studio, de cursus, de self-interpreter, de
lambda-calculus-REPL en (voor auteurs) de Course Studio. Elke pagina heeft
linksboven een **← Start**-knop terug naar die beginpagina. Links van de
beginpagina kunnen meteen een bestand openen (`ide.html?file=<pad>`) of de
REPL (`ide.html#repl`).

In de Workbench:

1. **Bestandsverkenner (links)** — alle mappen staan bij het openen dicht; klik
   op een map om 'm uit te klappen, en op een bestand om het te openen. De
   originele bronbestanden (`.cfp`, `.spp`, `.lfp`) staan er altijd; alles wat je zelf
   kunt genereren door te compileren/preprocessen (`.jmvm`, tussenformaten)
   ontstaat pas zodra je daarop klikt — dat houdt de boom overzichtelijk.
2. **Compileren en draaien** — open een `.cfp`-, `.spp`- of `.lfp`-bestand en
   klik **Compileer** (alleen bouwen), **Compileer & Run** (bouwen en meteen
   uitvoeren) of **Run**. Een `.spp` (Sapl+) of `.lfp` wordt daarbij eerst
   automatisch naar gewone Sapl (`.cfp`) vertaald — met
   `preprocess/driver.jmvm` resp. `lamlift/lamlift.jmvm` — en meteen
   doorgecompileerd. Die tussenliggende `.cfp` zie je normaal niet; hij
   opent alleen als tabblad als je het tussenformaat **cfp** aanzet (zie
   stap 3), of als het compileren ervan mislukt (de compilerfout gaat dan
   over dat bestand, niet over je eigen broncode). Zie `lamlift/README.md`
   voor wat `.lfp` toevoegt aan kale Sapl en waarom het (in tegenstelling
   tot `.spp`) directe lambda-toepassing wél toestaat. **Typecheck**
   (Hindley-Milner, zie `typing/README.md`) is beschikbaar bij `.cfp` en
   `.spp`.
3. **Instellingen (rechts, standaard verborgen)** — open ze met de knop
   **Instellingen** bovenaan; de browser onthoudt of het paneel open of
   dicht staat. Hier kies je bij een `.cfp` de **Compiler Backend**
   (`saplcomp`, de zelf-hostende Sapl-compiler in WebAssembly; `retagcomp`
   voor Stage-4 Retag-bestanden, automatisch; of `modules`, zie
   hieronder), zet je **Strictness Analyse** aan/uit, en kies je welke
   **Tussenformaten (Stages)** je naast de uiteindelijke `.jmvm`-bytecode
   wilt zien (bijv. `parse`, `lift`, ...) — handig om de compiler-pipeline
   stap voor stap te inspecteren. Bij `.spp`/`.lfp` staat daar ook **cfp**
   (de voorverwerkte gewone Sapl).
4. **Terminal & metrieken (onder)** — toont compiler- en programma-uitvoer,
   en na elke run de metrieken (`res`, tijd, instructies, calls, creates, gc).
   Programma's die stdin lezen kun je invoer sturen via de prompt-balk
   onderaan.

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
(zie [`../repl/README.md`](../repl/README.md)
voor de volledige gebruikershandleiding, gedeeld met de terminal- en
Workbench-versies) — de derde, gedrag-identieke implementatie van
dezelfde sessie-logica, hier tegen `engine/worker.js`'s WASM-VM-
instanties in plaats van een los proces of subprocessen. Hergebruikt
dezelfde vijf primitieven als de "modules"-backend hierboven
(`saplcomp.jmvm`, `saplcomp_module.jmvm`, `retaglink.jmvm`,
`retagcomp.jmvm`, en de bestaande JMVM-uitvoerder).

Klik **⌨️ REPL** in de kopbalk om het REPL-tabblad te openen. Typ een
expressie (Enter of **Uitvoeren**) of `:def naam ... = ...` voor een
eigen functie/ADT, of `:type <expr>` voor het afgeleide type (via
`engine/typecheck.jmvm`); de belangrijkste commando's hebben ook een eigen
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
`../repl/README.md`'s "Bekende beperkingen").

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
