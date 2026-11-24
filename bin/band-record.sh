#!/bin/sh
# band-record.sh <start|end>  (any other argument: exit 0)
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
SOCK="$B/state/tmux.sock"; REC="$B/state/sessions"
[ -n "$TMUX_PANE" ] && [ -n "$TMUX" ] || exit 0
[ "${TMUX%%,*}" -ef "$SOCK" ] || exit 0
case "$1" in start|end) ;; *) exit 0 ;; esac
t() { "$TMUX_BIN" -S "$SOCK" "$@" 2>/dev/null; }
input=$(cat)
UUID="^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\$"
# The JSON string value of a key, with \" \\ and \/ unescaped.
field() {
  printf '%s' "$input" | sed -nE 's/.*"'"$1"'" *: *"((\\.|[^"\\])*)".*/\1/p' | head -n 1 | sed -E 's/\\(["\\/])/\1/g'
}
id=$(field session_id)
printf %s "$id" | grep -Eq "$UUID" || exit 0
win=$(t display-message -p -t "$TMUX_PANE" '#{window_id}')
owner=
printf %s "$win" | grep -Eq "^@[0-9]+\$" && owner=$(t show-options -wqv -t "$win" @band_session)
if [ "$1" = end ]; then
  # The pane outlives an exit typed in it. A pane that is gone means a closed
  # window (the sidebar removed the record) or a dead server (the record stays).
  [ -n "$owner" ] && [ "$owner" = "$id" ] && rm -f "$REC/$id" 2>/dev/null
  exit 0
fi
printf %s "$win" | grep -Eq "^@[0-9]+\$" || exit 0
# The CLI's pid: the first ancestor that is not a shell.
pid=$PPID; n=0
while [ "$n" -lt 4 ]; do
  comm=$(ps -o comm= -p "$pid" 2>/dev/null) || break
  case "${comm##*/}" in
    sh|bash|zsh|dash|-sh|-bash|-zsh) pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ') ;;
    *) break ;;
  esac
  n=$((n + 1))
done
printf %s "$pid" | grep -Eq "^[0-9]+\$" || pid=
# Another CLI still owns the window: this one was started inside its session.
if [ -n "$owner" ] && [ "$owner" != "$id" ]; then
  held=$(t show-options -wqv -t "$win" @band_pid)
  if printf %s "$held" | grep -Eq "^[0-9]+\$" && [ "$held" != "$pid" ] && kill -0 "$held" 2>/dev/null; then
    exit 0
  fi
  rm -f "$REC/$owner" 2>/dev/null
fi
t set-option -w -t "$win" @band_session "$id" \; set-option -w -t "$win" @band_transcript "$(field transcript_path)" \; set-option -w -t "$win" @band_pid "$pid" >/dev/null
cwd=$(field cwd)
title=$(t display-message -p -t "$win" '#{window_name}')
tag=$(t show-options -wqv -t "$win" @band_tag)
group=$(t show-options -wqv -t "$win" @band_group)
mkdir -p "$REC" 2>/dev/null && chmod 700 "$REC" 2>/dev/null
{ printf '%s\n%s\n%s\n%s\n%s\n' "$cwd" "$title" "$tag" "${CLAUDE_CONFIG_DIR:-}" "$group" > "$REC/$id.tmp"; } 2>/dev/null \
  && mv "$REC/$id.tmp" "$REC/$id" 2>/dev/null
exit 0
