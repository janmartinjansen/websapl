# Haskell lite: a guide

Haskell lite is a Haskell front-end for the JMVM, the stack-based virtual
machine for lazy functional languages in this repository. You write ordinary
Haskell; Haskell lite type-checks it, translates it to Sapl+ and runs it on
the JMVM — natively, or in the browser (WebSapl), without a server.

It is meant for notebooks: small to medium programs, data exploration,
teaching, trying out ideas. It is not a full GHC: the differences are listed
at the end, and everything that is not supported gives a clear message
("niet in Haskell lite: ...") rather than a wrong result.

*Written 7 November 2026. Also as a web page:
<https://janmartinjansen.github.io/websapl/factsheets/haskell_lite.html>
(`docs/haskell_lite_guide.html`, in WebSapl `factsheets/haskell_lite.html`). The development record (in Dutch, with all
measurements) is `docs/2026-11-04_haskell_lite_frontend_plan.md`.*

## Contents

1. [Trying it](#trying-it)
2. [What it is](#what-it-is)
3. [The language](#the-language)
4. [Libraries](#libraries)
5. [Tables and pictures in the notebook](#tables-and-pictures-in-the-notebook)
6. [Speed](#speed)
7. [How it is tested](#how-it-is-tested)
8. [Differences from GHC](#differences-from-ghc)

## Trying it

**In the browser.** Open the example notebook in WebSapl:
<https://janmartinjansen.github.io/websapl/notebook.html?nb=notebooks/haskell_lite.spp&run=1>.
Add a cell with *+ Haskell*. A Haskell cell holds definitions *or* one
expression; all Haskell cells of a notebook together form one module, so a
cell may use definitions from any other Haskell cell. An expression cell
shows its value; a cell that starts with `do` is run as an action (in `IO`)
or shown (in `Maybe`, a list, `Either`).

```haskell
data Shape = Circle Double | Rect Double Double deriving Show

area :: Shape -> Double
area (Circle r) = pi * r * r
area (Rect w h) = w * h
```
```haskell
map area [Circle 1, Rect 2 3]
```

**In the Workbench** (`./start_workbench`, the local IDE): the same notebook,
with the translation on the server. If Haskell lite does not support
something yet, the Workbench falls back to MicroHs (the status line says
which route was used).

**On the command line** (from the repository root):

```bash
bash micro_haskell/hlite/hlite.sh Program.hs           # translate, compile, run
bash micro_haskell/hlite/hlite.sh --spp Program.hs     # only the Sapl+ translation
```

## What it is

```
Haskell ─▶ lexer ─▶ layout ─▶ parser ─▶ fixity ─▶ desugar ─▶ type checker
        ─▶ specialisation ─▶ Sapl+ ─▶ Sapl compiler (gen1) ─▶ JMVM bytecode
```

- **Everything is written in Sapl+** (`micro_haskell/hlite/`), the
  higher-level dialect of Sapl, and compiled to JMVM bytecode itself. In
  WebSapl the whole front-end runs inside the browser's WebAssembly JMVM.
- **Hindley–Milner type inference with type classes**, following the Haskell
  2010 report: let-polymorphism, the monomorphism restriction, defaulting
  (`Num` → `Int`, fractional classes → `Double`), superclasses, and higher
  kinds (`Functor f`, `Monad m`).
- **No dictionaries at run time.** Overloaded functions are specialised per
  type for the whole program: `==` on an `Int` becomes a machine comparison,
  `show` on a `Maybe [Int]` a generated function for exactly that type. This
  is where the speed comes from (see [Speed](#speed)).
- **Lazy evaluation**, as in Haskell: infinite lists, `where`, sharing.
- Translating and compiling a small program takes about 0.15 s natively;
  in the browser a notebook run is typically 0.3–1.5 s.

## The language

What works (all checked against GHC):

- **Definitions**: pattern matching (also nested, `@`-patterns, `~`/`!`),
  guards, `where`, `let`, `case`, `if`, lambdas, operator sections, local
  functions, mutual recursion, type signatures (optional), type synonyms.
- **Lists**: ranges (`[1 ..]`, `[0, 0.5 .. 2]`), list comprehensions,
  strings as lists of characters.
- **Numbers**: `Int` and `Double`; `div`, `mod`, `fromIntegral`,
  `realToFrac`, `sqrt`, `sin`, `pi`, `round`, `truncate`, `^`, ...
- **Data types**: `data` with `deriving (Eq, Ord, Show, Enum)`, records
  (create, update and match, see below), `type` synonyms.
- **Type classes**: the standard classes (`Eq`, `Ord`, `Show`, `Num`,
  `Integral`, `Fractional`, `Floating`, `RealFrac`, `Enum`, `Read`), your own
  classes with default methods and superclasses, your own instances
  (also `instance Show a => Show (Tree a)`), overloaded functions and
  operators.
- **Functor, Applicative, Monad**: `do` in any monad — `Maybe`, lists,
  `Either e`, `IO` and your own monads; `fmap`, `<$>`, `<*>`, `>>=`,
  `mapM`, `forM_`, `when`, `foldM`, `replicateM`, `traverse`, ... (over
  lists).
- **Imports**: `Data.List`, `Data.Char`, `Data.Maybe`, `Control.Monad` and
  friends are accepted (their functions are always available);
  `Data.Map` and `Data.Set` are real modules with qualified names.

A larger example, using a class, a record, a monad and a map:

```haskell
import qualified Data.Map as M

data Account = Account { owner :: String, balance :: Int } deriving Show

class Describe a where
  describe :: a -> String
  describe _ = "something"

instance Describe Account where
  describe a = owner a ++ " has " ++ show (balance a)

withdraw :: Int -> Account -> Either String Account
withdraw n a
  | n > balance a = Left ("not enough money for " ++ owner a)
  | otherwise = Right a { balance = balance a - n }

transfer :: Int -> Account -> Account -> Either String (Account, Account)
transfer n from to = do
  from2 <- withdraw n from
  return (from2, to { balance = balance to + n })

main :: IO ()
main = do
  let ann = Account { owner = "Ann", balance = 100 }
      bob = Account { owner = "Bob", balance = 20 }
  print (transfer 30 ann bob)
  print (transfer 300 ann bob)
  mapM_ (putStrLn . describe) [ann, bob]
  let totals = M.fromListWith (+) [(owner a, balance a) | a <- [ann, bob, ann]]
  print (M.toList totals)
```

Output:

```
Right (Account {owner = "Ann", balance = 70},Account {owner = "Bob", balance = 50})
Left "not enough money for Ann"
Ann has 100
Bob has 20
[("Ann",200),("Bob",20)]
```

### Records

```haskell
data Point = Point { px :: Int, py :: Int } deriving (Show, Eq)

origin = Point { px = 0, py = 0 }      -- fields in any order
moved = origin { py = 5 }               -- update
mirror p@Point { px = x } = p { px = negate x }   -- record pattern
```

A missing field in a construction is only an error when it is used (GHC
warns about it). Unknown or duplicated fields, and fields of the wrong
constructor, are compile-time errors.

### Your own monad

```haskell
data State s a = State (s -> (a, s))

runState :: State s a -> s -> (a, s)
runState (State f) s = f s

instance Functor (State s) where
  fmap f (State g) = State (\s -> let (a, s2) = g s in (f a, s2))

instance Applicative (State s) where
  pure a = State (\s -> (a, s))
  State f <*> State g = State (\s -> let (h, s2) = f s
                                         (a, s3) = g s2 in (h a, s3))

instance Monad (State s) where
  State g >>= k = State (\s -> let (a, s2) = g s in runState (k a) s2)

tick :: State Int Int
tick = State (\n -> (n, n + 1))

label :: [a] -> State Int [(Int, a)]
label xs = mapM (\x -> do { n <- tick; return (n, x) }) xs
```

`runState (label "abc") 0` gives `([(0,'a'),(1,'b'),(2,'c')],3)`.

## Libraries

Besides the Prelude:

- **Data.List**: `sort`, `sortBy`, `sortOn`, `group`, `groupBy`, `nub`,
  `partition`, `insert`, `delete`, `union`, `intersect`, `intercalate`,
  `intersperse`, `transpose`, `isPrefixOf`, `isSuffixOf`, `isInfixOf`,
  `stripPrefix`, `tails`, `inits`, `subsequences`, `permutations` (in GHC's
  order), `find`, `findIndex`, `elemIndex`, `scanl`, `scanr`, `zipWith3`,
  `unzip3`, `maximumBy`, `minimumBy`; `comparing` and `on`.
- **Data.Maybe**: `fromMaybe`, `isJust`, `isNothing`, `catMaybes`,
  `mapMaybe`, `fromJust`, `maybe`.
- **Data.Char**: `ord`, `chr`, `isDigit`, `isAlpha`, `isSpace`, `isUpper`,
  `toUpper`, `toLower`, `digitToInt`, ...
- **Control.Monad**: `mapM`, `mapM_`, `forM`, `forM_`, `sequence`,
  `sequence_`, `when`, `unless`, `replicateM`, `replicateM_`, `foldM`,
  `zipWithM`, `zipWithM_`, `join`, `void`, `liftA2`, `>=>`, `=<<`.
- **Data.Map** and **Data.Set** (also `Data.Map.Strict`): a weight-balanced
  tree as in the `containers` package, written in Haskell lite itself.
  `fromList`, `fromListWith`, `insert`, `insertWith`, `delete`, `lookup`,
  `!`, `!?`, `member`, `findWithDefault`, `adjust`, `alter`, `update`,
  `toList`, `keys`, `elems`, `foldr`, `foldrWithKey`, `map`, `filter`,
  `union`, `unionWith`, `intersectionWith`, `difference`, `lookupMin`,
  `findMax`, `keysSet`, ... Use them qualified
  (`import qualified Data.Map as M`) or with an import list
  (`import Data.Map (Map, fromList)`). `fmap` works on a map.
- **read** for `Int` and `Double`.

## Tables and pictures in the notebook

A Haskell cell whose value has type `Display` is shown as a table, as
Markdown or as a picture, just like the `D.` functions of Sapl cells:

```haskell
table ["word", "count"] [[w, show (length ws)] | ws@(w : _) <- group (sort (words "the cat and the dog"))]
bar [3, 1, 4, 1, 5]
lineChart [sin (x / 10) | x <- [0 .. 60]]
plot [(x, sin x * exp (-x / 5)) | x <- [0, 0.1 .. 12]]
picture [disc yellow (0, 0) 0.6, disc black (-0.2, 0.2) 0.08, disc black (0.2, 0.2) 0.08]
column [markdown "# Result", text "plain text"]
```

- `table headers rows` — rows of strings;
- `markdown`, `text`, `column` (several displays below each other);
- `bar` and `lineChart` (a list of `Int` or `Double`), `plot` (points
  `(x, y)`, scaled to fit);
- `picture` with shapes: `disc`, `circle` (centre and radius), `rect`,
  `filledRect`, `ellipse`, `line`, `polygon`, `textAt`, and the colours
  `black`, `red`, `blue`, `green`, `yellow`, ... Coordinates run from -1 to
  1, with (0, 0) in the middle.

## Speed

Running time of the twelve core benchmarks of the repository, written as
ordinary Haskell, compared with the same programs written by hand in Sapl
(the JMVM's own language) and with the MicroHs back-end (the MicroHs
front-end with a JMVM back-end, which keeps type-class dictionaries at run
time). Seconds, native JMVM (`runfast`), 7 November 2026:

| benchmark | Haskell lite | MicroHs back-end | hand-written Sapl | Haskell lite / Sapl |
|---|---:|---:|---:|---:|
| fib | 0.23 | 0.23 | 0.23 | 1.00× |
| primes | 0.26 | 0.36 | 0.22 | 1.18× |
| queens | 0.14 | 0.18 | 0.14 | 1.00× |
| hamming | 0.46 | 0.63 | 0.37 | 1.24× |
| sort | 0.37 | 0.42 | 0.26 | 1.42× |
| twice | 0.54 | 0.45 | 0.62 | 0.87× |
| match | 0.24 | 0.34 | 0.22 | 1.09× |
| knights | 0.07 | 0.08 | 0.05 | 1.40× |
| sprimes | 0.56 | 0.89 | 0.57 | 0.98× |
| eval | 0.32 | 0.35 | 0.31 | 1.03× |
| parsetest | 0.50 | 0.81 | 0.53 | 0.94× |
| prolog | 0.29 | 0.26 | 0.19 | 1.53× |

In short: Haskell lite code runs within 1.0–1.5× of hand-written Sapl
(geometric mean 1.12×), and is as fast as or faster than the MicroHs
back-end on ten of the twelve, because type classes are resolved at compile
time. For sort and hamming most of the gap comes from Haskell's lazy list
elements: the hand-written Sapl versions use lists with a strict head,
which is faster but not Haskell's semantics. Knights and prolog have not
been analysed yet. Specialisation also
means no dictionary passing, no boxing of class methods, and `==`, `<` and
`show` generated for exactly the types used.

For comparison with GHC: building a `Data.Map` with 200,000 `insertWith`
operations takes 0.30 s, GHC with `-O` 0.10 s.

## How it is tested

- **Running programs** (`toets_hlite.sh`): 91 programs — the twelve
  benchmarks, programs for each feature, type classes, `Double`,
  `Data.List`, `Data.Map`, monads, records — are run with Haskell lite and
  compiled with GHC (`ghc -O`); the output must be identical. 90 of 91 are;
  the one difference is an `Int` overflow (62 bits, see below).
- **Types** (`toets_typen.sh`, 128 programs): the types Haskell lite infers
  are written back into the source as type signatures, with their
  contexts; GHC must accept them (with `-Wredundant-constraints`) and give
  the same output. Programs with type errors must be rejected.
- **Parsing** (`toets_parser.sh`, 57 programs): the parse tree, printed back
  as Haskell with explicit braces and parentheses, is compared with the
  parse of MicroHs, and with fixity resolution.
- **Notebook**: browser tests in headless Chrome for WebSapl and the
  Workbench.

## Differences from GHC

- **Numbers.** `Int` is 62 bits (the JMVM's tagged integers), so overflow
  differs from GHC's 64 bits. `Double` is the JMVM's 32-bit float — as
  precise as Haskell's `Float`; `show` prints it like GHC prints a `Float`.
  There is no arbitrary-precision `Integer`.
- **Foldable and Traversable** are not classes: `sum`, `length`, `mapM`,
  `traverse`, ... work on lists. Use `M.elems m` for a map.
- **Fixity declarations** (`infixl 6 <+>`) are not supported; your own
  operators are `infixl 9`. The standard operators have their usual
  fixities.
- **Show**: your own `Show` instance is used as is, without `showsPrec`, so
  inside a constructor it gets no parentheses (`Just Point 1 2` instead of
  `Just (Point 1 2)`); derived instances and maps and sets do get them.
- **Records**: no `{..}` (RecordWildCards) and no field puns.
- **read** only for `Int` and `Double`.
- **Classes**: single-parameter classes only; no kind inference (an
  instance like `instance Functor Int` is rejected with a clear message);
  a failing pattern in a `do` of your own monad without `MonadFail` is a
  run-time error.
- **Modules**: one module per program (in the notebook: all Haskell cells
  together). Imports of the standard modules are accepted; your own modules
  cannot be imported yet.
- **Notebook**: Haskell cells and Sapl cells do not share definitions yet,
  and all Haskell cells are run again when one changes. Forms and
  interactive cells are only for Sapl cells.
