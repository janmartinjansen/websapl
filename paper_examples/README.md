# IFL 2016 Paper Voorbeelden

Deze map bevat alle kernvoorbeelden en het originele onderzoekspaper:
**"A Portable VM-based implementation Platform for non-strict Functional Programming Languages"**
*(Jan Martin Jansen & John van Groningen, IFL 2016)*

Het volledige paper is direct in de editor te openen als [`main.pdf`](main.pdf).

## Overzicht van de voorbeelden

| Bestand | Paper Referentie | Concept |
| :--- | :--- | :--- |
| `main.pdf` | **IFL 2016 Paper** | Het volledige gepubliceerde paper |
| `01_fac.cfp` | Figuur 2 & 6 | Strikte faculteit (`!n`), directe evaluatie |
| `02_facl.cfp` | Figuur 2, 4, 5 & 7 | Luie faculteit (`facl_1` lambda lifting & thunks) |
| `03_twice.cfp` | Figuur 2, 3 & 5 | Hogere-orde functies (`twice f x = f (f x)`) |
| `04_twicex.cfp` | Figuur 2 & 9 | Overgesatureerde curried keten (`twicex = twice twice twice twice inc 0` = 65536) |
| `05_sieve.cfp` | Figuur 2, 3 & 5 | Zeef van Eratosthenes op eindige lijst [2..7] |
| `06_primes.cfp` | Figuur 2 & 8 | Oneindige stroom priemgetallen (`from`, `sieve`, `el`) |
| `07_hamming.cfp` | Figuur 2, 3 & 5 | Hamming getallen met 3-wegs mutuele cyclus |
| `08_pair_cycle.cfp` | Sectie 5.2 | Minimale 2-wegs mutuele cyclus met `update` (`[1, 2, 1, 2, ...]`) |
| `09_let1.cfp` | Sectie 5.2 | Acyclische `let`-expressies & slotallocatie |
| `10_let2.cfp` | Sectie 5.2 | Topologische sortering van omgekeerd gedeclareerde `let`-bindingen |
| `11_let3.cfp` | Sectie 5.2 | Gemengde strikte (`!`) en luie bindingen binnen één `let` |
