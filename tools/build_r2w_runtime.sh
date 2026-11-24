#!/bin/bash
# build_r2w_runtime.sh -- de runtime van retag2wasm (rt.h via experiments/sapl2c/wasm/r2w/rt_wasm.c,
# met emcc) naar websapl/engine/r2w/rt.js + rt.wasm, voor de pagina sapl2wasm.html.
# Schrijft ook de stempel websapl/engine/r2w/BRON.txt (sha256 van de bronnen en de bouwvlaggen);
# node websapl/tools/sync_from_repo.js --check meldt het als de runtime niet meer bij rt.h hoort.
# Vanuit de repo-root, met emsdk. Heap 8M cellen (zie docs/2026-11-24_retag2wasm_in_websapl_plan.md).
set -e
cd "$(dirname "$0")/../.."
U=websapl/engine/r2w
HEAPCELLS=8000000
export STACKCELLS=2000000   # de eigen stack van de voortzettingsvorm (de 13 benchmarks: <1M)
bash experiments/sapl2c/wasm/r2w/bouw.sh "$U" "$HEAPCELLS" rt
{
  echo "# gemaakt door websapl/tools/build_r2w_runtime.sh; niet met de hand bewerken"
  echo "heapcells: $HEAPCELLS, stackcells: $STACKCELLS"
  node websapl/tools/sync_from_repo.js --r2w-stempel
} > "$U/BRON.txt"
echo "stempel: $U/BRON.txt"
