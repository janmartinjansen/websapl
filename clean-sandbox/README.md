# Clean sandbox with the JMVM (WebSapl demo)

A modified copy of the Clean sandbox by Camil Staps and TOP Software Technology
(<https://gitlab.com/clean-and-itasks/clean-sandbox>, AGPL-3.0-only, as is this
copy). It is not maintained by TOP.

Changes in this copy:

- the JMVM as a second backend: Clean via `abc2retag`, Sapl via gen1;
- Sapl as a second language, also on the ABC interpreter via `sapl2abc`
  (with abcopt, bcgen, bclink and bcprelink in the browser);
- the 13 benchmarks in Clean and in Sapl as the tour; "Vergelijk" runs both
  backends;
- abcopt (Clean's ABC optimiser) runs in the browser before bcgen.

Built from the branch `jmvm-in-browser` of the private working copy; the
directories `compiler/` and `abc-interpreter/` (sources only) are left out, and
the npm packages the page uses are in `vendor/` (each with its own license).
The Clean sources of the sandbox itself are `sandbox.icl`, `make.icl` and
`make.dcl`.

Do not edit this copy directly: change the sandbox in the fork
(`~/dev/clean-sandbox`, branch `jmvm-in-browser`) and run
`bash tools/naar_websapl.sh` there, which rebuilds this directory (except this
README and `sapl-jmvm-logo.svg`). `--check` only reports differences.
