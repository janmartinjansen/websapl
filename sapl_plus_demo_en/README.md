## Sapl+ Demo

[`sapl_plus_showcase.spp`](?file=sapl_plus_demo_en/sapl_plus_showcase.spp) showcases six of Sapl+'s most important syntax extensions over Core Sapl, each in just a few lines. This guide explains what each feature means and — the interesting part — how the self-hosted Sapl+ preprocessor compiles it into plain Core Sapl before the compiler (`saplcomp.jmvm`) ever sees it. The generated `.cfp` snippets below are taken directly from real compiler output, with machine-generated `__pat_N` variables renamed for readability.

Try it right here in **Sapl Workbench**: open [`sapl_plus_showcase.spp`](?file=sapl_plus_demo_en/sapl_plus_showcase.spp), click **⚡ Compile & Run**, and use the **View** buttons (`cfp`, `types`, `retag`, `jmvm`) above the editor to inspect the generated Core Sapl and intermediate compiler stages directly.

---

### 1. Lambda Expressions

```sapl
doubled = mapL (\x -> x * 2) [1, 2, 3, 4]
```

Core Sapl has no dedicated syntax for `\x -> ...`; the preprocessor *lambda-lifts* it into a fresh top-level function and replaces the lambda with a reference to that function:

```sapl
doubled = mapL __lam_0 (Cons 1 (Cons 2 (Cons 3 (Cons 4 Nil))))
__lam_0 __pat_23 = __pat_23 * 2
```

If a lambda closes over a free variable (for example an enclosing function parameter), the lifted function receives that variable as a leading extra argument and the call site passes it along.

---

### 2. List Comprehensions (ZF)

```sapl
pairs = [ x * 10 + y | x <- [1..3], y <- [1..3], x != y ]
```

Each generator turns into a recursive helper loop, nested generators nest inside each other (capturing the outer bound variable), and filter conditions become an `if` inside the inner loop that skips non-matching items:

```sapl
pairs = __zf_1 Nil (__rangeStepGo 1 1 3)
__zf_1 acc xs = case xs (Nil -> acc) (Cons x rest -> __zf_3 x (__zf_1 acc rest) (__rangeStepGo 1 1 3))
__zf_3 x acc ys = case ys
  (Nil -> acc)
  (Cons y rest -> if (x != y) (Cons ((x * 10) + y) (__zf_3 x acc rest)) (__zf_3 x acc rest))
```

*(The `[1..3]` range notation itself desugars to a shared helper function `__rangeStepGo start step end`.)*

---

### 3. `mapPair`: Comprehensions with Constructor Patterns

```sapl
mapPair f prs = [ f a b | (Pair a b) <- prs ]
```

A comprehension generator does not have to be a plain variable — a constructor pattern works too, and any non-matching element (here: `NoPair`) is **silently skipped**, just as in Haskell or Clean, without raising an error:

```sapl
mapPair f prs = __zf_6 f Nil prs
__zf_6 f acc xs = case xs
  (Nil -> acc)
  (Cons el rest -> case el
    (Pair a b -> Cons (f a b) (__zf_6 f acc rest))
    (_        -> __zf_6 f acc rest))
```

In `sapl_plus_showcase.spp`, `somePairs` intentionally places a `NoPair` between two `Pair`s — the result `pairSums` (`33`) confirms that it is cleanly skipped.

---

### 4. `merge`: Multi-Clause Pattern Definitions, Guards & Expression `:`

```sapl
merge Nil ys = ys
merge xs Nil = xs
merge (x:xs) (y:ys)
  | x <= y    = x : merge xs (y:ys)
  | otherwise = y : merge (x:xs) ys
```

Core Sapl itself only allows **one** clause per function definition — the preprocessor's decision-tree pattern compiler merges all clauses of `merge` into a nested `case`/`if` tree, column by column from left to right, turning guards into an `if` chain at each reached leaf. The `:` operator works both in patterns and in expressions (`infixr 5`, binding between `==`/`<=` and `+`/`-`), desugaring straight to `Cons`:

```sapl
merge p1 p2 = case p1
  (Nil -> case p2 (Nil -> p2) (_ -> p2))
  (Cons x xs -> case p2
    (Nil -> p1)
    (Cons y ys -> if (x <= y) (Cons x (merge xs (Cons y ys)))
                              (Cons y (merge (Cons x xs) ys))))
```

*(Simplified for readability — variable names are normalized and the real generated code also includes a defensive fallback branch alongside `Nil`/`Cons`.)*

`sumList` and `mapL` in the showcase file use the same compilation pass in its simplest two-clause form (`Nil` / `(x:xs)`).

---

### 5. F-Strings

```sapl
name = "Sapl+"
version = 2026
greeting = f"Hello, {name}! Edition {version}."
```

During parsing, each `{expr}` interpolation is rewritten into a call to an auto-generated `__fstrShow` helper (emitted only when the file actually uses an `f"..."` string) that dispatches on the runtime type of the value — formatting `Int`/`Float`, keeping `String` unchanged, and falling back to constructor name — joined with `strcat`:

```sapl
greeting = strcat "Hello, " (strcat (__fstrShow name) (strcat "! Edition " (strcat (__fstrShow version) ".")))

__fstrShow x =
  let tid = typeId x in
  if (tid == 1) (list2str (itoa x))
  (if (tid == 2) (ftoa x)
  (if (tid == 3) x
  (constrName x)))
```

*(In real `.cfp` output, `__fstrShow` is split across two top-level functions due to let-lifting; the behavior is identical.)*

Because `__fstrShow` calls `strcat`, `itoa`, and `list2str`, this feature is why `sapl_plus_showcase.spp` includes `#import "lib/stdlib.cfp"`.

---

### 6. Pipeline Operator (`|>`)

```sapl
pipelined =
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    |> filter isEven
    |> mapL double
    |> sumList
```

`a |> f x` desugars to `f x a` — passing the left-hand expression as the **last** argument on the right, matching `filter`/`mapL` (function/predicate first, list last) so data transformations read left-to-right instead of inside-out:

```sapl
pipelined = sumList (mapL double (filter isEven (Cons 1 (Cons 2 (Cons 3 (Cons 4 (Cons 5 (Cons 6 (Cons 7 (Cons 8 (Cons 9 (Cons 10 Nil))))))))))))
```

`|>` binds looser than built-in arithmetic/comparison operators (`1 + 2 |> double` parses as `(1 + 2) |> double`) and chains left-associatively.

---

Running [`sapl_plus_showcase.spp`](?file=sapl_plus_demo_en/sapl_plus_showcase.spp) prints all six outputs in sequence: `20`, `132`, `33`, `28`, `Hello, Sapl+! Edition 2026.`, and `60`.
