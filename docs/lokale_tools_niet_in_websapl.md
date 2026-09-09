# Linter & VM-debugger: waarom die niet in WebSapl zitten

Sinds 9 september 2026 heeft de **lokale** [Workbench](../../workbench/README.md)
(`workbench/`, gestart via `./start_workbench`) twee extra tabs: een
**Linter** en een **VM Trace Debugger**. Dit document legt uit waarom die
twee tabs hier in WebSapl niet bestaan, en waar je ze wél kunt vinden.

## Het verschil zit in de architectuur, niet in ontbrekende tijd

WebSapl is expres **100% client-side**: de JMVM-interpreter en de
Sapl-compiler draaien beide als WebAssembly in je browser, en
`websapl/server.js` doet niets anders dan statische bestanden serveren (zie
[`../README.md`](../README.md)). Er is geen server-side proces dat iets voor
je kan uitvoeren.

De twee nieuwe Workbench-tabs zijn juist gebouwd rond precies zo'n
server-side proces:

- **Linter** draait [`linter/sapl_lint.py`](../../linter/sapl_lint.py), een
  standaard Python-script — er is geen Python-runtime in de browser
  beschikbaar (geen Pyodide of vergelijkbaar meegebouwd).
- **VM Trace Debugger** draait `runswitch-debug`, een apart, native
  gecompileerde C++-build van de VM (`-DSWITCH_CASE -DDEBUG_CHECKS`, zie
  [`docs/2026-09-09_vm_trace_debugger_en_ai_diagnose_plan.md`](../../docs/2026-09-09_vm_trace_debugger_en_ai_diagnose_plan.md))
  die naar het echte bestandssysteem schrijft (een crash-trace-bestand, een
  JSON-trace) — geen van beide is iets wat de WASM-VM in de browser-sandbox
  kan of zou moeten doen.

Beide zijn dus geen missende features van WebSapl, maar bewust
architectuur-specifiek: precies het soort taak waarvoor Workbench bestaat
naast WebSapl.

## Waar je ze wél kunt gebruiken

Start de lokale Workbench (heeft een echte Node.js-omgeving nodig, dus niet
vanuit een puur statische hosting van deze `websapl/`-map):

```bash
cd <repo-root>
./start_workbench
```

Zie [`workbench/README.md`](../../workbench/README.md) voor de volledige
uitleg van beide tabs, of `CLAUDE.md`'s sectie "Bij een segfault, hang, of
stil fout resultaat" voor de terminal-versie van dezelfde workflow
(`runswitch-debug` en `debugger/difftrace.py` rechtstreeks, zonder UI).
Kant-en-klare voorbeeldbestanden om meteen mee te proberen (bewuste
lint-fouten, resp. een bewuste crash en hang) staan in
[`linter/examples/`](../../linter/examples/) en
[`debugger/examples/`](../../debugger/examples/).

## Wat WÉL client-side blijft werken

De replay-viewer zelf (`debugger/viewer/trace_viewer.html`) is een
losstaande, statische HTML/JS-pagina zonder build-stap of server — die kun
je ook los openen en een `.jsonl`-trace laden die je lokaal met
`runswitch-debug` hebt opgenomen. Alleen het *opnemen* van die trace vereist
de lokale Workbench of de terminal.
