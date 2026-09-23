|| self_interpreter.fp -- ongewijzigd overgenomen van saplsimple_num/lam25.fp
|| (JM Jansen, 2024-2025): een self-interpreter voor uitgebreide lambda
|| calculus (functies met namen en getallen).
||
|| Scott-encoding van lambda-termen: Var s | App e e | Abs e | Lit e.
|| seval maakt van zo'n representatie de functie die de representatie
|| representeert -- "interpreteren" is hier letterlijk "instantiëren":
|| een Abs-knoop wordt een échte functie, een Var-knoop selecteert het
|| bijbehorende element uit de bindings-lijst, een App-knoop wordt de
|| toepassing van de twee geïnterpreteerde delen.
||
|| vbfac/efacvb coderen de faculteitsfunctie zelf als zo'n Scott-encoded
|| term; testfac = seval vbfac is dan de teruggewonnen, echt draaiende
|| functie.
||
|| Draaien: echo 'print 0 (testfac 6) ""' | ./sapl examples/self_interpreter.fp
|| -> 720
|| Ook: echo 'printPrimes 30 testprimes' | ./sapl examples/self_interpreter.fp
|| -> 110101000101000101000100000101 (de priemzeef, via seval teruggewonnen)
|| En de volledig ingevouwen één-regelversie (minimal_primes.fp's primes/pp):
|| echo 'printPrimesB 30 testprimesOneliner' | ./sapl examples/self_interpreter.fp
|| -> 110101000101000101000100000101 (zelfde uitkomst, andere codering)

|| Wat hulp functies: bv lijsten
cons h t f = f h t
nil        = 0

el n ls = ls (\h t. (eq n 1) h (el (sub n 1) t))

|| Scott-encoding van datastructuur voor lambda expressies: expr ::= Var s | App expr expr | Abs expr | Lit e
|| Lit is toegevoegd voor letterlijke encoding, bv getallen en operaties erop worden als zichzelf gecodeerd
|| makeSel n maakt van n een functie die het n-de element in een lijst selecteert (ipv el gebruiken)
var n   f g h k = f (makeSel n)
app a b f g h k = g a b
abs t   f g h k = h t
lit e   f g h k = k e

|| seval maakt van een representatie de functie die de representatie representeert!
|| een variabele selecteert het bijbehorende element uit de bindings
|| een applicatie wordt omgezet naar een appliactie van de elementen
|| een abstractie wordt omgezet naar een functie, waarbij het argument in de bindings wordt gezet
seval f      = makeLam f nil
makeLam e bs = e (\n . n bs) (\a b . (makeLam a bs) (makeLam b bs)) (\t . addBind t bs) (\f . f)
addBind t bs = \x . makeLam t (cons x bs)

|| voorbeelden
vb1 = abs (var 1)
vb2 = abs (abs (app (var 2) (var 1)))
vb3 = app (abs (var 1)) (abs (var 1))
vb4 = abs (abs (abs (app (var 1) (app (var 2) (var 3)))))
vb5 = abs (abs (abs (app (app (var 1) (var 2)) (var 3))))
vb6 = app (var 1) (var 2)
vb7 = abs (abs (app (app (lit sub) (var 2)) (var 1)))

vbsub = abs (abs (app(app (lit sub) (var 2)) (var 1)))
vbsub2 = app vbsub (lit 5)

|| een uitgebreider voorbeeld: de faculteits functie, zijn codering en de test of het klopt
fac   = \n . (eq n 0) 1 (mult n (fac (sub n 1)))

vbfac  = abs (app (app (app (app (lit eq) (var 1)) (lit 0)) (lit 1)) efacvb)
efacvb = app (app (lit mult) (var 1)) (app vbfac (app (app (lit sub) (var 1)) (lit 1)))

testfac = seval vbfac

test = testfac 5

lst = cons 1 (cons 2 (cons 3 (cons 4 nil)))

i f xs = xs (\ h t . f t)
s1 xs  = xs (\ h t . h)
s2     = i s1
s3     = i s2

makeSel n = (eq n 1) s1 (i (makeSel (sub n 1)))

|| De priemzeef (examples/minimal_primes.fp) als self-interpreter-voorbeeld.
|| u/ustart is de "losse delen"-versie (I/D/r i.p.v. de volledig ingevouwen
|| primes = (\p.p p)(\p d c. ...)): ustart = u u D, waarbij u zelfstandig is
|| (I zit er al in verwerkt, anders dan p dat ook nog s en i nodig heeft).
|| I/D/r worden hier zelf óók gecodeerd (Var/App/Abs, net als vb1..vb7);
|| alleen c (het paar/cons-primitief van minimal_primes.fp) en de getallen
|| 0/1 blijven Lit-primitieven, precies zoals sub/mult/eq dat voor vbfac
|| zijn. De zelftoepassing u u zit op het Sapl-niveau (net als testfac
|| geen Y-combinator in de codering zelf nodig heeft: vbfac/efacvb delen
|| gewoon dezelfde knoop, hier is het de expliciete zelftoepassing).
c a b f = f a b

vbr = abs (abs (app (var 1) (app (app (var 2) (var 2)) (var 1))))
vbI = abs (abs (abs (abs (app (app (var 1) (var 3)) (app (var 2) (var 4))))))
vbD = abs (abs (abs (abs (app (app (var 1) (lit 0)) (app (var 2) (var 4))))))

vbu = abs (abs (app (app (lit c) (lit 1))
                     (app (abs (app (app (app (var 3) (var 3)) (var 1))
                                     (app (app vbr vbr) (var 1))))
                          (abs (app vbI (app (var 2) (var 1)))))))

testprimes = (seval vbu) (seval vbu) (seval vbD)

|| ustart geeft priem-informatie via numerieke koppen (I/D's 0/1), niet
|| via booleaanse selectoren zoals primes/pp -- vandaar deze eigen printer
|| i.p.v. minimal_primes.fp's printlist (zie ook dat bestand's commentaar).
printPrimes n ls = (eq n 0) "" (ls (\h t . print 0 h (printPrimes (sub n 1) t)))

|| En nu de volledig ingevouwen één-regelversie zelf, ook echt als één
|| Sapl-definitie (geen losse vbY/vbZ/vbARG1/... namen meer) -- net zoals
|| minimal_primes.fp's eigen primes/pp één definitie is die toevallig over
|| meerdere fysieke regels loopt.
||   primes = (\p.p p) ARG1 ARG2
||   ARG1   = \p d c. c (\f t.t) (Y Z)
||     Y    = \n. p p n ((\r.r r)(\r. n (r r)))       || zelfde p&s-truc
||     Z    = \a. (\g k s c. c k (s g)) (d a)         || \g k s c.c k(s g) is I
||   ARG2   = \g k s c. c (\f t.f) (s g)
|| (Y Z)'s r-fixpunt is hier de M-combinator (\r.r r) i.p.v. de losse
|| delen se genoemde r/I/D/u -- geen Lit-primitieven nodig, ook geen
|| numerieke 0/1: de koppen zijn de booleanse (\f t.t)/(\f t.f) uit
|| primes/pp zelf. \g k s c.c k (s g) is dezelfde I-vorm als vbI
|| hierboven, hier ter plekke herhaald (geen losse naam voor deze versie).
|| Anders dan bij testprimes hierboven staat (\p.p p) hier ook zelf als
|| data gecodeerd (abs (app (var 1) (var 1))) i.p.v. als kale Sapl-lambda
|| die om de seval'de stukken heen zit -- ARG1/ARG2 zijn zelf al gesloten
|| termen, dus ze passen zonder index-verschuiving als kinderen in één
|| grotere app/app. Dan hoeft seval maar één keer: heel primes, inclusief
|| zijn eigen zelftoepassing, is hier van begin tot eind data die in één
|| stap wordt opgetild tot een draaiende functie.
testprimesOneliner = seval
  (app (app (abs (app (var 1) (var 1)))              || \p.p p, nu zelf óók data
            (abs (abs (abs (
              app (app (var 1) (abs (abs (var 1))))                 || c (\f t.t)
                  (app (abs (app (app (app (var 4) (var 4)) (var 1)) (app (abs (app (var 1) (var 1))) (abs (app (var 2) (app (var 1) (var 1)))))))                                 || Y = \n. p p n (...)
                       (abs (app (abs (abs (abs (abs (app (app (var 1) (var 3)) (app (var 2) (var 4))))))) (app (var 3) (var 1)))))                                || Z = \a. I (d a)
            )))))
       (abs (abs (abs (abs (
         app (app (var 1) (abs (abs (var 2)))) (app (var 2) (var 4))  || c (\f t.f) (s g)
       ))))))

|| boolean-koppen (T/F-achtig), dus een andere printer dan printPrimes.
printPrimesB n ls = (eq n 0) "" (ls (\h t . h (print 1 "0") (print 1 "1") (printPrimesB (sub n 1) t)))
