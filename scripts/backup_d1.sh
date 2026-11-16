#!/usr/bin/env bash
# Respaldo de D1: export → verificación (decisión C) → cifrado con age. fase-3-respaldo.md, 3.2.
#
# Uso: AGE_RECIPIENT=age1… scripts/backup_d1.sh <salida.sql.age> <argumentos de `wrangler d1 export`>
#   p. ej.  scripts/backup_d1.sh grimoire.sql.age grimoire --remote
#           scripts/backup_d1.sh bench.sql.age grimoire-bench --env bench --remote
#
# El texto plano solo existe en un temporal que se borra al salir. Al log van conteos, nunca filas,
# y la salida de wrangler no se imprime: trae un enlace firmado de R2 al dump en claro. Si el
# export falla, se imprime con las URL tapadas. Si la verificación falla, no se cifra nada.
set -euo pipefail
out=$1
shift
: "${AGE_RECIPIENT:?falta AGE_RECIPIENT}"
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
dump=$tmp/dump.sql

if ! (cd "$root/api/crates/worker" &&
  npx --yes wrangler@4.156.0 d1 export "$@" --output "$dump" >"$tmp/wrangler.log" 2>&1); then
  sed -E 's#https?://[^[:space:]]+#<url>#g' "$tmp/wrangler.log" >&2
  echo "export FALLÓ" >&2
  exit 1
fi
"${PYTHON:-python3}" -I "$root/scripts/verify_dump.py" "$dump" --migrations "$root/api/migrations"
age -r "$AGE_RECIPIENT" -o "$out" "$dump"
echo "cifrado: $(wc -c <"$out") bytes"
