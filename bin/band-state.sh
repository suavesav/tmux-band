#!/bin/sh
# band-state.sh <working|input|done|clear>
# Claude Code hook: every path exits 0 with no output.
self=$0
while [ -L "$self" ]; do
  link=$(readlink "$self") || exit 0
  case $link in /*) self=$link ;; *) self=$(dirname "$self")/$link ;; esac
done
B=$(CDPATH= cd "$(dirname "$self")/.." 2>/dev/null && pwd) || exit 0
TMUX_BIN=
for p in /opt/homebrew/bin/tmux /usr/local/bin/tmux /usr/bin/tmux; do
  [ -x "$p" ] && { TMUX_BIN=$p; break; }
done
[ -n "$TMUX_BIN" ] || TMUX_BIN=$(command -v tmux 2>/dev/null) || exit 0
[ -n "$TMUX_BIN" ] || exit 0
SOCK="$B/state/tmux.sock"
[ -n "$TMUX_PANE" ] && [ -n "$TMUX" ] || exit 0
[ "${TMUX%%,*}" -ef "$SOCK" ] || exit 0
t() { "$TMUX_BIN" -S "$SOCK" "$@" 2>/dev/null; }
case "$1" in working|input|done|clear) state=$1 ;; *) exit 0 ;; esac
wait=""
input=$(cat)
if [ "$state" = input ]; then
  tool=$(printf '%s' "$input" | sed -n 's/.*"tool_name" *: *"\([^"]*\)".*/\1/p' | head -n 1)
  case "$tool" in
    AskUserQuestion) wait="question" ;;
    ExitPlanMode)    wait="plan approval" ;;
    "")              wait="input needed" ;;
    *)               wait="permission: $tool" ;;
  esac
fi
[ "$state" = clear ] && state=""
win=$(t display-message -p -t "$TMUX_PANE" '#{window_id}')
printf %s "$win" | grep -Eq "^@[0-9]+\$" || exit 0
# A claude started inside this session (claude -p from a tool call) is not the window's.
id=$(printf '%s' "$input" | sed -nE 's/.*"session_id" *: *"([0-9a-f-]{36})".*/\1/p' | head -n 1)
owner=$(t show-options -wqv -t "$win" @band_session)
[ -n "$owner" ] && [ -n "$id" ] && [ "$owner" != "$id" ] && exit 0
cur=$(t show-options -wqv -t "$win" @band_state)
[ "$cur" = seen ] && [ "$state" = done ] && state=seen
if [ "$cur" != "$state" ]; then
  t set-option -w -t "$win" @band_state "$state" \; set-option -w -t "$win" @band_since "$(date +%s)" >/dev/null
fi
t set-option -w -t "$win" @band_wait "$wait" >/dev/null
exit 0
