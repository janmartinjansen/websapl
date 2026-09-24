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
- `transcript.js` — pure parser die de uitvoer van één run opknipt per
  invoerregel (los van de UI, zodat hij in Node te testen is).
- `lc_repl.jmvm` — kopie van `../../lc_repl/lc_repl.jmvm`. Bij een
  wijziging aan `lc_repl/lc_repl.cfp`: opnieuw compileren
  (`./compile lc_repl/lc_repl.cfp` vanuit de repo-root) en opnieuw
  hierheen kopiëren.

## Interactiemodel: geen echte interactieve stdin-stream

De JMVM-WASM-opzet in deze repo (`../engine/worker.js`'s `RUN`-boodschap)
voert een heel stdin-blok in één keer uit en geeft pas na afloop de
volledige uitvoer terug. Er is geen mechanisme om `readLine` binnen een
lopend WASM-proces te laten wachten op invoer die later pas binnenkomt
(daarvoor zou Asyncify of iets vergelijkbaars nodig zijn).

Daarom is elke invoer een verse run met als stdin:

1. alle eerder gelukte `naam = ...`-regels, in volgorde en inclusief
   dubbele namen (`lc_repl` plakt een binding er al bij het parsen in, dus
   `a = 1`, `b = a`, `a = 2` moet precies zo terugkomen);
2. de nieuwe regel(s);
3. een `quit`-regel. `lc_repl`'s `readLine` geeft bij een uitgeputte
   stdin geen EOF maar blijft eindeloos `"lc> "` printen.

Eerdere `:nf`/`:seval`/`:bits`/...-regels worden niet opnieuw gedraaid:
die veranderen de sessie niet, en hun uitvoer staat al op de pagina. Een
dure regel draait dus maar één keer.

`transcript.js` knipt de uitvoer van een run op bij de `lc> `-prompts en
koppelt elk stuk aan zijn invoerregel. `driver.js` toont elke regel
met zijn uitvoer eronder.

- **Een fout** (onbekende variabele, onbekend `:commando`, ...) stopt de VM
  op die regel. De pagina toont de foutmelding in rood bij die regel. De
  regel komt niet in de sessie, dus de volgende invoer werkt gewoon
  verder. Faalt één regel van een meerregelige voorbeeldknop, dan worden
  de regels daarna als "niet uitgevoerd" getoond.
- **Een divergente term** (bv. `:nf` op een term zonder normaalvorm) komt
  nooit terug uit de worker. Na 60 s stopt `driver.js` de worker
  (`terminate()`) en start een nieuwe. De sessie blijft zoals hij was.

## Testen

`transcript.js` is een pure functie en werkt ook in Node
(`require("./transcript.js").parseTranscript(uitvoer, nReplay, nNieuw)`).
Native `./run lc_repl/lc_repl.jmvm`-uitvoer heeft hetzelfde formaat als de
WASM-uitvoer (zelfde `vm.cpp`). Op 24 september 2026 is de hele pagina
ook in headless Chrome doorgelopen: `:seval`, `:bits`, `:db`, `:scott`,
een fout, een foute binding, en de 60 s-timeout met herstart van de worker.

## Lokaal draaien

```
cd .. && node server.js 8080
```
en dan `http://localhost:8080/lc_repl/`.
