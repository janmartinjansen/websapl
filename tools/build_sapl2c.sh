#!/bin/bash
# build_sapl2c.sh -- de generator van retag2wasm (sapl_compiler/sapl2c.cfp met sapl2wasm.cfp)
# opnieuw bouwen voor WebSapl (sapl2wasm.html): ./compile -> sapl2c.jmvm (in git) + .jvb,
# dan de kopie in websapl/engine/ (sync_from_repo.js) en de stempel
# websapl/engine/sapl2c.BRON.txt: de sha256 van de bron met opgeloste #imports. Wijkt die af,
# dan meldt node websapl/tools/sync_from_repo.js --check dat sapl2c niet meer bij zijn bron hoort.
# Vanuit de repo-root (of waar dan ook: het script gaat zelf naar de root).
set -e
cd "$(dirname "$0")/../.."
./compile sapl_compiler/sapl2c.cfp
node websapl/tools/sync_from_repo.js > /dev/null || true
{
  echo "# gemaakt door websapl/tools/build_sapl2c.sh; niet met de hand bewerken"
  node websapl/tools/sync_from_repo.js --sapl2c-stempel
} > websapl/engine/sapl2c.BRON.txt
node websapl/tools/sync_from_repo.js --check | tail -1
