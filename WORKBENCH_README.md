## Sapl Workbench — Quick Guide

**Sapl Workbench** is a 100% client-side WebAssembly environment for **Core Sapl** (`.cfp`) and **Sapl+** (`.spp`), executing compiled bytecode on **JMVM** (Jansen's Minimal Virtual Machine) directly in your browser.

---

### Files (Left Sidebar)

- **My Files**: Click **+ New** (in the header or sidebar) to create your own `.spp` or `.cfp` programs. Files are saved locally in your browser (`localStorage`).
- **Sapl+ Demo**: An interactive showcase (`sapl_plus_showcase.spp` and companion `README.md`) illustrating Sapl+ lambdas, comprehensions, pattern guards, f-strings, and `|>` pipelines.
- **Sapl Benchmarks (`.cfp`)**: Standard Core Sapl benchmarks with explicit strictness annotations and simple functional core syntax.
- **Sapl+ Benchmarks (`.spp`)**: Standard Sapl+ benchmarks featuring guards, lambdas, list comprehensions, pattern definitions, and module imports.
- **Local Benchmark Edits**: Editing any benchmark creates a local browser override. Click **Restore original** in the file bar to revert back to the original benchmark.

---

### Running & Strictness

- **Compile & Run** (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Enter</kbd> or <kbd>F5</kbd>): Compiles your program to `.jmvm` bytecode (preprocessing `.spp` → `.cfp` automatically) and executes it on WebAssembly JMVM. Result, execution time, instruction count, heap creates, calls, and GC count appear in the bottom panel.
- **Run**: Executes cached bytecode (compiling first if needed), optionally passing input from **Stdin >**.
- **Strictness**: Toggles automatic strictness analysis on or off. Toggling immediately refreshes any open compiler stage view so you can compare strict (`!`) vs. lazy (`thunk` / `eval`) transformations directly.
- **Save** (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>S</kbd>): Persists your changes to browser storage.

---

### Inspecting Compiler Stages

Use the **View** button bar above the editor to inspect inferred types or one compiler representation at a time inside the same pane:

`Source` → `types` *(Hindley–Milner inferred types)* → `cfp` *(Sapl+ `.spp` files only)* → `parse` → `strictness` → `bool` → `lazytag` → `lift` → `retag` → `jmvm`

Stage views are read-only snapshots of the current source. Click **Source** or **Edit Source** at any time to resume editing.

---

### Quick Examples to Try

Click any example below to open it directly in the editor:

- [sapl_plus_demo_en/sapl_plus_showcase.spp](?file=sapl_plus_demo_en/sapl_plus_showcase.spp) — Six Sapl+ extensions in one showcase program (see [sapl_plus_demo_en/README.md](?file=sapl_plus_demo_en/README.md))
- [benchmarks_sapl/fib.cfp](?file=benchmarks_sapl/fib.cfp) — Recursive `nfib` benchmark in Core Sapl
- [benchmarks_sapl/primes.cfp](?file=benchmarks_sapl/primes.cfp) — Lazy sieve of Eratosthenes in Core Sapl
- [benchmarks_saplplus/queens.spp](?file=benchmarks_saplplus/queens.spp) — N-Queens in Sapl+ (great for inspecting `cfp` and toggling **Strictness** on `retag`)
- [benchmarks_saplplus/knights.spp](?file=benchmarks_saplplus/knights.spp) — Knight's tour in Sapl+

You can reopen this guide anytime by clicking **📖 Guide** in the top bar.
