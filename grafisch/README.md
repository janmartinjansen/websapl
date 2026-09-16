# Graphics-demo's

`.cfp`-programma's die tekeningen produceren via een klein, generiek
`::Graphics`-ADT (`GraphPolyLine`/`GraphPolygon`/`GraphRectangle`/
`GraphEllipse`/`GraphDisc`/`GraphText`/`GraphMenu`/`GraphPrompt`/
`GraphClear`) i.p.v. rechtstreeks canvas-aanroepen — het programma zelf
weet niets van HTML/canvas, het bouwt alleen deze waardes op en de
Graphics Studio-pagina tekent ze.

**Zelf proberen: gebruik de aparte Graphics Studio-pagina** (rechtsboven
in WebSapl, of rechtstreeks `graphics.html`), niet het gewone
"Compileer & Run" in de hoofdeditor — die toont alleen tekstoutput,
Studio interpreteert de `Graphics`-waardes en tekent ze op een canvas,
inclusief muis-events voor de interactieve programma's.

## Bestanden

| Bestand | Wat je ziet |
|---|---|
| `graphics.cfp` | Gedeelde basis: het `::Graphics`-ADT en helperfuncties — door de andere bestanden hieronder geïmporteerd, zelf geen `start` |
| `boom.cfp` | Recursief getekende boom (fractal-achtige aftakkende lijnen) |
| `bspline.cfp` | Cubic B-spline-curve door een reeks controlepunten |
| `convex.cfp` | Convex hull van een puntenwolk in 3D, geprojecteerd |
| `curves.cfp` | Diverse geometrische krommen als lijst-van-polylijnen |
| `recpic.cfp` | Recursief opgebouwde patronen uit kleine `point`/`to`-bouwstenen |
| `grafiek.cfp` | Functie-plotter: bemonstert een wiskundige functie tussen twee grenzen en tekent de grafiek |
| `menu_demo.cfp` | Kleinste interactieve voorbeeld: een menubalk die het laatst geklikte item terug-echoot |
| `grafiek_paint_interactive.cfp` | Interactief tekenprogramma (muis-events, figuren verplaatsen/selecteren) |
| `hwdes.cfp` | Groter interactief voorbeeld, poort van het originele Amanda `HWDES.AMA`-programma |

Zie ook `docs/sapl_taalgids.md` voor de taal zelf; deze map bouwt puur op
gewone Sapl-ADT's en -functies, geen aparte syntax.
