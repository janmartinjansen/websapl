# Sapl+ demo

`sapl_plus_showcase.spp` laat vier van Sapl+'s belangrijkste
syntaxuitbreidingen zien t.o.v. kale Sapl, elk in een paar regels. Dit
document legt per feature uit wat de syntax betekent en — het interessante
deel — hoe de pre-processor (`preprocess/`, zelf in Sapl geschreven,
self-hosted) het daadwerkelijk afbeeldt op gewone Sapl vóórdat
`parser.ama`/`saplcomp.jmvm` het ooit ziet. De gegenereerde `.cfp`-
fragmenten hieronder zijn de ECHTE output (`sapl_plus_showcase.cfp`), met
de auto-gegenereerde `__pat_N`-variabelen hernoemd naar iets leesbaars.
Volledige taalgids, met alle randgevallen:
`docs/spp_taal_en_parser_combinators.md`.

Zelf proberen: `printf 'sapl_plus_demo/sapl_plus_showcase.spp\nuit.cfp\n' |
./run preprocess/driver.jmvm` (vanuit de repo-root), of open het bestand in
WebSapl/Workbench en klik op "Preprocess (.spp → .cfp)" — daarna opent het
resultaat als gewoon `.cfp`-tabblad en werkt "Compileer"/"Compileer & Run"
zoals altijd.

## 1. Lambda-expressies

```sapl
doubled = mapL (\x -> x * 2) [1, 2, 3, 4]
```

Een `\x -> ...` heeft in kale Sapl geen eigen syntax; de pre-processor
*lift* 'm naar een verse top-level functie en vervangt de lambda door een
verwijzing daarnaar:

```sapl
doubled = mapL __lam_0 (Cons 1 (Cons 2 (Cons 3 (Cons 4 Nil))))
__lam_0 __pat_23 = __pat_23 * 2
```

Sluit de lambda over een vrije variabele (bijv. een buitenste functie-
parameter), dan krijgt de gelifte functie die variabele als extra, leidend
argument mee — de aanroepplek geeft 'm dan gewoon door.

## 2. Lijst-comprehensies (ZF)

```sapl
pairs = [ x * 10 + y | x <- [1..3], y <- [1..3], x != y ]
```

Elke generator wordt zijn eigen recursieve "loop"-functie, geneste
generatoren nesten die functies in elkaar (de binnenste sluit over de
buitenste se gebonden variabele), en een filter-conditie wordt een `if`
in de binnenste loop die niet-passende elementen overslaat zonder ze aan
het resultaat toe te voegen:

```sapl
pairs = __zf_1 Nil (__rangeStepGo 1 1 3)
__zf_1 acc xs = case xs (Nil -> acc) (Cons x rest -> __zf_3 x (__zf_1 acc rest) (__rangeStepGo 1 1 3))
__zf_3 x acc ys = case ys
  (Nil -> acc)
  (Cons y rest -> if (x != y) (Cons ((x * 10) + y) (__zf_3 x acc rest)) (__zf_3 x acc rest))
```

(`[1..3]` — de range-syntax — desugart zelf ook, naar een kleine gedeelde
stap-functie `__rangeStepGo start step eind`.)

## 3. `mapPair`: ZF met een constructor-patroon als generator

```sapl
mapPair f prs = [ f a b | (Pair a b) <- prs ]
```

De generator hoeft geen kale variabele te zijn — een constructor-patroon
mag ook, en een element dat niet bij dat patroon past (hier: `NoPair`)
wordt **stilzwijgend overgeslagen**, precies zoals in Haskell/Clean, geen
foutmelding:

```sapl
mapPair f prs = __zf_6 f Nil prs
__zf_6 f acc xs = case xs
  (Nil -> acc)
  (Cons el rest -> case el
    (Pair a b -> Cons (f a b) (__zf_6 f acc rest))
    (_        -> __zf_6 f acc rest))
```

`somePairs` bevat bewust een `NoPair` tussen twee `Pair`s in — `pairSums`
(res: `33`, niet meer) bewijst dat 'ie echt wordt overgeslagen.

## 4. `merge`: patroon-definities met meerdere clausules + guards, en `:` als expressie

```sapl
merge Nil ys = ys
merge xs Nil = xs
merge (x:xs) (y:ys)
  | x <= y    = x : merge xs (y:ys)
  | otherwise = y : merge (x:xs) ys
```

Sapl zelf kent maar **één** clausule per functienaam (CLAUDE.md /
`docs/sapl_programmeer_regels.md`) — de pre-processor's decision-tree-
compiler (`patcompile.cfp`) versmelt alle clausules van `merge` tot één
geneste `case`/`if`-boom, kolom voor kolom van links naar rechts, en
guards worden gewoon een `if`-keten in het bereikte blad. `:` was tot 29
augustus 2026 alleen geldig als patroon (links van `=`); sindsdien werkt
'ie ook als expressie (rechtsassociatief, prioriteit tussen `==`/`<=` en
`+`/`-`, net als Haskell's `infixr 5`) en desugart naar precies dezelfde
`Cons`-aanroep:

```sapl
merge p1 p2 = case p1
  (Nil -> case p2 (Nil -> p2) (_ -> p2))
  (Cons x xs -> case p2
    (Nil -> p1)
    (Cons y ys -> if (x <= y) (Cons x (merge xs (Cons y ys)))
                              (Cons y (merge (Cons x xs) ys))))
```

(Vereenvoudigd voor de leesbaarheid — de variabelen zijn hernoemd en de
buitenste `case` heeft in het echte gegenereerde bestand ook nog een
defensieve, in de praktijk onbereikbare `_`-catch-all-tak naast `Nil`/
`Cons`, want `patcompile.cfp` vult altijd alle constructoren van de ADT
aan, ook al is het patroon al uitputtend.)

`sumList`/`mapL` in dit bestand zijn dezelfde truc in zijn eenvoudigste
vorm: twee clausules (`Nil` / `(x:xs)`) versmolten tot één `case`.

---

Alle vier de resultaten (`res:`-waarden bij het draaien): `20`, `132`,
`33`, `28` — zie `sumList`-aanroepen in `start`.
