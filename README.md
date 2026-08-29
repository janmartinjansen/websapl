# WebSapl — Luie Functionele Programmeertaal & JMVM WebAssembly IDE

**WebSapl** is een complete browser-gebaseerde ontwikkel- en runtime-omgeving voor de luie functionele programmeertaal **Sapl** en de **JMVM** (Jansen's Minimal Virtual Machine) WebAssembly interpreter.

---

## Belangrijkste Functies

- 🚀 **100% Client-side Execution**: Zowel de JMVM interpreter als de Sapl compiler draaien volledig in de browser via WebAssembly (geen server/backend vereist voor het compileren/draaien zelf — `server.js` serveert alleen de statische bestanden).
- 💾 **Virtueel Bestandssysteem (VFS & IndexedDB)**: Volwaardige ondersteuning voor Sapl File I/O (`readFile`, `writeFile`, `openFile`, `readChar`, etc.) *vanuit draaiende Sapl-programma's*. Bestanden die zo'n programma zelf wegschrijft, blijven via IndexedDB bewaard tussen sessies.
- 🔤 **Sapl+ (`.spp`) preprocessing**: `.spp`-bestanden (een kleine Haskell/Clean-achtige uitbreiding — lambda's, guards, ZF-expressies, patroon-definities) worden met één knop naar gewone Sapl (`.cfp`) vertaald, zelf ook in de browser via WebAssembly.
- ⏱️ **Realtime Profiler**: Direct inzicht in executietijd (ms), aantal instructies, functiecalls, heapallocaties (`creates`) en garbage collecties, na elke run.
- 📝 **Moderne Code Editor**: Syntax-highlighting voor Sapl (`.cfp`/`.spp`), multi-tab beheer, auto-indentatie, tabulatie en foutmeldingen (via CodeMirror).
- ✏️ **Bewerken & opslaan**: bestanden rechtstreeks in de browser bewerken; "Opslaan" bewaart je wijziging in `localStorage` van je eigen browser (blijft dus lokaal, wordt niet teruggeschreven naar de repo).

---

## Hoe te gebruiken

1. **Bestandsverkenner (links)** — alle mappen staan bij het openen dicht; klik
   op een map om 'm uit te klappen, en op een bestand om het te openen. De
   originele bronbestanden (`.cfp`, `.spp`) staan er altijd; alles wat je zelf
   kunt genereren door te compileren/preprocessen (`.jmvm`, tussenformaten)
   ontstaat pas zodra je daarop klikt — dat houdt de boom overzichtelijk.
2. **Een `.cfp`-bestand compileren** — open het bestand, kies rechts een
   **Compiler Backend** (`saplcomp`, de zelf-hostende Sapl-compiler in
   WebAssembly; of `retagcomp` voor Stage-4 Retag-bestanden), zet eventueel
   **Strictness Analyse** aan/uit, en kies welke **Tussenformaten (Stages)**
   je wilt zien naast de uiteindelijke `.jmvm`-bytecode (bijv. `parse`,
   `lift`, ...) — handig om de compiler-pipeline stap voor stap te
   inspecteren. Klik dan **Compileer** (alleen bouwen), **Compileer & Run**
   (bouwen en meteen uitvoeren), of **Run** (een reeds gecompileerd `.jmvm`
   bestand draaien).
3. **Een `.spp`-bestand (Sapl+) gebruiken** — open het bestand en klik op
   **Preprocess (.spp → .cfp)**. Dat zet de Sapl+ syntax om naar gewone Sapl
   en opent het resultaat als nieuw `.cfp`-tabblad; vanaf daar werkt stap 2
   hierboven precies zoals altijd.
4. **Terminal & metrieken (onder)** — toont compiler- en programma-uitvoer,
   en na elke run de metrieken (`res`, tijd, instructies, calls, creates, gc).
   Programma's die stdin lezen kun je invoer sturen via de prompt-balk
   onderaan.
5. **Graphics Studio** (rechtsboven) — een aparte pagina om de `.cfp`-
   programma's in `grafisch/` visueel te draaien.

Zie ook `parser_combinators/README.md` voor meer over Sapl+ specifiek, en
`paper_examples/README.md` voor de voorbeelden uit het onderliggende paper.

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
