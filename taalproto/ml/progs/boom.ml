// een zoekboom: invoegen, som, diepte (geneste constructors)
type tree = Leaf | Node tree int tree;
let rec insert x t = match t with
  | Leaf -> Node Leaf x Leaf
  | Node l v r -> if x < v then Node (insert x l) v r else Node l v (insert x r);
let rec build xs = match xs with | [] -> Leaf | x :: r -> insert x (build r);
let rec sum t = match t with | Leaf -> 0 | Node l v r -> sum l + v + sum r;
let max a b = if a > b then a else b;
let rec depth t = match t with | Leaf -> 0 | Node l v r -> 1 + max (depth l) (depth r);
let main = let t = build [5, 3, 8, 1, 4, 7, 9, 2, 6] in sum t * 100 + depth t;
