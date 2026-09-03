/**
 * Default Course Content & Modules for Course Studio
 */
window.DEFAULT_COURSE_DATA = {
  version: "1.0",
  title: "Implementing Functional Languages with Sap(+) & JMVM",
  modules: [
    {
      id: "mod1_foundations",
      title: "Module 1: Foundations & Lazy Semantics",
      files: [
        {
          name: "01_introduction.md",
          type: "markdown",
          content: `# 1. Introduction to Graph Reduction

> [!NOTE] Paper Insight
> Based on Section 1 & 2 of the IFL research paper (*"A Portable VM-based implementation Platform for non-strict Functional Programming Languages"*).

Functional programming languages treat computation as the mathematical evaluation of expressions. In a **lazy (non-strict)** language:
- Expressions are not evaluated when passed as arguments.
- Instead, they are suspended as **Thunks** (graph nodes) on the heap.
- An expression is reduced to **Weak Head Normal Form (WHNF)** only when its value is demanded.

---

## The Core Concept

Unlike stack-based imperative languages that push primitive values directly, a lazy virtual machine manages an **expression graph** that is rewritten step-by-step (*graph reduction*).
`
        },
        {
          name: "02_strict_vs_lazy.md",
          type: "markdown",
          content: `# 2. Strict vs. Lazy Evaluation

> [!NOTE] Paper Insight
> See Section 3 and Figures 2, 4, 6 & 7 in the IFL paper for a detailed comparison of \`fac\` vs \`facl\`.

In **strict** evaluation (call-by-value), function arguments are evaluated before the function body is executed. In **lazy** evaluation (call-by-need), arguments are suspended as closures.

---

## 1. Strict Factorial (\`fac\`)

In Sapl, the exclamation mark (\`!n\`) instructs the compiler that \`n\` is strict:

<SaplPlayground file="fac_strict.cfp" title="Strict Factorial (01_fac.cfp)" />

---

## 2. Lazy Factorial (\`facl\`)

Without strictness annotations, intermediate multiplications must be suspended into thunks:

<SaplPlayground file="fac_lazy.cfp" title="Lazy Factorial (02_facl.cfp)" />
`
        },
        {
          name: "fac_strict.cfp",
          type: "code",
          content: `|| Strict Factorial (01_fac.cfp)
fac !n = case n of
           0 -> 1;
           _ -> n * fac (n - 1)

main = fac 10`
        },
        {
          name: "fac_lazy.cfp",
          type: "code",
          content: `|| Lazy Factorial (02_facl.cfp)
facl n = case n of
            0 -> 1;
            _ -> n * facl (n - 1)

main = facl 10`
        }
      ]
    },
    {
      id: "mod2_higher_order",
      title: "Module 2: Higher-Order Functions & Currying",
      files: [
        {
          name: "01_higher_order_functions.md",
          type: "markdown",
          content: `# Higher-Order Functions & Supercombinators

> [!NOTE] Paper Insight
> Section 4 & Figure 3: Currying, partial application, and over-saturated application chains.

In functional programming, functions can accept other functions as arguments and return new functions.

---

## The \`twice\` Function

$$\\text{twice } f\\ x = f\\ (f\\ x)$$

<SaplPlayground file="twice.cfp" title="Higher-Order Twice (03_twice.cfp)" />
`
        },
        {
          name: "twice.cfp",
          type: "code",
          content: `|| Higher-Order Twice (03_twice.cfp)
inc !x = x + 1
twice f x = f (f x)

main = twice inc 5`
        },
        {
          name: "twicex.cfp",
          type: "code",
          content: `|| Deep Curried Chain (04_twicex.cfp)
inc !x = x + 1
twice f x = f (f x)
twicex = twice twice twice twice inc 0

main = twicex`
        }
      ]
    },
    {
      id: "mod3_streams",
      title: "Module 3: Infinite Data Streams",
      files: [
        {
          name: "01_infinite_primes.md",
          type: "markdown",
          content: `# Infinite Streams: The Sieve of Eratosthenes

> [!NOTE] Paper Insight
> Section 5.1 & Figure 8: Generating an infinite stream of prime numbers using lazy lists.

Because evaluation is lazy, we can define infinite data structures without running into an infinite loop. Elements are computed on demand as the list is consumed.

<SaplPlayground file="primes.cfp" title="Infinite Primes Stream (06_primes.cfp)" />
`
        },
        {
          name: "primes.cfp",
          type: "code",
          content: `|| Infinite Primes Stream (06_primes.cfp)
from !n = Cons n (from (n + 1))

sieve (Cons p xs) = Cons p (sieve (filter p xs))

filter !p (Cons x xs) =
  case (x % p == 0) of
    True  -> filter p xs;
    False -> Cons x (filter p xs)

el !n (Cons x xs) =
  case n of
    1 -> x;
    _ -> el (n - 1) xs

main = el 20 (sieve (from 2))`
        }
      ]
    },
    {
      id: "mod4_cyclic",
      title: "Module 4: Cyclic Data Structures",
      files: [
        {
          name: "01_tie_the_knot.md",
          type: "markdown",
          content: `# Cyclic Graphs & "Tie-the-Knot"

> [!NOTE] Paper Insight
> Section 5.2 & Figure 5: Mutual recursion, heap node updates, and Hamming numbers.

In JMVM, circular references are resolved by overwriting existing heap nodes with \`UPDATE\` instructions. This ensures that shared nodes are never recomputed.

<SaplPlayground file="hamming.cfp" title="Hamming Numbers (07_hamming.cfp)" />
`
        },
        {
          name: "hamming.cfp",
          type: "code",
          content: `|| Hamming Numbers with 3-way Mutual Cycle (07_hamming.cfp)
merge (Cons x xs) (Cons y ys) =
  case (x < y) of
    True  -> Cons x (merge xs (Cons y ys));
    False -> case (x > y) of
               True  -> Cons y (merge (Cons x xs) ys);
               False -> Cons x (merge xs ys)

map !f (Cons x xs) = Cons (f x) (map f xs)
mult !c !x = c * x

hamming = Cons 1 (merge (map (mult 2) hamming)
                        (merge (map (mult 3) hamming)
                               (map (mult 5) hamming)))

el !n (Cons x xs) =
  case n of
    1 -> x;
    _ -> el (n - 1) xs

main = el 30 hamming`
        }
      ]
    }
  ]
};
