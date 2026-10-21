# Prototyping a language in Sapl+: a guide

This guide shows how to build your own small programming language on top of
JMVM with the framework in `taalproto/`. You write the parts that make your
language your language: its syntax, what it means, and the checks you want.
The framework handles lexing, parsing, scope checking, optimisation and
running. A finished language can run in two ways:

- through an **interpreter route**, the *hybrid route* of
  `sapl_naar_lc/hybride.cfp`. It starts at once and needs nothing beyond your
  own `.spp` files. It is 10-15× slower than native Sapl.
- through the **real compiler**, gen1. Your program is written out as Sapl+
  text, compiled and run. This is 1.2-1.4× native Sapl.

Everything in this guide comes from a running example language, **tiny**
(`taalproto/tiny/`). Every program and every message shown here is in its
tests (`taalproto/tiny/test_tiny.spp`), so they are known to work. The three
larger example languages are good to read next:

| Language | Directory | What it shows |
|---|---|---|
| calc | `taalproto/calc/` | operators, a prefix operator, `let`; about 30 lines |
| while | `taalproto/while/` | an imperative language: assignment, loops, `if` with join points |
| MiniML | `taalproto/ml/` | functions as values, nested patterns, user-defined constructors |
| tiny | `taalproto/tiny/` | the example of this guide: C-style calls, `fn`, lists, `match` |

The framework is written in Dutch (function names, comments, error
messages). This guide quotes the messages as they are, with a translation
where it helps: `onbekende naam y` means "unknown name y", and
`regel 1: verwacht …, maar zag …` means "line 1: expected …, but saw …".

Contents:

1. Quick start
2. The pipeline at a glance
3. Step 1: the AST
4. Step 2: the grammar
5. Step 3: the translation to the kernel language
6. Step 4: checks
7. Step 5: the language as a value, running and testing
8. Step 6: running through the real compiler (JIT)
9. Cookbook: common constructs and how to translate them
10. Things to know about writing Sapl+ for this
11. Reference

---

## 1. Quick start

All commands run from the repository root.

```bash
# the tests of tiny: every line must end in "ok"
./run-spp taalproto/tiny/test_tiny.spp

# run a program via the interpreter route
./compile-spp taalproto/tiny/run_tiny.spp
echo taalproto/tiny/progs/queens.tiny | ./runfast taalproto/tiny/run_tiny.jmvm     # prints 92

# run the same program via the real compiler; -o keeps the generated Sapl+
bash taalproto/jit/jit.sh -o /tmp/queens.spp taalproto/tiny/jit_tiny.spp taalproto/tiny/progs/queens.tiny

# all tests of all example languages
bash taalproto/run_tests.sh

# every example program via both routes, compared (-v: instruction counts)
bash taalproto/jit/run_jit.sh -v
```

To start your own language, copy `taalproto/tiny/` to a new directory. Then
rename the `#import` paths, the constructors and the functions. Tiny's prefix
is `T`/`ti` (section 10 explains why every language needs its own prefix).

A tiny program looks like this:

```
fun len(xs) = match xs { [] -> 0 | x :: r -> 1 + len(r) };
fun main() = len([1, 2, 3]);
```

---

## 2. The pipeline at a glance

```
source text
  │  tpLex, tpParse      (grammatica.spp: generic, driven by your grammar)
  ▼
your AST                 (your ::types)
  │  your check          (optional: a list of error messages)
  │  your translation
  ▼
kernel language          ([funcDef] of Sapl_interpreter: a small lazy lambda calculus)
  │  kernScope           (generic: unknown names)
  │  kernOptDefs         (generic: inlining, beta reduction)
  ├──────────────────────────────┐
  ▼                              ▼
hybrid route                   langSapl (naar_sapl.spp) → Sapl+ text → gen1 → bytecode
(interpreter, starts at once)  (the real compiler, close to native speed)
```

A language is one value:

```
::lang = Lang !name gram check translate
```

- `gram` is a grammar, written as data. Section 4 covers it.
- `check` is a function from your AST to a list of error messages; `[]` means
  everything is fine. Use `noCheck` if you don't need one.
- `translate` is a function from your AST to the kernel language: a list of
  function definitions, one of which is called `start`.

You write three things: the AST types, the grammar and the translation. The
own check is optional.

---

## 3. Step 1: the AST

Your AST is ordinary Sapl+ algebraic data types. Here is tiny's:

```
::texp = TNum !n | TBool !b | TVar !x | TCall !f args | TBin !op !a !b | TNeg !a
       | TIf !c !a !b | TLet !x !e !b | TFn params !body | TList es
       | TMatch !e arms
::tarm = TArm !pat !body
::tpat = TPNum !n | TPVar !x | TPNil | TPCons !h !t
::tdecl = TFun !name params !body
```

A program is a list of `TFun` declarations.

