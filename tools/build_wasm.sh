#!/bin/bash
# Bouwt de twee wasm-modules van WebSapl (vanuit de repo-root, met emsdk):
#   websapl/engine/jmvm.{js,wasm}     de VM; leest alleen .jvb (vm/parser_geen_tekst.cpp)
#   websapl/engine/jvbtool.{js,wasm}  jmvm2jvb + jvb2jmvm (laadformaat/jvbtool_wasm.cpp)
#   websapl/engine/jmvm_tel.wasm      de VM die ook elke instructie telt (variant
#                                     runswitch; `?tellen=1` op een pagina). jmvm.wasm
#                                     telt alleen calls en creates (variant websapl):
#                                     instructies tellen kostte warm ~8%.
# De tool heeft een grote stack nodig: main zet een Parser op de stack.
# Daarna: de WebSapl-toetsen (websapl/tools/README.md).
set -e
cd "$(dirname "$0")/../.."
[ -n "$EMSDK" ] || source ~/emsdk/emsdk_env.sh > /dev/null 2>&1
E=websapl/engine
em++ -O3 -fwasm-exceptions -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sMODULARIZE=1 \
     -sEXPORT_NAME=createJMVMModule \
     -sEXPORTED_RUNTIME_METHODS='["FS","callMain","stringToUTF8","UTF8ToString","ccall","cwrap"]' \
     -lidbfs.js -include vm/variant/websapl.h vm/parser.cpp vm/parser_geen_tekst.cpp vm/main_run.cpp -o $E/jmvm.js
T=$(mktemp -d)
em++ -O3 -I. -Dmain=main_jmvm2jvb -c laadformaat/jmvm2jvb.cpp -o $T/a.o
em++ -O3 -I. -Dmain=main_jvb2jmvm -c laadformaat/jvb2jmvm.cpp -o $T/b.o
em++ -O3 -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sMODULARIZE=1 -sEXPORT_NAME=createJvbTool -sINVOKE_RUN=0 -sSTACK_SIZE=8388608 \
     -sEXPORTED_RUNTIME_METHODS='["FS","callMain"]' -I. \
     laadformaat/jvbtool_wasm.cpp $T/a.o $T/b.o laadformaat/jvb_write.cpp vm/parser.cpp vm/parser_tekst.cpp -o $E/jvbtool.js
# De tellende VM: dezelfde lijmcode (jmvm.js moet gelijk zijn), alleen de wasm.
em++ -O3 -fwasm-exceptions -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sMODULARIZE=1 \
     -sEXPORT_NAME=createJMVMModule \
     -sEXPORTED_RUNTIME_METHODS='["FS","callMain","stringToUTF8","UTF8ToString","ccall","cwrap"]' \
     -lidbfs.js -include vm/variant/runswitch.h vm/parser.cpp vm/parser_geen_tekst.cpp vm/main_run.cpp -o $T/jmvm.js
cmp -s $T/jmvm.js $E/jmvm.js || { echo "jmvm.js van de tellende VM wijkt af"; exit 1; }
cp $T/jmvm.wasm $E/jmvm_tel.wasm
rm -rf $T
ls -l $E/jmvm.wasm $E/jmvm_tel.wasm $E/jvbtool.wasm
