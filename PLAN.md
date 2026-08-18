# WebSapl: Architectuur- en Implementatieplan

Dit document beschrijft het volledige plan en het technische ontwerp voor **WebSapl**, een moderne, browsergebaseerde ontwikkel- en runtime-omgeving voor de luie functionele programmeertaal **Sapl** en de **JMVM** (Jansen's Minimal Virtual Machine) WebAssembly-engine.

---

## Inhoudsopgave

1. [Visie & Doelstellingen](#1-visie--doelstellingen)
2. [Systeemoversicht & Architectuur](#2-systeemoversicht--architectuur)
3. [Virtueel Bestandssysteem in de Browser](#3-virtueel-bestandssysteem-in-de-browser)
   - *3.1 Hoe Emscripten VFS werkt*
   - *3.2 Koppeling met Sapl File I/O (`readFile`, `writeFile`, `openFile`, etc.)*
   - *3.3 Persistentie via IndexedDB (IDBFS)*
   - *3.4 UI Bestandbeheerder & Upload/Download*
4. [Compiler- & Executiepijplijn in WASM](#4-compiler--executiepijplijn-in-wasm)
   - *4.1 JMVM WebAssembly Runtime & Web Workers*
   - *4.2 Client-side Compilatiestrategie*
   - *4.3 I/O Redirection (Stdout, Stderr, interactieve Stdin)*
5. [Code Editor & Gebruikersprogramma's](#5-code-editor--gebruikersprogrammas)
   - *5.1 Sapl Editor Functionaliteit & Syntax Highlighting*
   - *5.2 Opslaan, Laden & Permalinks*
6. [Benchmark Suite & Voorbeelden](#6-benchmark-suite--voorbeelden)
   - *6.1 De 12 Kernbenchmarks & Voorbeelden*
   - *6.2 Metrieken & Profiling Dashboard*
7. [UI/UX Ontwerp](#7-uiux-ontwerp)
8. [Fasering & Stappenplan](#8-fasering--stappenplan)

---

## 1. Visie & Doelstellingen

Het doel van **WebSapl** is om Sapl direct toegankelijk te maken in elke moderne webbrowser zonder enige installatievereiste:
- **Direct experimenteren**: Schrijf, bewerk en run Sapl-code met directe feedback.
- **Volledige functionaliteit**: 100% client-side uitvoering via WebAssembly; geen zware backend vereist.
- **Volwaardig virtueel bestandssysteem**: Sapl-programma's kunnen bestanden aanmaken, lezen en bewerken via de bestaande `SysCall` FFI-primitieven (`readFile`, `writeFile`, `readChar`, etc.), waarbij bestanden zichtbaar zijn in de UI en bewaard blijven over browserherstarts.
- **Benchmark-laboratorium**: Draai en vergelijk alle 12 standaard JMVM-benchmarks met nauwkeurige tijd-, call-, allocatie- en GC-statistieken.
- **Lokaal opslaan & exporteren**: Beheer van eigen projecten en bestanden in de browser met IndexedDB-persistentie en ZIP/bestand-export.

---

## 2. Systeemoversicht & Architectuur

De applicatie is opgebouwd uit drie samenwerkende lagen:

```
+------------------------------------------------------------------------------------+
|                                    WebSapl UI                                      |
|  +---------------------+  +--------------------------------+  +-----------------+  |
|  |    File Explorer    |  |     Monaco / CodeMirror        |  | Benchmark Suite |  |
|  |  (Virtueel VFS &    |  |  (Sapl Editor met Syntax-      |  | & Voorbeelden   |  |
|  |   IndexedDB sync)   |  |   highlighting & Foutmarkers)  |  |                 |  |
|  +----------+----------+  +---------------+----------------+  +--------+--------+  |
|             |                             |                            |           |
|             +-----------------------------+----------------------------+           |
|                                           |                                        |
|                          +----------------v---------------+                        |
|                          |    Web Worker Bridge / RPC     |                        |
|                          +----------------+---------------+                        |
+-------------------------------------------|----------------------------------------+
                                            | (postMessage / SharedArrayBuffer)
+-------------------------------------------v----------------------------------------+
|                               Web Worker Thread                                    |
|                                                                                    |
|   +----------------------------------------------------------------------------+   |
|   |                   Emscripten Virtual File System (VFS)                     |   |
|   |         /workspace (IDBFS)    |    /tmp (MEMFS)    |   /lib (Stdlib)       |   |
|   +----------------------------------------------------------------------------+   |
|                                         ^                                          |
|                 +-----------------------+----------------------+                   |
|                 |                                              |                   |
|   +-------------v--------------+                +--------------v---------------+   |
|   |     Sapl Compiler          |                |          JMVM WASM           |   |
|   |  - saplcomp.jmvm (WASM)    |  .jmvm byte-   |  (vm.cpp + parser.cpp)       |   |
|   |  - of ama.wasm compiler    | -------------> |  - Lazy Graph Evaluator      |   |
|   |  - pre-compiled bundles    |     code       |  - SysCall FFI (File I/O)    |   |
|   +----------------------------+                +--------------+---------------+   |
|                                                                |                   |
|                                                    stdout / stderr / metrics       |
+----------------------------------------------------------------|-------------------+
                                                                 v
                                                     [Terminal & Output Panel]
```

---

## 3. Virtueel Bestandssysteem in de Browser

### 3.1 Hoe Emscripten VFS werkt
Emscripten bevat een volledige **POSIX-compatibele Virtual File System (VFS)** API in JavaScript en WebAssembly.
Wanneer de C++ code in `vm.cpp` en `parser.cpp` standaard C-functies aanroept zoals:
- `fopen(filepath, mode)`
- `fclose(file)`
- `fread(...)` / `fwrite(...)`
- `fgetc(...)` / `fputc(...)`
- `getline(...)`

worden deze oproepen in de browser automatisch gerouteerd naar het Emscripten VFS.

### 3.2 Koppeling met Sapl File I/O
In Sapl worden I/O-bewerkingen uitgevoerd via de `SysCall` FFI (`_AUX 10 <id>`):
- `readFile filepath` $\rightarrow$ `fopen(..., "rb")` + dynamic string allocatie
- `writeFile filepath content` $\rightarrow$ `fopen(..., "wb")` + `fwrite`
- `openFile path mode` $\rightarrow$ `fopen` met bestandsdescriptor tabel
- `closeFile fd` $\rightarrow$ `fclose`
- `readChar fd` $\rightarrow$ `fgetc`
- `writeChar fd ch` $\rightarrow$ `fputc`
- `readLine` $\rightarrow$ `getline(stdin)`

**Conclusie**: Omdat de WASM VM rechtstreeks gekoppeld is aan het Emscripten VFS, werkt **elke Sapl file-I/O instructie direct en naadloos in de browser**, precies zoals op een native besturingssysteem!

### 3.3 Persistentie via IndexedDB (`IDBFS`)
Standaard bewaart `MEMFS` bestanden in het werkgeheugen (RAM). Om te zorgen dat gebruikersbestanden bewaard blijven bij een pagina-reload of browserherstart:
1. We koppelen de directory `/workspace` aan het **IDBFS** backend van Emscripten:
   ```javascript
   FS.mkdir('/workspace');
   FS.mount(IDBFS, {}, '/workspace');
   ```
2. **Initialisatie bij opstarten**:
   ```javascript
   FS.syncfs(true, (err) => {
       if (!err) console.log("Workspace geladen vanuit IndexedDB");
   });
   ```
3. **Opslaan na wijzigingen of programma-uitvoering**:
   ```javascript
   FS.syncfs(false, (err) => {
       if (!err) console.log("Workspace gesynchroniseerd naar IndexedDB");
   });
   ```

### 3.4 UI Bestandsbeheerder (File Explorer)
In de frontend bouwen we een interactieve bestandsverkenner:
- **Bestandsstructuur**:
  - `/workspace/` — Gebruikersprojecten, opgeslagen `.cfp` broncode en databestanden (persistent via IndexedDB).
  - `/benchmarks/` — De 12 officiële benchmarks (`fib.cfp`, `primes.cfp`, `queens.cfp`, etc.).
  - `/examples/` — Voorbeelden (`fac.cfp`, `hanoi.cfp`, `iotest.cfp`, etc.).
  - `/lib/` — Standaardbibliotheek (`stdlib.cfp`).
  - `/tmp/` — Tijdelijke compilatie-artefacten (`.jmvm`).
- **Functionaliteiten**:
  - Bestand/map aanmaken, hernoemen, dupliceren en verwijderen.
  - Drag-and-drop bestanden uploaden (bijv. tekstbestanden die door Sapl ingelezen moeten worden).
  - Enkel bestand downloaden of gehele workspace exporteren als ZIP.
  - "Live sync": Als een Sapl-programma `writeFile "resultaat.txt" ...` uitvoert, ziet de gebruiker `resultaat.txt` direct in de boomstructuur verschijnen en kan erop geklikt worden om de inhoud te inspecteren.

---

## 4. Compiler- & Executiepijplijn in WASM

### 4.1 JMVM WebAssembly Runtime & Web Workers
Om te voorkomen dat langdurige berekeningen (of recursieve benchmarks) de UI van de browser blokkeren, draait de JMVM in een **Dedicated Web Worker**.

Voordelen van de Web Worker:
- **Responsive UI**: Knoppen, de editor en animaties blijven 60fps soepel.
- **Onderbreekbaarheid**: Een "Stop / Abort" knop kan een oneindige lus direct pauzeren of de worker herstarten.
- **Nauwkeurige profiling**: High-resolution timers (`performance.now()`) zonder hinder van UI rendering overhead.

### 4.2 Client-side Compilatiestrategie
Voor het compileren van `.cfp` (Sapl broncode) naar `.jmvm` (bytecode) zijn er drie complementaire routes:

1. **Self-hosted Sapl Compiler (`saplcomp.jmvm`) in WASM**:
   - De compiler is zelf in Sapl geschreven en gecompileerd naar `saplcomp.jmvm`.
   - Compilatiecyclus:
     1. Schrijf broncode naar `/tmp/input.cfp`.
     2. Voer `saplcomp.jmvm` uit op de WASM VM met stdin: `/tmp/input.cfp\n/tmp/output.jmvm\n`.
     3. Lees gegenereerde `/tmp/output.jmvm` in en run op de VM.
   - Voordeel: 100% pure Sapl-on-WASM pipeline.

2. **C Amanda Compiler (`ama.wasm`) in WASM**:
   - `amasrc/` is pure ANSI C en kan met Emscripten direct gecompileerd worden naar `ama.wasm`.
   - Kan `parser.ama` direct in de browser draaien voor 1-op-1 compatibiliteit met de officiële productiecompiler inclusief geavanceerde strictness-inferentie (`strictness.ama`).

3. **Pre-gecompileerde Bytecode Bundels voor Benchmarks**:
   - De 12 officiële benchmarks en standaardvoorbeelden worden geleverd met zowel hun `.cfp` broncode als vooraf gecompileerde `.jmvm` bytecode.
   - Hierdoor kunnen benchmarks met **0 ms compilatietijd** onmiddellijk draaien.

### 4.3 I/O Redirection & Terminal
- **Stdout/Stderr**: Aangepaste TTY/print functies vangen de `res: ...`, `Elapsed time`, `instr executed`, `calls`, `creates` en `printString` streams op en sturen ze via Worker RPC naar een geïntegreerd terminal-component.
- **Stdin**: Voor interactieve programma's (zoals `arith_repl`, `func_repl` of programma's die `readLine` aanroepen) kan de Web Worker wachten op invoer via een asynchrone message of `SharedArrayBuffer` / `Atomics.wait`.

---

## 5. Code Editor & Gebruikersprogramma's

### 5.1 Sapl Editor Functionaliteit
We integreren een professionele code editor (zoals Monaco Editor of CodeMirror):
- **Sapl Syntax Highlighting**:
  - Sleutelwoorden: `let`, `in`, `case`, `of`, `nomatch`, `where`, `type`, `::`, `#import`.
  - Strictness annotaties (`!arg`, `!x`).
  - Commentaar: `|| commentaar tot einde regel`.
  - Getallen, floats, strings, karakters en constructor-namen (PascalCase).
- **Auto-formatting & Indentation**: Ondersteuning voor Sapl layout en offside regels.
- **Error Diagnostics**: Parse- en syntaxfouten worden inline met rode golflijntjes en tooltips gemarkeerd.
- **Snippet-bibliotheek**: Sjablonen voor datatypes (`::list = Nil | Cons !x xs`), lazy streams, recursieve functies en `SysCall` I/O.

### 5.2 Opslaan, Laden & Permalinks
- **Auto-Save**: Wijzigingen in geopende tabbladen worden continu opgeslagen in de IndexedDB `/workspace`.
- **Projectbeheer**: Eenvoudig wisselen tussen meerdere bestanden via tabbladen.
- **Deelbare URL's (Permalinks)**: Code kan gecomprimeerd worden in de URL hash (bijv. `#code=...`) zodat gebruikers eenvoudig programma's met elkaar kunnen delen via een link.

---

## 6. Benchmark Suite & Voorbeelden

### 6.1 De 12 Kernbenchmarks
De webomgeving bevat een speciale **Benchmark Explorer** tab met de 12 geijkte JMVM regressietests:

| Benchmark | Beschrijving | Verwacht Resultaat |
| :--- | :--- | :--- |
| **`fib`** | Recursieve Fibonacci berekening (fib 40) | `126491971` |
| **`primes`** | Priemgetallenzeef tot 541 (100 priemgetallen) | `Cons 2 (Cons 3 ...)` |
| **`queens`** | 10-Dames probleem (backtracking) | `92` |
| **`twice`** | Hogere-orde functietoepassing ($2^{16}$) | `65536` |
| **`knights`** | Schaakbord Paardensprong (Knight's Tour) | `Cons (Cons 1 ...)` |
| **`match`** | Complexe patroonvergelijking op bomen | `1` |
| **`sprimes`** | Strict prime stream generator | `541` |
| **`eval`** | Luie expressie-evaluator & lambda-calculus | `1024` |
| **`hamming`** | Hamming getallenreeks (lazy stream merge) | `Cons 1 (Cons 2 ...)` |
| **`sort`** | Quicksort / Merge sort op grote lijsten | `1` |
| **`parsetest`**| Functionele parsercombinatoren | `1` |
| **`prolog`** | Mini-Prolog interpreter geschreven in Sapl | `1` |

Daarnaast worden extra voorbeelden meegeleverd: `fac.cfp`, `hanoi.cfp`, `maptest.cfp`, `iotest.cfp`, `lazy_io_test.cfp`, `arith_repl.cfp`, `func_repl.cfp`.

### 6.2 Metrieken & Profiling Dashboard
Bij het draaien van een programma of benchmark toont WebSapl real-time metrieken in een overzichtelijk dashboard:
- ⏱️ **Executietijd**: Tot op milliseconden nauwkeurig (`performance.now()`).
- 🔄 **Instructieteller**: Aantal uitgevoerde bytecode instructies (`instr executed`).
- 📞 **Functie-aanroepen**: Aantal functiecalls (`calls`).
- 📦 **Allocaties / Graph Nodes**: Aantal aangemaakte cellen (`creates`).
- 🧹 **Garbage Collection**: Aantal GC-runs (`nr gc`).
- 📊 **Benchmark Vergelijker**: Mogelijkheid om alle 12 benchmarks achter elkaar te draaien met één klik ("Run All Benchmarks") en de resultaten in een vergelijkende grafiek/tabel weer te geven.

---

## 7. UI/UX Ontwerp

De WebSapl interface wordt ontworpen als een moderne, elegante web-IDE (donkere modus, strakke visuele hiërarchie, flexibele panelen):

```
+-----------------------------------------------------------------------------------------------+
| [Logo] WebSapl IDE   | [▶ Run (F5)] [⚙ Compile] [⏹ Stop] | [📁 Examples ▾] [⚡ Benchmarks ▾]    |
+----------------------+------------------------------------+-----------------------------------+
| BESTANDEN            | [ editor.cfp ]  [ stdlib.cfp ]  [ + ]                                  |
| ▾ workspace          |-----------------------------------------------------------------------|
|   📄 mijn_code.cfp   | 1 | #import "lib/stdlib.cfp"                                          |
|   📄 invoer.txt      | 2 |                                                                   |
|   📄 output.txt      | 3 | start = length (map (\x -> x * 2) (Cons 1 (Cons 2 (Cons 3 Nil)))) |
| ▾ benchmarks         | 4 |                                                                   |
|   📄 fib.cfp         |                                                                       |
|   📄 primes.cfp      |                                                                       |
|   📄 queens.cfp      |                                                                       |
| ▾ lib                |                                                                       |
|   📄 stdlib.cfp      |                                                                       |
+----------------------+-----------------------------------------------------------------------+
| TERMINAL / OUTPUT                                                 | PERFORMANCE STATS         |
| > VM starting for /workspace/mijn_code.jmvm                       | ⏱️ Tijd:        0.04 ms   |
| > res: 3                                                          | 🔄 Instructies: 842       |
| > Execution finished successfully.                                | 📞 Calls:       12        |
|                                                                   | 📦 Allocaties:  18        |
+-------------------------------------------------------------------+---------------------------+
```

---

## 8. Fasering & Stappenplan

### Fase 1: Build Pijplijn & WASM Emscripten Module
- [ ] Compileren van `vm.cpp` en `parser.cpp` naar een standalone browser-compatibele WebAssembly module (`websapl/engine/jmvm.wasm`, `websapl/engine/jmvm.js`) met IDBFS en MEMFS ingeschakeld.
- [ ] Implementeren van Web Worker wrapper (`websapl/engine/worker.js`) voor veilige, non-blocking uitvoering.
- [ ] Testen van VFS file I/O primitieven (`readFile`, `writeFile`) in de browseromgeving.

### Fase 2: Bestandsbeheer & IndexedDB Integratie
- [ ] Opzetten van het virtuele bestandssysteem met `/workspace` gemount via `IDBFS`.
- [ ] Bouwen van de bestandsverkenner UI component (aanmaken, bewerken, uploaden, downloaden, ZIP-export).
- [ ] Automatische synchronisatie tussen de editor, het VFS en de schijf/browseropslag.

### Fase 3: Editor & UI Schil
- [ ] Integratie van code-editor met Sapl syntax highlighting en bracket-matching.
- [ ] Bouwen van tabbladenbeheer voor meerdere geopende bestanden.
- [ ] Bouwen van het console/terminal component met kleurcodering voor output, runtime fouten en returnwaarden.
- [ ] Real-time statusbalk en statistiekenpaneel (executietijd, calls, instructies, geheugen).

### Fase 4: Compiler Integratie & Benchmark Suite
- [ ] Integreren van de self-hosted `saplcomp.jmvm` / `ama.wasm` in de browser voor directe client-side compilatie.
- [ ] Bundelen van alle 12 gecompileerde benchmarks en standaardvoorbeelden.
- [ ] Implementeren van de "Run All Benchmarks" testsuite met vergelijkingstabel.

### Fase 5: Verfijning, Documentatie & Deploy
- [ ] Ondersteuning voor interactieve REPL invoer (`readLine`).
- [ ] URL permalink generator voor het delen van code snippets.
- [ ] Productiebuild en documentatie voor hosting op GitHub Pages of static hosting.