The order of a constructor's fields matters. The grammar builds each node by
calling the constructor with the values it parsed, in the order they appear.
So `TFun name params body` fits the syntax `fun name ( params ) = body ;`
exactly. Choose the field order to match your syntax, and you won't need any
glue functions.

The `!` marks a strict field, which is ordinary Sapl+ and optional here.

---

## 4. Step 2: the grammar

A grammar is a value of type `::gram`:

```
::gram = Gram !start rules
::rule = Rule !name alts                 // alternatives
       | OpRule !name !atom ops          // binary/prefix operators over the rule `atom`
::alt  = Alt syms action
::op   = Op !text !prio !assoc action    // assoc: 0 left, 1 right
       | Pre !text !prio action          // prefix operator
```

### 4.1 Symbols and the values they produce

An alternative `Alt syms action` matches its symbols in order. **It then
applies `action` to the values of the symbols, one argument per symbol that
produces a value.** That rule is the one to remember. The symbols are:

| Symbol | Matches | Value |
|---|---|---|
| `K "text"` | a keyword or punctuation | **none** |
| `N "rule"` | a non-terminal | whatever that rule produces |
| `Id` | a name (letters, digits, `_`, `'`; not a keyword) | the name as a string |
| `Num` | an integer literal | the number |
| `Str` | a string literal `"..."` | the string |
| `Many s` | zero or more `s` | a list |
| `Many1 s` | one or more `s` | a list |
| `SepBy s "sep"` | zero or more `s`, separated by `sep` | a list |
| `SepBy1 s "sep"` | one or more | a list |
| `Opt s` | zero or one `s` | a list of 0 or 1 elements |

Some small examples from tiny:

```
Alt [Num] TNum                                   // "42"       -> TNum 42
Alt [K "true"] (TBool True)                      // "true"     -> TBool True   (no values: the action is used as is)
Alt [K "(", N "exp", K ")"] id                   // "(1 + 2)"  -> the value of exp; id is the identity
Alt [Id, K "(", SepBy (N "exp") ",", K ")"] TCall // "f(1, x)"  -> TCall "f" [TNum 1, TVar "x"]
Alt [K "let", Id, K "=", N "exp", K "in", N "exp"] TLet
                                                  // "let x = 1 in x" -> TLet "x" (TNum 1) (TVar "x")
```

When the values don't fit a constructor directly, write a small function as
the action. MiniML (`taalproto/ml/ml.spp`) has these:

```
Alt [Many1 (N "aexp")] foldApp        // "f x y" -> one list [f, x, y]
foldApp (f : as) = foldl MApp f as    //        -> MApp (MApp f x) y

Alt [K "let", Opt (K "rec"), Id, Many Id, K "=", N "exp", K ";"] mkDef
mkDef recs name params body = MDef name params body    // recs: [] or [..]; Opt (K ..) still gives a list
```

### 4.2 Choice is ordered (PEG)

The alternatives of a rule are tried in order, and the first one that
succeeds wins. Nothing backtracks into an alternative once it has
succeeded. So **put the longer alternative first**. In tiny:

```
Rule "atom" [ ...
            , Alt [Id, K "(", SepBy (N "exp") ",", K ")"] TCall   // f(1): first
            , Alt [Id] TVar                                       // f:    after
            ... ]
```

With the two swapped, `f(1)` parses `f` as a variable, and the `(` is left
over:

```
regel 1: verwacht het einde van de invoer, maar zag '('
(line 1: expected the end of the input, but saw '(')
```

For the same reason, `if … then … else …` goes before `if … then …` in a
language that has both.

### 4.3 Operators

Binary operators don't go in ordinary rules, because left recursion
(`exp = exp "+" exp`) is not allowed (`tpCheck` reports it). Use an
`OpRule` instead. It parses operators over an atom by precedence climbing:

```
OpRule "ops" "atom"
  [ Op "||" 1 0 (TBin "||"), Op "&&" 2 0 (TBin "&&")
  , Op "==" 3 0 (TBin "=="), Op "<" 3 0 (TBin "<")
  , Op "::" 4 1 (TBin "::")                        // assoc 1: right
  , Op "+" 5 0 (TBin "+"), Op "-" 5 0 (TBin "-")
  , Op "*" 6 0 (TBin "*")
  , Pre "-" 6 TNeg ]                               // prefix minus
```

- A higher priority binds tighter: `1 + 2 * 3` is `1 + (2 * 3)`.
- `assoc` 0 is left-associative, so `10 - 3 - 2` is `(10 - 3) - 2`. `assoc`
  1 is right-associative, so `1 :: 2 :: []` is `1 :: (2 :: [])`.
- The action of `Op` gets the two operands, and the action of `Pre` gets
  one.
