|| list_demo.fp -- print rechtstreeks, geen reflectie: het programma weet
|| zelf dat het een lijst van getallen print, dus gewone Scott-encoding-
|| pattern-matching (xs branch1 branch2) volstaat. Vergelijk met
|| ../../saplsimple_meta/examples/meta_demo.fp, dat exact dezelfde soort
|| uitkomst haalt via seq/tag/getl/getr/funcname i.p.v. dit vooraf te
|| weten -- en dus "cons 7 nil" print (de structuur), waar dit bestand
|| gewoon "7 " print (de inhoud, zoals je een lijst normaal zou tonen).
||
|| Draaien (vanuit deze map):
||   echo test3 | ./sapl examples/list_demo.fp
|| mainloop() toont een resultaat niet automatisch, vandaar de "" als
|| betekenisloze afsluit-continuation bij elke test (zie
|| ../../saplsimple_meta/README.md voor de achtergrond).

nil f g       = f
cons x xs f g = g x xs

|| printList xs k: print elk element van xs gescheiden door een spatie,
|| gevolgd door continuation k. Geen enkele meta-primitief nodig: xs
|| toepassen op zijn twee takken (k voor nil, de lambda voor cons) IS de
|| dispatch.
printList xs k = xs k (\h t -> print 0 h (print 1 " " (printList t k)))

|| printListList xss k: een lijst van lijsten - nog steeds geen meta
|| nodig, gewoon printList hergebruiken op elk element.
printListList xss k = xss k (\h t -> printList h (printListList t k))

|| -------- tests --------

|| enkel getal
test1 = print 0 42 ""

|| lege lijst
test2 = printList nil ""

|| cons 7 nil  ->  "7 "
test3 = printList (cons 7 nil) ""

|| geneste lijst: cons 1 (cons 2 (cons 3 nil))  ->  "1 2 3 "
test4 = printList (cons 1 (cons 2 (cons 3 nil))) ""

|| lijst van lijsten  ->  "1 2 3 "
test5 = printListList (cons (cons 1 (cons 2 nil)) (cons (cons 3 nil) nil)) ""
