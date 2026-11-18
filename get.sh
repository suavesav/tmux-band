#!/bin/sh
# tmux-band installer:
#   curl -fsSL https://raw.githubusercontent.com/suavesav/tmux-band/main/get.sh | sh
# Downloads the latest release (BAND_REF=<tag or branch> picks another) and runs
# its install.sh, which copies the files into ${BAND_HOME:-~/.local/share/band},
# links the band commands into ~/.local/bin and adds the hooks to the Claude
# Code settings files (a backup is written beside each one it changes).
set -eu

# The body is one function, called on the last line: a download cut short runs nothing.
main() {
  REPO=suavesav/tmux-band
  say() { printf '%s\n' "$*"; }
  die() { say "tmux-band: $*" >&2; exit 1; }

  for tool in curl tar bash; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is required"
  done
  command -v tmux >/dev/null 2>&1 || die "tmux 3.3 or newer is required (brew install tmux, or your package manager)"
  command -v node >/dev/null 2>&1 || die "node 18 or newer is required (brew install node, or https://nodejs.org)"
  case $(tmux -V) in
    "tmux 0."* | "tmux 1."* | "tmux 2."* | "tmux 3.0"* | "tmux 3.1"* | "tmux 3.2"*)
      say "tmux-band: $(tmux -V) is older than 3.3; expect config errors when the window opens" >&2 ;;
  esac

  ref=${BAND_REF:-}
  if [ -z "$ref" ]; then
    ref=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
      | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
    if [ -z "$ref" ]; then
      ref=main
      say "tmux-band: could not read the latest release, using the main branch" >&2
    fi
  fi

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT INT TERM
  say "tmux-band: downloading $ref"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$ref" | tar -xz -C "$tmp" --strip-components=1 \
    || die "could not download $ref"
  [ -f "$tmp/install.sh" ] || die "the download has no install.sh"
  bash "$tmp/install.sh" || die "the installer reported a problem (see above); fix it and run this again"

  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) say "tmux-band: add ~/.local/bin to your PATH to use the band command" ;;
  esac
  say "tmux-band: ready. Run: band"
}

main "$@"
