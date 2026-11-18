#!/bin/bash
# End-to-end check on a throwaway tmux server: install, open a session, click
# "+ new session" in its sidebar, run a hook, close. Touches only a temp folder.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
export HOME=$TMP/home BAND_HOME=$TMP/band BAND_NO_SETTINGS=1 SHELL=/bin/sh
export BAND_OSASCRIPT=/usr/bin/true
mkdir -p "$HOME" "$TMP/work"
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

bash "$ROOT/install.sh" >/dev/null || { echo "install failed"; exit 1; }
B=$BAND_HOME
band=$HOME/.local/bin/band
tmux_bin=$(command -v tmux)
t() { "$tmux_bin" -S "$B/state/tmux.sock" "$@"; }
cleanup() { t kill-server 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

check "band is linked" '[ -L "$band" ]'
check "band version" '[ "$("$band" version)" = "$(cat "$ROOT/VERSION")" ]'

win=$("$band" new --no-attach -n "smoke" -C "$TMP/work" --)
check "band new prints a window id" 'printf %s "$win" | grep -Eq "^@[0-9]+$"'
sleep 2
check "the window has a sidebar and a shell" '[ "$(t list-panes -t "$win" | wc -l | tr -d " ")" = 2 ]'
check "the sidebar is 30 columns" '[ "$(t display-message -p -t "$win.0" "#{pane_width}")" = 30 ]'
check "the sidebar draws its header" 't capture-pane -p -t "$win.0" | head -1 | grep -q "^ band"'
check "the sidebar lists the session" 't capture-pane -p -t "$win.0" | grep -q "smoke"'
check "the sidebar offers a new session" 't capture-pane -p -t "$win.0" | sed -n 8p | grep -q "+ new session"'

t send-keys -t "$win.0" -l $'\e[<0;3;8M\e[<0;3;8m'
sleep 3
check "+ new session opens a terminal window" 't list-windows -t "=band" -F "#{window_name}" | grep -qx terminal'
check "it opens in the same folder" '[ "$(cd "$(t display-message -p -t "=band:terminal.1" "#{pane_current_path}")" && pwd -P)" = "$(cd "$TMP/work" && pwd -P)" ]'

t send-keys -t "$win.1" -l "echo '{}' | '$B/bin/band-state.sh' working"
t send-keys -t "$win.1" Enter
sleep 2
check "a hook writes the window state" '[ "$(t show-options -wqv -t "$win" @band_state)" = working ]'

t send-keys -t "$win.1" -l "exit"
t send-keys -t "$win.1" Enter
sleep 3
check "exiting the shell closes the window" '! t list-windows -t "=band" -F "#{window_id}" | grep -qx "$win"'

bash "$B/install.sh" --uninstall >/dev/null
check "uninstall removes the link" '[ ! -e "$band" ]'

[ "$fails" -eq 0 ] && echo "smoke: all passed" || echo "smoke: $fails failed"
exit "$fails"
