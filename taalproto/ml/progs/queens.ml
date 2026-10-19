// acht koninginnen, hetzelfde algoritme als sapl_naar_lc/progs/queens.sapl
let rec length xs = match xs with | [] -> 0 | x :: r -> 1 + length r;
let rec fromto n m = if n > m then [] else n :: fromto (n + 1) m;
let rec safe xs d x = match xs with
  | [] -> true
  | y :: ys -> x != y && x + d != y && x - d != y && safe ys (d + 1) x;
let rec concat xss = match xss with
  | [] -> []
  | [] :: yss -> concat yss
  | (a :: as) :: yss -> a :: concat (as :: yss);
let rec mapfil p f xs = match xs with
  | [] -> []
  | a :: as -> if p a then f a :: mapfil p f as else mapfil p f as;
let rec map f xs = match xs with | [] -> [] | x :: r -> f x :: map f r;
let rcons xs x = x :: xs;
let recqq k xs = mapfil (safe xs 1) (rcons xs) (fromto 1 k);
let rec qqueens k n = if n == 0 then [[]] else concat (map (recqq k) (qqueens k (n - 1)));
let queens n = length (qqueens n n);
let main = queens 8;
