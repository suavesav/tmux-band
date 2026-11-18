#!/bin/sh
# install.sh [--uninstall]
# Installs band into $BAND_HOME (default ~/.local/share/band), links bin/band* into
# ~/.local/bin (BAND_NO_LINK=1 skips) and adds the hooks to ~/.claude/settings.json
# and each ~/.claude-*/settings.json (BAND_NO_SETTINGS=1 skips).
SRC=$(CDPATH= cd "$(dirname "$0")" && pwd) || exit 1
B=${BAND_HOME:-$HOME/.local/share/band}
LINKS="$HOME/.local/bin"

NODE_BIN=
for p in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "$(command -v node 2>/dev/null)"; do
  [ -n "$p" ] && [ -x "$p" ] || continue
  "$p" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>/dev/null || continue
  NODE_BIN=$p; break
done
[ -n "$NODE_BIN" ] || { echo "install.sh: node 18 or newer not found" >&2; exit 1; }

status=0
# each_settings <merge|remove> <hooks.mjs>
each_settings() {
  seen=0
  for f in "$HOME/.claude/settings.json" "$HOME"/.claude-*/settings.json "${CLAUDE_CONFIG_DIR:+$CLAUDE_CONFIG_DIR/settings.json}"; do
    [ -n "$f" ] && [ -f "$f" ] || continue
    seen=$((seen + 1))
    "$NODE_BIN" "$2" "$1" "$B" "$f" || status=1
  done
}

if [ "${1:-}" = --uninstall ]; then
  # The hooks come out even when the install folder is already gone.
  if [ -d "$B" ]; then B=$(CDPATH= cd "$B" && pwd) || exit 1; fi
  if [ "${BAND_NO_SETTINGS:-}" != 1 ]; then
    helper="$B/hooks.mjs"
    [ -f "$helper" ] || helper="$SRC/hooks.mjs"
    each_settings remove "$helper"
  fi
  if [ "${BAND_NO_LINK:-}" != 1 ] && [ -d "$LINKS" ]; then
    for l in "$LINKS"/*; do
      [ -L "$l" ] || continue
      case $(readlink "$l") in "$B/bin/"*) rm -f "$l" ;; esac
    done
  fi
  echo "band: hooks and links removed. To remove the rest: close the band window, then rm -rf $B"
  exit "$status"
elif [ $# -gt 0 ]; then
  echo "usage: install.sh [--uninstall]" >&2
  exit 2
fi

mkdir -p "$B/bin" "$B/state" && chmod 700 "$B" "$B/state" || exit 1
B=$(CDPATH= cd "$B" && pwd) || exit 1
if [ ! "$SRC" -ef "$B" ]; then
  # A hook may be running the old file: replace it, never rewrite it in place.
  put() { cp "$1" "$2.new" && { [ "${3:-}" != x ] || chmod +x "$2.new"; } && mv -f "$2.new" "$2"; }
  for f in "$SRC"/bin/*; do
    [ -f "$f" ] || continue
    put "$f" "$B/bin/$(basename "$f")" x || exit 1
  done
  for f in sidebar.mjs sidebar-core.mjs hooks.mjs tmux.conf; do
    put "$SRC/$f" "$B/$f" || exit 1
  done
  put "$SRC/install.sh" "$B/install.sh" x || exit 1
  if [ -f "$SRC/VERSION" ]; then put "$SRC/VERSION" "$B/VERSION" || exit 1; fi
fi
"$NODE_BIN" "$B/hooks.mjs" write "$B" || exit 1
rm -f "$B/state/conf-sourced"

if [ "${BAND_NO_LINK:-}" != 1 ]; then
  mkdir -p "$LINKS" || exit 1
  for f in "$B/bin/band" "$B/bin/band-new" "$B/bin/band-attach" "$B/bin/band-restore"; do
    [ -f "$f" ] || continue
    l="$LINKS/$(basename "$f")"
    if [ -e "$l" ] && [ ! -L "$l" ]; then
      echo "install.sh: $l exists and is not a link, left alone" >&2
      continue
    fi
    ln -sf "$f" "$l" || exit 1
  done
fi

if [ "${BAND_NO_SETTINGS:-}" != 1 ]; then
  if [ -d "$HOME/.claude" ] && [ ! -e "$HOME/.claude/settings.json" ]; then
    printf '{}\n' > "$HOME/.claude/settings.json"
  fi
  each_settings merge "$B/hooks.mjs"
  if [ "$seen" -eq 0 ]; then
    echo "band: no Claude Code settings file found, so no hooks were added. Run Claude Code once, then install again." >&2
  fi
fi

if [ "$status" -eq 0 ]; then echo "band: installed in $B"; fi
exit "$status"
