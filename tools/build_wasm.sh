#!/bin/bash
# Bouwt de twee wasm-modules van WebSapl (vanuit de repo-root, met emsdk):
#   websapl/engine/jmvm.{js,wasm}     de VM; leest alleen .jvb (parser_geen_tekst.cpp)
#   websapl/engine/jvbtool.{js,wasm}  jmvm2jvb + jvb2jmvm (laadformaat/jvbtool_wasm.cpp)
# De tool heeft een grote stack nodig: main zet een Parser op de stack.
# Daarna: de WebSapl-toetsen (websapl/tools/README.md).
set -e
cd "$(dirname "$0")/../.."
[ -n "$EMSDK" ] || source ~/emsdk/emsdk_env.sh > /dev/null 2>&1
E=websapl/engine
em++ -O3 -fwasm-exceptions -DLOAD_CODE_EXPERIMENT -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sMODULARIZE=1 \
     -sEXPORT_NAME=createJMVMModule \
     -sEXPORTED_RUNTIME_METHODS='["FS","callMain","stringToUTF8","UTF8ToString","ccall","cwrap"]' \
     -lidbfs.js -DSWITCH_CASE parser.cpp parser_geen_tekst.cpp vm.cpp -o $E/jmvm.js
T=$(mktemp -d)
em++ -O3 -I. -Dmain=main_jmvm2jvb -c laadformaat/jmvm2jvb.cpp -o $T/a.o
em++ -O3 -I. -Dmain=main_jvb2jmvm -c laadformaat/jvb2jmvm.cpp -o $T/b.o
em++ -O3 -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sMODULARIZE=1 -sEXPORT_NAME=createJvbTool -sINVOKE_RUN=0 -sSTACK_SIZE=8388608 \
     -sEXPORTED_RUNTIME_METHODS='["FS","callMain"]' -I. \
     laadformaat/jvbtool_wasm.cpp $T/a.o $T/b.o laadformaat/jvb_write.cpp parser.cpp parser_tekst.cpp -o $E/jvbtool.js
rm -rf $T
ls -l $E/jmvm.wasm $E/jvbtool.wasm
