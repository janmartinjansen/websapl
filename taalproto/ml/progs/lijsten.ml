// lijstfuncties van hogere orde
let rec map f xs = match xs with | [] -> [] | x :: r -> f x :: map f r;
let rec filter p xs = match xs with | [] -> [] | x :: r -> if p x then x :: filter p r else filter p r;
let rec foldr f z xs = match xs with | [] -> z | x :: r -> f x (foldr f z r);
let rec upto a b = if a > b then [] else a :: upto (a + 1) b;
let sum xs = foldr (fun a b -> a + b) 0 xs;
let main = sum (map (fun x -> x * x) (filter (fun x -> x % 2 == 0) (upto 1 10)));
