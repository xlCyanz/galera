#!/usr/bin/env bash
# Comprueba que la versión de Galera es la misma en todos los sitios donde
# se escribe (F8-07, #94):
#
#   - Cargo.toml          [workspace.package] version, la de los tres crates
#   - app/package.json    version, la de la interfaz
#   - app/src-tauri/tauri.conf.json  version, la que llevan los instaladores
#
# Con una etiqueta (`scripts/check-version.sh v0.1.0`), comprueba además que
# la etiqueta es esa versión con una `v` delante. Lo usan el CI, en cada
# cambio, y el workflow de empaquetado, al publicar.
#
# Sale con 1 y dice qué no cuadra si algo no coincide.

set -euo pipefail

cd "$(dirname "$0")/.."

# La primera `version = "…"` después de `[workspace.package]`.
cargo=$(awk '
  /^\[workspace\.package\]/ { inside = 1; next }
  /^\[/ { inside = 0 }
  inside && /^version *=/ { gsub(/.*= *"|".*/, ""); print; exit }
' Cargo.toml)
package=$(node -p 'require("./app/package.json").version')
tauri=$(node -p 'require("./app/src-tauri/tauri.conf.json").version')

echo "Cargo.toml:      $cargo"
echo "package.json:    $package"
echo "tauri.conf.json: $tauri"

status=0
if [ -z "$cargo" ]; then
  echo "::error::No se encuentra la versión en [workspace.package] de Cargo.toml"
  status=1
fi
if [ "$package" != "$cargo" ]; then
  echo "::error::app/package.json dice $package y Cargo.toml dice $cargo"
  status=1
fi
if [ "$tauri" != "$cargo" ]; then
  echo "::error::app/src-tauri/tauri.conf.json dice $tauri y Cargo.toml dice $cargo"
  status=1
fi

if [ $# -gt 0 ]; then
  tag=$1
  echo "etiqueta:        $tag"
  if [ "$tag" != "v$cargo" ]; then
    echo "::error::La etiqueta $tag no es la versión v$cargo"
    status=1
  fi
fi

exit "$status"
