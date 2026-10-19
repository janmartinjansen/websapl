// een eigen type en match met constructors
type shape = Circle int | Rect int int | Square int;
let area s = match s with
  | Circle r -> 3 * r * r
  | Rect w h -> w * h
  | Square z -> z * z;
let rec total xs = match xs with | [] -> 0 | s :: r -> area s + total r;
let main = total [Circle 2, Rect 3 4, Square 5];
