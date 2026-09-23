|| minimal_primes.fp -- ongewijzigd overgenomen van saplsimple_num/t24b.fp
|| (auteursdatum onbekend, ruim voor 2024). De minimalistische priemzeef:
|| "primes" is rechtstreeks (\p.p p) (\p d c. ...) -- zelftoepassing,
|| geen enkele genoemde recursieve functie. Verwante varianten bestaan
|| elders in hetzelfde archief (saplsimple_num/primes.fp, tromp.fp/
|| tromp2.fp, naar John Tromp's bekende minimale lambda-calculus-priemzeef).
||
|| printlist bouwt een bitstring: teken i (vanaf n=2) is '1' als n een
|| priemgetal is. #!/#0/#1 zijn het originele, ongewijzigde PRINT-
|| mechanisme (een letterlijk teken, vastgelegd bij het parsen -- zie
|| ../README.md's uitleg van #c versus dit bestand se eigen print).
||
|| Draaien: echo 'printlist 30 primes' | ./sapl examples/minimal_primes.fp
|| -> 110101000101000101000100000101 (posities 2..31; 1 = priem)
||
|| Het restant van dit bestand (I/D/r/i/u/t/q/p/s/start/ustart) is
|| onveranderd overgenomen scratchwerk uit hetzelfde archief -- een
|| tussenstap naar dezelfde zeef met genoemde functies i.p.v. pure
|| zelftoepassing. start/ustart werken wel degelijk (geen foutmelding,
|| dat was een eerdere onjuiste aanname hier) -- alleen printlist past
|| er niet op: I/D geven een NUMERIEKE kop (0/1), terwijl primes/pp's
|| eigen c (\f t.t)/c(\f t.f) een BOOLEAANSE kop geven (T/F), en
|| printlist verwacht juist die laatste vorm (h #0 #1 ...). Met een
|| numerieke printer werken start en ustart identiek aan primes:
||   pl n ls = (eq n 0) "" (ls (\h t . print 0 h (pl (sub n 1) t)))
||   echo 'pl 30 ustart' | ./sapl examples/minimal_primes.fp
||   -> 110101000101000101000100000101 (zelfde uitkomst als primes/pp)
|| (pl zit hier niet in het bestand zelf, want alleen printlist +
|| #!/#0/#1 zijn het "ongewijzigd overgenomen" origineel -- zie
|| examples/self_interpreter.fp voor waar u/ustart wél verder gaat:
|| daar wordt precies deze losse-delenversie als Scott-encoded term
|| gecodeerd en via seval teruggewonnen.)

primes = (\p.p p)
               (\p d c.c (\f t.t) ((\n.p p n ((\r.r r) \r.n (r r)))     || p & s
                                    \a.(\g k s c.c k (s g)) (d a)))     || \a.I (d a)
                   \g k s c.c(\f t.f)(s g)                              || D

pp = (\p.p p)
               (\p d c.c (\f t.t) ((\n.p p n ((\r.r r) \r.n (r r)))     || p & s
                                    \a k s c.c k (s (d a))))            || \a.I (d a)
                   \g k s c.c(\f t.f)(s g)                              || D



I = \f h t c . c h (t f)
D = \f h t c . c 0 (t f)

r = \r f . f (r r f)

i = \n a . I (n a)


u = \p n . c 1 ((\n . p p n (r r n)) (\a . I (n a)))
t = \p n . c 1 ((\n . p p n (r r n)) ((\n a . I (n a)) n))
q = \p n . c 1 ((\n . p p n (r r n)) (i n))

p = \p n . c 1 (s p (i n))
s = \p n . p p n (r r n)

start  = p p D
ustart = u u D

c a b f = f a b
take n ls = ls \h t. eq n 0 99 (c h (take (sub n 1) t))

printlist n ls = (eq n 0) (#! ) (ls (\h t .  h #0 #1 (printlist (sub n 1) t)))

len ls = (eq ls 0) 0 (add 1 (ls (\h t . len t)))
T x y = x
F x y = y
