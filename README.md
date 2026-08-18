# WebSapl — Luie Functionele Programmeertaal & JMVM WebAssembly IDE

**WebSapl** is een complete browser-gebaseerde ontwikkel- en runtime-omgeving voor de luie functionele programmeertaal **Sapl** en de **JMVM** (Jansen's Minimal Virtual Machine) WebAssembly interpreter.

---

## Belangrijkste Functies

- 🚀 **100% Client-side Execution**: Zowel de JMVM interpreter als de Sapl compiler draaien volledig in de browser via WebAssembly (geen server/backend vereist).
- 💾 **Virtueel Bestandssysteem (VFS & IndexedDB)**: Volwaardige ondersteuning voor Sapl File I/O (`readFile`, `writeFile`, `openFile`, `readChar`, etc.). Bestanden in `/workspace` worden automatisch bewaard via IndexedDB.
- ⚡ **Benchmark Suite (12 Kernbenchmarks)**: Draai de 12 geijkte regressietests (`fib`, `primes`, `queens`, `twice`, `knights`, `match`, `sprimes`, `eval`, `hamming`, `sort`, `parsetest`, `prolog`) met één klik ("Run All Benchmarks") en vergelijk realtime metrieken.
- ⏱️ **Realtime Profiler**: Direct inzicht in executietijd (ms), aantal instructies, functiecalls, heapallocaties (`creates`) en garbage collecties.
- 📝 **Moderne Code Editor**: Syntax-highlighting voor Sapl (`.cfp`), multi-tab beheer, auto-indentatie, tabulatie en foutmeldingen.
- 📂 **Bestandsbeheer**: Bestanden aanmaken, uploaden, downloaden en bewerken direct vanuit de bestandsverkenner.

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
