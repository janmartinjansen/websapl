#!/bin/bash
# Bouwt de VM-wasm van WebSapl uit een checkout, voor de warme A/B-meting
# (README.md hier):
#   bash websapl/tools/wasm_ab_meting/bouw.sh <werkmap> <naam> <checkout>
# geeft <werkmap>/wasm_<naam>/jmvm.{js,wasm}. Dezelfde em++-regel als
# websapl/tools/build_wasm.sh (houd ze gelijk); voor de checkout van main
# moet de uitkomst byte-gelijk zijn aan websapl/engine/jmvm.wasm daar, en dat
# wordt gemeld.
set -e
[ $# -eq 3 ] || { echo "gebruik: bouw.sh <werkmap> <naam> <checkout>" >&2; exit 2; }
W=$(mkdir -p "$1" && cd "$1" && pwd); N=$2; C=$(cd "$3" && pwd)
[ -n "$EMSDK" ] || source ~/emsdk/emsdk_env.sh > /dev/null 2>&1
mkdir -p "$W/wasm_$N"
cd "$C"
em++ -O3 -fwasm-exceptions -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sMODULARIZE=1 \
     -sEXPORT_NAME=createJMVMModule \
     -sEXPORTED_RUNTIME_METHODS='["FS","callMain","stringToUTF8","UTF8ToString","ccall","cwrap"]' \
     -lidbfs.js -include vm/variant/runswitch.h vm/parser.cpp vm/parser_geen_tekst.cpp vm/main_run.cpp \
     -o "$W/wasm_$N/jmvm.js" 2> "$W/wasm_$N/bouw.log" || { cat "$W/wasm_$N/bouw.log" >&2; exit 1; }
if cmp -s "$W/wasm_$N/jmvm.wasm" websapl/engine/jmvm.wasm; then
  echo "wasm_$N: gelijk aan websapl/engine/jmvm.wasm van $C"
else
  echo "wasm_$N: gebouwd ($(wc -c < "$W/wasm_$N/jmvm.wasm") bytes; anders dan websapl/engine/jmvm.wasm van $C)"
fi