- A prefix operator may stand at the start of any operand: `2 * -x`, and
  also `- - 5`. Its operand takes everything that binds tighter than its
  priority. In calc (`Pre "-" 7`, `^` at 8), `-2 ^ 2` is `-(2 ^ 2)`.

Tiny's tests for this:

```
fun main() = 1 + 2 * 3 - 10 / 5;     // 5
fun main() = -2 * -(1 + 2);          // 6
```

An `OpRule` can also be used for patterns. Tiny does that for `::` in
patterns, with a different atom:

```
OpRule "pat" "apat" [Op "::" 4 1 TPCons]
```

### 4.4 Keywords, punctuation, comments

The lexer is derived from your grammar. You don't write one.

- Every `K` text that starts with a letter is a **keyword**: `fun`, `if`,
  `let`, `fn`, `match`, `true`. An `Id` never matches a keyword, so
  `fun fn(x) = x;` gives `regel 1: verwacht een naam, maar zag 'fn'` ("expected
  a name, but saw 'fn'").
- Every other `K` text and operator text is **punctuation**. The lexer tries
  the longest first, so `->`, `::` and `||` are each one token, not `-` and
  `>`.
- `//` starts a comment that runs to the end of the line.
- Numbers are integers.

### 4.5 Error messages for free

A syntax error reports the **farthest** position the parser reached. It
gives the line and every alternative that failed there:

```
fun main() = 1 +;
→ regel 1: verwacht '-', een getal, 'true', 'false', een naam, '[' of '(', maar zag ';'
  (line 1: expected '-', a number, 'true', 'false', a name, '[' or '(', but saw ';')
```

You get messages like this without writing anything for them. `tpCheck`
checks the grammar itself before anything is parsed: it reports unknown
non-terminals and direct left recursion.

### 4.6 The whole grammar of tiny

```
tinyGram = Gram "prog"
  [ Rule "prog" [Alt [Many (N "fun")] id]
  , Rule "fun"  [Alt [K "fun", Id, K "(", SepBy Id ",", K ")", K "=", N "exp", K ";"] TFun]
  , Rule "exp"  [ Alt [K "if", N "exp", K "then", N "exp", K "else", N "exp"] TIf
                , Alt [K "let", Id, K "=", N "exp", K "in", N "exp"] TLet
                , Alt [K "fn", K "(", SepBy Id ",", K ")", K "->", N "exp"] TFn
                , Alt [K "match", N "exp", K "{", SepBy1 (N "arm") "|", K "}"] TMatch
                , Alt [N "ops"] id ]
  , Rule "arm"  [Alt [N "pat", K "->", N "exp"] TArm]
  , OpRule "ops" "atom" [ ...operators as above... ]
  , Rule "atom" [ Alt [Num] TNum
                , Alt [K "true"] (TBool True), Alt [K "false"] (TBool False)
                , Alt [Id, K "(", SepBy (N "exp") ",", K ")"] TCall
                , Alt [Id] TVar
                , Alt [K "[", SepBy (N "exp") ",", K "]"] TList
                , Alt [K "(", N "exp", K ")"] id ]
  , OpRule "pat" "apat" [Op "::" 4 1 TPCons]
  , Rule "apat" [ Alt [Num] TPNum
                , Alt [K "[", K "]"] TPNil
                , Alt [Id] TPVar
                , Alt [K "(", N "pat", K ")"] id ] ]
```

The keyword expressions (`if`, `let`, `fn`, `match`) sit in `exp`, above the
operators. Their bodies reach as far as possible, as in ML: `fn(x) -> x + 1`
is `fn(x) -> (x + 1)`.

---

## 5. Step 3: the translation to the kernel language

### 5.1 The kernel language

The kernel language is the AST of `Sapl_interpreter` (`Sapl_interpreter/ast.cfp`).
It is a small, **lazy**, untyped functional language:

```
::expr = ENum !n | EBool !b | EStr !s
       | EVar !name                 // variable, global function, builtin
       | EApp !e1 !e2               // application, one argument at a time
       | ELam !param !body          // \param -> body
       | EIf !cond !th !el
       | ELet !bindings !body       // non-recursive
       | ELetRec !bindings !body    // recursive
       | EPrim !op                  // an operator, applied with two EApp's
       | EConstr !cname !args       // a constructor with all its arguments
       | ECase !scrut !branches
::binding = BindDef !name !rhs
::branch  = CaseBranch !pat !body
::pat     = PWild | PVar !name | PNum !n | PBool !b | PConstr !cname !pats   // nesting allowed
::funcDef = FuncDef !name !params !body
```

A program is a `[funcDef]` that contains a function `start` with no
parameters. The value of `start` is the result.

Some facts about the kernel:

- **Operators**: `+ - * / % == != < <= > >=` and `&& ||`. Write them with the
  helper `bin "+" a b`, which builds `EApp (EApp (EPrim "+") a) b`. **`==` and
  `!=` compare numbers** (and booleans), not lists or strings.
- **Builtins** that you can use as `EVar`: `not`, `cons`, `head`, `tail`,
  `isnil`.
- **A name with a capital letter is a constructor.** You don't declare
  constructors in the kernel. `EConstr "Cons" [h, t]` builds a value, and
  `PConstr "Cons" [PVar "h", PVar "t"]` matches it. Lists are by convention
  `Nil`/`Cons`, and results print that way:
  `fun main() = [1, 2, 3];` prints `(Cons 1 (Cons 2 (Cons 3 Nil)))`.
- **Booleans** print as `1` and `0` at the top level.
- **Patterns may be nested** (`x :: y :: r`) and may contain numbers
  (`0 -> …`). The branches are tried in order. If none matches, the program
  stops with `geen passende case-tak` ("no matching case branch").
- **`ELet` is not recursive**: `let x = x + 1 in x` gives
  `onbekende naam x`. Use `ELetRec` for recursion.
- The language is **lazy**, so an argument is only evaluated when it is
  needed. Both routes keep that semantics.

### 5.2 Helpers

`taalproto/taal.spp` has helpers for building kernel terms:

```
lams ["x", "y"] e        -- \x -> \y -> e
apps f [a, b]            -- EApp (EApp f a) b
call "f" ["x", "y"]      -- f x y, with names as arguments
bin "+" a b              -- a + b
let1 "x" e body          -- let x = e in body
letrec1 "f" e body       -- letrec f = e in body
startDef e               -- [FuncDef "start" [] e]
```

### 5.3 Tiny's translation, piece by piece

The top level: every `fun` becomes a global function, and `start` calls
`main`.

```
tinyDefs ds = FuncDef "start" [] (EVar "main") : map tiDecl ds
tiDecl (TFun f ps b) = FuncDef f ps (tiE b)
```

Expressions are mostly one line each:

```
tiE (TNum n) = ENum n
tiE (TBool b) = EBool b
tiE (TVar x) = EVar x
tiE (TCall f as) = apps (EVar f) (map tiE as)          // f(a, b) -> f a b
tiE (TNeg a) = bin "-" (ENum 0) (tiE a)                // -a -> 0 - a
tiE (TIf c a b) = EIf (tiE c) (tiE a) (tiE b)
tiE (TLet x e b) = let1 x (tiE e) (tiE b)
tiE (TFn ps b) = lams ps (tiE b)                       // fn(x, y) -> e  ->  \x -> \y -> e
tiE (TMatch e arms) = ECase (tiE e) (map tiArm arms)
```

Syntactic sugar is resolved here. The operator `::` becomes a constructor,
and so does a list literal:

```
tiE (TBin op a b)
  | strEqual op "::" = tiCons (tiE a) (tiE b)
  | otherwise = bin op (tiE a) (tiE b)
tiE (TList es) = foldr tiCons (EConstr "Nil" []) (map tiE es)    // [1, 2] -> Cons 1 (Cons 2 Nil)
tiCons h t = EConstr "Cons" [h, t]
```

Patterns follow the same pattern; `_` is the wildcard:

```
tiArm (TArm p b) = CaseBranch (tiP p) (tiE b)
tiP (TPNum n) = PNum n
tiP (TPVar x)
  | strEqual x "_" = PWild
  | otherwise = PVar x
tiP TPNil = PConstr "Nil" []
tiP (TPCons h t) = PConstr "Cons" [tiP h, tiP t]
```

What the tests show this gives:

```
fun twice(f, x) = f(f(x));
fun main() = twice(fn(x) -> x + 3, 10);                          // 16

fun adder(n) = fn(x) -> x + n;
fun main() = let add5 = adder(5) in add5(1) + add5(2);           // 13: closures just work

fun f(xs) = match xs { [] -> 0 | x :: [] -> x | x :: y :: r -> x * y };
fun main() = f([]) + f([7]) + f([4, 5, 6]);                      // 27: nested patterns

fun fib(n) = match n { 0 -> 0 | 1 -> 1 | k -> fib(k - 1) + fib(k - 2) };
fun main() = fib(15);                                            // 610: number patterns
```

Closures, laziness, nested patterns and recursion between functions all
come from the kernel. Tiny's translation only says how its syntax maps to
it.

---

## 6. Step 4: checks

### 6.1 Scope: free

After your translation, `kernScope` looks for names that are bound nowhere.
A name counts as bound if it is a global function, a parameter, a binder of
`ELam`/`ELet`/`ELetRec`, a pattern variable, a constructor or a builtin.
This also covers code that never runs:

```
fun main() = y + 1;                → onbekende naam y         (unknown name y)
fun main() = let x = x + 1 in x;   → onbekende naam x         (let is not recursive)
```

So if your translation maps your binders to kernel binders, scope rules need
no code at all. Calc and while have no own check.

### 6.2 An own check

Everything else that is wrong with a program depends on your language. Two
examples are calling a function with the wrong number of arguments and a
missing `main`. An own check is a function from your AST to a list of
messages. Tiny's top level:

```
tinyCheck ds = append (tiMain ds) (tiCalls ds ds)

tiMain ds
  | tiArity "main" ds == 0 = []
  | otherwise = ["no function main()"]
```

The arity check walks the AST and keeps the local names, because a parameter
or `let` with the same name hides a global function:

```
tiChk ds locals (TCall f as) = append (tiChkCall ds locals f (length as)) (tiChkL ds locals as)
tiChk ds locals (TLet x e b) = append (tiChk ds locals e) (tiChk ds (x : locals) b)
tiChk ds locals (TFn ps b)   = tiChk ds (append ps locals) b
...
tiChkCall ds locals f n
  | tpStrMember f locals = []          // a local: we don't know its arity
  | tiArity f ds < 0 = []              // not a global function: kernScope will see it
  | tiArity f ds == n = []
  | otherwise = [strcat3 f (strcat3 " expects " (list2str (itoa (tiArity f ds))) " argument(s), got ") (list2str (itoa n))]
```

```
fun sq(x) = x * x;
fun main() = sq(1, 2);      → sq expects 1 argument(s), got 2

fun f(x) = x;               → no function main()
```

The order of the checks is: grammar (`tpCheck`), syntax, your check,
translation, then `kernScope`. The first stage that reports something stops
the pipeline, and all messages of that stage are joined with `; `.

MiniML's check (`mlCheck` in `taalproto/ml/ml.spp`) is a larger example. It
verifies that every constructor is declared with a `type` and is used with
the right number of arguments, in expressions and in patterns.

---

## 7. Step 5: the language as a value, running and testing

```
tinyLang = Lang "tiny" tinyGram tinyCheck tinyDefs
```

**Run a program** via the interpreter route (`taalproto/tiny/run_tiny.spp`):

```
#import "taalproto/tiny/tiny.spp"
start = runLang tinyLang (readFile readLine)
```

```bash
./compile-spp taalproto/tiny/run_tiny.spp
echo taalproto/tiny/progs/primes.tiny | ./runfast taalproto/tiny/run_tiny.jmvm    # 669
```

`runLang lang src` prints the result, or `fout: <message>` ("error:").

**Test** with three helpers from `taal.spp`:

```
checkLang    name lang src expected   // run via the hybrid route AND via eval2; both must give `expected`
checkLangErr name lang src message    // must fail with exactly this message
checkLangH   name lang src expected   // only the hybrid route (for programs too heavy for eval2)
```

```
start =
  checkLang "call" tinyLang "fun sq(x) = x * x;\nfun main() = sq(3) + sq(4);" 25
  <#> checkLangErr "error: arity" tinyLang "fun sq(x) = x * x;\nfun main() = sq(1, 2);" "sq expects 1 argument(s), got 2"
```

The output has one line per test, ending in `ok` or `FOUT` ("wrong"):

```
call: 25  (eval2: 25 , verwacht: 25 ) ok
error: arity: sq expects 1 argument(s), got 2 ok
```

`checkLang` runs two independent implementations. The hybrid route runs the
**optimised** kernel (`kernOptDefs`), and eval2 (`Sapl_interpreter`, a
call-by-name interpreter) runs the translation **as is**. When both agree,
your translation and the optimiser are both doing the right thing. The
expected value is a number, so test a boolean through
`if … then 1 else 0`.

Add your test file to the loop in `taalproto/run_tests.sh` so it runs with
the others.

---

## 8. Step 6: running through the real compiler (JIT)

The interpreter route is convenient but 10-15× slower than native Sapl. The
JIT route writes your program out as Sapl+ text and compiles it with gen1,
the production compiler. The result runs at nearly native speed. It is the
same kernel program, so your language needs **nothing extra**.

### 8.1 How to use it

A writer is a three-line `.spp` (`taalproto/tiny/jit_tiny.spp`):

```
#import "taalproto/naar_sapl.spp"
#import "taalproto/tiny/tiny.spp"
start = printString (langSapl tinyLang (readFile readLine))
```

`langSapl lang src` runs the whole pipeline, including your check and
`kernOptDefs`, and gives Sapl+ text. On an error it gives one comment line,
`// fout: <message>`. The script `taalproto/jit/jit.sh` does the rest:

```bash
bash taalproto/jit/jit.sh taalproto/tiny/jit_tiny.spp taalproto/tiny/progs/queens.tiny
# 92  (printed like runLang does), instr executed: 2298506

bash taalproto/jit/jit.sh -o /tmp/q.spp taalproto/tiny/jit_tiny.spp taalproto/tiny/progs/queens.tiny
# the same, and keeps the generated Sapl+ in /tmp/q.spp
```

### 8.2 What the generated code looks like

From `queens.tiny`:

```
fun length(xs) = match xs { [] -> 0 | x :: r -> 1 + length(r) };
fun extend(k, xs) = mapfil(fn(x) -> safe(xs, 1, x), fn(x) -> x :: xs, fromto(1, k));
```

becomes

```
::V = K_Nil | K_Cons x1 x2
b_main = f_main
f_length v0_xs = (case v0_xs (K_Nil -> 0) (K_Cons v1_x v2_r -> (1 + (f_length v2_r))))
f_extend v0_k v1_xs = (f_mapfil (\v2_x -> (f_safe v1_xs 1 v2_x)) (\v2_x -> (K_Cons v2_x v1_xs)) (f_fromto 1 v0_k))
...
b_ap f x = f x
b_not a = if a False True
...
start = printString (b_show 20 b_main) <#> printString "\n" <#> 0
b_show !d v = ...
```

`start` prints the value the way `runLang` does (`(Cons 1 (Cons 2 Nil))`,
`..` below depth 20), so both routes give the same text, also for lists and
data.

`naar_sapl.spp` does the following for this:

1. **Renaming.** A global function `f` becomes `f_f`, a constructor `C`
   becomes `K_C`, and a local name `x` becomes `v<depth>_x`. No name can
   then clash with a Sapl keyword, a library function, or another binder on
   the same path. That matters because a `let` in Sapl *is* recursive,
   unlike `ELet`.
2. **Lambda lifting.** A local `letrec` becomes a global function with its
   free variables as extra parameters, so that recursion is a direct call.
3. **One data type.** All constructors used in the program go into one
   `::V`, with `Nil` and `Cons` always included.
4. **A small match compiler.** A `case` whose branches are flat constructor
   patterns stays one `case`. Nested and number patterns are compiled so
   that each value is inspected once per group of branches. Here is the
   nested case of `concat`:

   ```
   fun concat(xss) = match xss { [] -> [] | [] :: yss -> concat(yss) | (a :: as) :: yss -> a :: concat(as :: yss) };
   ```

   ```
   f_concat v0_xss = (case v0_xss
       (K_Cons wf_concatMC0_0 wf_concatMC0_1 ->
          (case wf_concatMC0_0
             (K_Cons wf_concatMC0C0_0 wf_concatMC0C0_1 -> (K_Cons wf_concatMC0C0_0 (f_concat (K_Cons wf_concatMC0C0_1 wf_concatMC0_1))))
             (K_Nil -> (f_concat wf_concatMC0_1))
             (_ -> (error "geen passende case-tak"))))
       (K_Nil -> K_Nil)
       (_ -> (error "geen passende case-tak")))
   ```

   The two `Cons` branches share one `case` on `xss`. Before 19 October
   2026 every branch tested `xss` again, in a chain of fallbacks.
5. **A prefix per program.** `langSaplP pre lang src` (and `naarSaplP pre`)
   puts `pre` in front of every global name: `j3_f_length`, `Kj3__Cons`,
   `::Vj3_`, `j3_start`. Then several programs can live in one session
   without clashing; the REPL uses this (section 8.5). `langSapl` is
   `langSaplP ""`.
6. **Small things.**
   - `==` becomes `eqnum` (numeric, like the kernel).
   - `&&` and `||` become `if`.
   - A non-recursive `let` becomes `b_ap (\x -> body) e`, because Sapl+
     doesn't allow `let` in the middle of an expression, nor `(\x -> b) e`
     directly.

### 8.3 How fast

Instructions executed (`./run`), on 19 October 2026:

| Program | Hand-written Sapl | JIT route | Hybrid route |
|---|---|---|---|
| `while/progs/priemen_groot.while` | 7.65M | 9.19M (1.2×) | 95.5M (12.5×) |
| `ml/progs/queens.ml` | 1.7M | 2.23M (1.3×) | 25.1M (15×) |
| `tiny/progs/queens.tiny` | 1.7M | 2.30M (1.4×) | 26.3M |

Writing the program out and compiling it takes about 0.04 s.
`bash taalproto/jit/run_jit.sh -v` runs 22 programs (the example programs
of the four languages and small tests in `taalproto/jit/proef/`, among them
lists, booleans, trees and strings) through both routes and checks that they
print the same.

The remaining gap to native comes from code that a person would write
differently: `a && b` as `if a b False` inside another `if`, no strict
accumulator, and so on. The `b_ap` call per `let` does not show up here:
`kernOptDefs` has already inlined the `let`s in these hot loops.

### 8.4 What the JIT route needs from your translation

- An `ELetRec` binding is best a lambda (a function). A recursive *value*
  works, but differently:
  - Without free variables (`letrec xs = Cons 1 xs`), it becomes a global
    constant and stays a cycle.
  - With free variables (`letrec ys = Cons n ys`), it becomes a function of
    those variables (`g n = Cons n (g n)`). The result is the same, but the
    list is built anew as far as it is used, instead of being one cycle.
- A constructor name must keep the same number of fields in the whole
  program, because there is one data type.
- Strings (`EStr`) are written out as Sapl string literals. A string that
  ends in `f` or contains `..` is split up (`strslice`/`strappend`): the
  Sapl+ preprocessor looks for `f"` (an f-string) and `..` (a range) in the
  raw text, also inside strings, and then adds a helper that needs the
  standard library. The test language `strs` in `taalproto/jit/schrijf.spp`
  checks this.

### 8.5 In the REPL: `:lang`

The REPL in Sapl (`./rs-driver repl_sapl/build/mini_repl.jmvm`, and the REPL
of WebSapl) can load your language. After that, every line that does not
start with `:` is input in your language:

```
repl> :lang "taalproto/tiny/tiny.spp" tinyLang "fun main() = %;"
taal: tinyLang (elke regel is nu invoer in die taal; :sapl voor Sapl)
repl> fun sq(x) = x * x;
gedefinieerd
repl> sq(7) + 1
50
repl> [sq(2), 1 < 0]
(Cons 4 (Cons 0 Nil))
repl> sq(y)
fout: onbekende naam y
repl> :prog taalproto/tiny/progs/queens.tiny
92
repl> :undo
ongedaan gemaakt
```

- The third argument is a **template**: how an expression becomes a program.
  `%` is the place of the expression. For MiniML that is `"let main = %;"`.
  Without a template, every line is a whole program (calc, while).
- A line that still parses as a program together with the definitions so far
  is a **definition** and is kept. Anything else is an **expression**: the
  definitions plus the template become one program.
- That program takes the JIT route **in memory**: your translation, then
  `naar_sapl` with a prefix `j<n>_`, then the REPL's own compiler, linker and
  loader (the same chain as an ordinary REPL line). No file, no new process.
- `:undo` removes the last definition. `:sapl` goes back to Sapl, `:lang`
  (without arguments) back to your language. `:prog file` runs a whole
  program.
- Loading the language takes a few seconds, once (`taalproto/repl_taal.spp`
  and your language are flattened and loaded as a module). After that a line
  takes about 50 ms, nearly all of it compiling.

The step itself is a plain function in `taalproto/repl_taal.spp`:
`replStap lang template prefix definitions line` gives a string that starts
with `D` (the new definitions), `E` (the Sapl+ program to run) or `F` (an
error). You can call it from your own driver as well.

### 8.6 In the browser: the Taallab

`websapl/taallab.html` (WebSapl, 🧪 Taallab) shows your language on the
left and a program on the right. The **Route** menu chooses between:

- **hybride**: the hybrid route (`runLang`);
- **JIT (via gen1)**: `langSapl`, then gen1 compiles the text in the browser
  (20-30 ms), then the VM runs it; the tab *Uitgeschreven Sapl+* shows the
  generated text;
- **beide vergelijken**: both, side by side, with "gelijk" when the results
  are the same.

The tab **REPL** is the REPL of section 8.5 for the language in the editor,
with the template in a field above it.

---

## 9. Cookbook: common constructs and how to translate them

**Lists and other data.** Use `EConstr` with capitalised names. You don't
need a declaration for the kernel. If you want to check constructors, as
MiniML does with `type`, do that in your own check.

```
[1, 2]        → EConstr "Cons" [ENum 1, EConstr "Cons" [ENum 2, EConstr "Nil" []]]
Circle 3      → EConstr "Circle" [ENum 3]
```

**Sugar.** Resolve it in the translation, not in the grammar: `-a` →
`0 - a`, `a :: b` → `Cons a b`, `[a, b]` → nested `Cons`.

**Multi-parameter functions and partial application.** `lams` and `apps`
curry everything, so partial application works by itself:
`apps (EVar "add") [ENum 1]` is a function. Tiny has no syntax for it, but
MiniML does (`safe xs 1`).

**A local recursive function.** Use `letrec1`:

```
letrec1 "loop" (lams ["i"] body) (apps (EVar "loop") [ENum 0])
```

**Assignment (`x := e`).** This becomes a `let` that shadows the old `x`,
with the rest of the program as its body. The while language translates in
continuation style for that: `trS env p s k`, where `k` builds the rest of
the program.

**Loops.** A loop becomes a local recursive function over the variables
that change in it. An `if` that is followed by more code gets a *join point*:
a small function for "the rest", so the rest is not duplicated. See
`taalproto/while/while.spp` and the worked example in `taalproto/README.md`.
The generic optimiser `kernOptDefs` inlines small join points again.

**Fresh names.** Need a name the user can't write? Derive it from the
position in the tree, with a character the lexer never produces in an `Id`:
`loop#1.4`. Then you don't need a counter to thread through the
translation.

**Pattern matching.** Map your patterns directly to `PConstr`/`PVar`/`PNum`/`PWild`,
nested as deep as you like. Both routes compile them, so you don't have to.

---

## 10. Things to know about writing Sapl+ for this

The framework and your language are ordinary Sapl+ (`.spp`). Sapl+ has a few
rules that bite when you write a language. `docs/sapl_programmeer_regels.md`
has the complete list. These are the ones that come up here:

- **No namespaces.** `#import` pastes everything into one program, so your
  constructor and function names must not clash with the framework's. The
  kernel already uses `ENum`, `EVar`, `PVar` and `FuncDef`, and the grammar
  uses `Id`, `Num`, `K`, `N` and `Rule`. Give your language its own prefix,
  as tiny does with `T…` and `ti…`.
- **Compare strings with `strEqual`, not `==`.**
- **No string literal as a pattern.** `tiE (TBin "::" a b)` doesn't work;
  use a guard: `| strEqual op "::" = …`.
- **No constructor pattern inside a list pattern.** Instead of
  `f [TFun n ps b]`, write `f (TFun n ps b : r)`.
- **The clauses of a function must be consecutive.** Don't put another
  function between two clauses of `tiE`.
- **`not` is not available in every combination of imports.** `if c False True`
  always works.
- **Typecheck warnings from imported modules are expected.** `./compile-spp`
  prints functions that don't type, as a warning. Names from `sapl_naar_lc`
  (`sc_…`, `h…`, `lcToScott`, `dec…`) and the grammar interpreter
  (`tpSeqStep`, `__pat_…`) are always in that list. Check that none of
  *your* functions are. You can list them all:
  `echo path/to/file.cfp | ./runfast preprocess/typecheck.jmvm | grep FOUT`.

---

## 11. Reference

### Files

| File | Contents |
|---|---|
| `taalproto/grammatica.spp` | the grammar types, the lexer `tpLex`, the parser `tpParse`, the grammar check `tpCheck` |
| `taalproto/taal.spp` | `::lang`, `langDefs`, `runLang`, the test helpers, the kernel helpers, `kernScope`, `kernOptDefs` |
| `taalproto/naar_sapl.spp` | `langSapl`, `naarSapl`: kernel → Sapl+ text (`langSaplP`/`naarSaplP` with a prefix) |
| `taalproto/repl_taal.spp` | `replStap`: one REPL step for your language (section 8.5) |
| `taalproto/jit/jit.sh` | run a program of your language through gen1 |
| `taalproto/jit/run_jit.sh` | all example programs through both routes, compared |
| `taalproto/run_tests.sh` | the tests of all example languages |
| `Sapl_interpreter/ast.cfp` | the kernel language |
| `sapl_naar_lc/hybride.cfp` | the hybrid route (the interpreter) |

### Functions you call

| Function | Does |
|---|---|
| `Lang name gram check translate` | a language |
| `noCheck` | an own check that accepts everything |
| `langDefs lang src` | `LangOk defs` or `LangErr msg`: the whole front end |
| `runLang lang src` | run via the hybrid route and print the result |
| `langSapl lang src` | the program as Sapl+ text (for gen1) |
| `langSaplP pre lang src` | the same, with prefix `pre` on every global name |
| `replStap lang template pre defs line` | one REPL step: `D`, `E` or `F` plus text (section 8.5) |
| `checkLang` / `checkLangErr` / `checkLangH` | tests (section 7) |
| `kernOptDefs defs` | the generic optimiser (`runLang` and `langSapl` call it for you) |
| `lams`, `apps`, `call`, `bin`, `let1`, `letrec1`, `startDef` | kernel helpers (section 5.2) |
| `tpStrMember x xs`, `union`, `known`, `addName` | name lists as sets (with `strEqual`) |

### The kernel optimiser

`kernOptDefs` applies three rules, all valid in a lazy language. A rule that
would capture a name is not applied.

1. `let j = \v.. -> small in b`: inline the lambda where `j` is used.
2. `(\v -> b) a` becomes `let v = a in b`.
3. `let x = e in b`: inline `e` if it is trivial (a name or a number), or if
   `x` occurs exactly once and not under a lambda.

On the while language, this halved the instructions executed by the hybrid
route.

### Further reading

- `taalproto/README.md`: the framework in Dutch, with measurements and findings.
- `docs/2026-10-17_taalprototypes_plan.md`: the plan and the design decisions.
- `docs/2026-10-18_taalprototypes_jit_en_linken_plan.md`: the JIT route, the
  in-memory route of the REPL, and what comes next (the notebook).
- `repl/README.md`, "Een eigen taal: `:lang`": the REPL side.
- `taalproto/ml/README.md`: what MiniML taught about the design.
