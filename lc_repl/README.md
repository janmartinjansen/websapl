# lc_repl/ (websapl)

Statische, echt-gehoste webversie van `../../lc_repl/lc_repl.cfp` (de
lambda-calculus-REPL op de Scott-encoded self-interpreter), als sibling
van `../selfinter/`, `../graphics.html`, `../studio.html` in deze site.

Anders dan `../selfinter/` (die een eigen, speciaal voor het web
geschreven WASM-reductor met een directe `web_eval`-C-API gebruikt) draait
deze pagina de ECHTE, ongewijzigde `lc_repl.jmvm`-bytecode op de gewone
JMVM WebAssembly-VM (`../engine/jmvm.js`/`jmvm.wasm`), via dezelfde
`RUN`-boodschap aan `../engine/worker.js` die ook `../studio.js`'s
"Run"-knop gebruikt.

## Bestanden

- `index.html` — de pagina zelf (terminal + invoerregel + voorbeeld-chips
  + commando-overzicht).
- `driver.js` — de UI-logica.
- `lc_repl.jmvm` — kopie van `../../lc_repl/lc_repl.jmvm`. Bij een
  wijziging aan `lc_repl/lc_repl.cfp`: opnieuw compileren
  (`./compile lc_repl/lc_repl.cfp` vanuit de repo-root) en opnieuw
  hierheen kopiëren.

## Interactiemodel: geen echte interactieve stdin-stream

De JMVM-WASM-opzet in deze repo (`../engine/worker.js`'s `RUN`-boodschap)
voert een heel stdin-blok in één keer uit en geeft pas na afloop de
volledige uitvoer terug — er is geen mechanisme om `readLine` binnen een
lopend WASM-proces te laten wachten op een teken dat later, na een
gebruikersactie, alsnog binnenkomt (dat zou Asyncify of een vergelijkbare
async-yield-aanpak vereisen, die deze engine niet gebruikt; zelfs de
hoofdwerkbank se eigen Terminal-paneel (`../js/app.js`) werkt zo, en de
Sapl+-REPL (`../repl/`) omzeilt dit heel anders door per regel opnieuw te
COMPILEREN in plaats van één doorlopend proces te laten wachten).

Deze pagina lost dat pragmatisch op: elke ingetypte regel wordt toegevoegd
aan een groeiende regel-lijst, en bij elke nieuwe regel draait de HELE
sessie (met een `quit` erachter) in zijn geheel opnieuw vanaf het begin.
Dat is deterministisch correct (dezelfde regels geven altijd dezelfde
uitvoer) en bij de gemeten instructieaantallen (tientallen- tot
honderdduizenden instructies per sessie, zie
`../../docs/2026-09-23_lc_repl_via_self_interpreter_plan.md`) onmerkbaar
snel — alleen niet letterlijk incrementeel uitgevoerd. Een `quit`-regel
wordt altijd programmatisch toegevoegd, nooit aan de gebruiker
overgelaten: `lc_repl.cfp`'s `readLine` geeft bij een uitgeputte stdin
geen nette EOF terug maar blijft leeg doorlezen (oneindige `"lc> "`-lus),
empirisch gevonden tijdens het bouwen van deze pagina.

## Lokaal draaien

```
cd .. && node server.js 8080
```
en dan `http://localhost:8080/lc_repl/`.
