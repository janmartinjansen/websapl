|| sieve.fp -- de klassieke zeef van Eratosthenes, algoritme ongewijzigd
|| overgenomen van saplsimple_num's eigen num_example.fp/example.fp (en
|| identiek aan ../../saplsimple_meta/examples/sieve.fp) -- hier alleen
|| geprint via de rechtstreekse printList i.p.v. de reflectieve
|| print/printSpine.
||
|| Draaien (vanuit deze map): echo test10 | ./sapl examples/sieve.fp
|| test10 -> "2 3 5 7 11 13 17 19 23 29 "

nil f g       = f
cons x xs f g = g x xs

from n = cons n (from (add 1 n))

take n xs = (eq n 0) nil (xs nil (\x xs -> cons x (take (sub n 1) xs)))

sieve xs   = xs nil (\x xs -> (eq x 0) (sieve xs) (cons x (sieve (rem x x xs))))
rem p k xs = xs nil (\x xs -> (eq k 1) (cons 0 (rem p p xs)) (cons x (rem p (sub k 1) xs)))

primes = sieve (from 2)

printList xs k = xs k (\h t -> print 0 h (print 1 " " (printList t k)))

test10 = printList (take 10 primes) ""
