# Sourced by every hook here: the Node of .nvmrc, or a clear refusal.
#
# A git GUI, or a shell started before nvm picked its default, can put an
# older Node first on PATH (this machine's v14 after an app restart), and
# lint-staged 17 and commitlint 21 then crash on syntax. With nvm installed,
# the hook switches itself to .nvmrc's version (husky runs each hook in a
# fresh `sh -e`, so nvm is loaded here, with -e suspended around it).
# Without nvm, an older Node is named and refused instead of failing
# somewhere inside a tool.
want=$(cat .nvmrc 2>/dev/null || true)
major() { node -v 2>/dev/null | sed -e 's/^v//' -e 's/\..*//'; }
if [ -n "$want" ] && [ "$(major)" != "${want%%.*}" ]; then
  nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ -s "$nvm_sh" ]; then
    set +e
    . "$nvm_sh" --no-use
    nvm use --silent "$want" >/dev/null 2>&1
    set -e
  fi
  if [ "$(major)" != "${want%%.*}" ]; then
    echo "husky: this hook needs Node ${want} (.nvmrc), found $(node -v 2>/dev/null || echo none) — nvm install ${want}" >&2
    exit 1
  fi
fi
