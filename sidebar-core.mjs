// Pure layout, drawing and hit-testing for the band sidebar. No I/O.

const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const ACTIVE_BG = `${ESC}[48;5;237m`;
const DRAG_BG = `${ESC}[48;5;239m`;
const DRAG_LOOK = { mark: '↕', color: 75 };
const DIM = 244;

const HEADER_LINES = 2;
const ROW_LINES = 4;
const TABLE_HEADER_LINES = 3;
const NEW_TEXT = ' + new session';
const NEW_LINES = 2;
const CLOSE_TEXT = ' ✕ ';
const EXPAND_TEXT = '⤢ ';
const CONFIRM_TEXT = ' Close?  yes   no';
const COLLAPSE_TEXT = '⤡ collapse ';
const BADGE_MIN_ROOM = 12;
const MAX_PRS = 3;
// A spacer, then the group's title line.
const HEAD_LINES = 2;
const EYE_COLS = 3;
const FOCUS_COLOR = 75;
const HEAD_COLOR = 176;
// The new group box under the new-session line: top edge, label, bottom edge.
const BOX_LINES = 3;
const BOX_TEXT = 'new group';
const TABLE_BOX_TEXT = ' ┆ new group ┆';
export const GROUP_MAX = 24;

const LOOKS = {
  input: { mark: '●', color: 214, label: 'needs input' },
  done: { mark: '✓', color: 71, label: 'done' },
  working: { mark: '◌', color: 75, label: 'working' },
  seen: { mark: '✓', color: DIM, label: '' },
};
const UNKNOWN_LOOK = { mark: '·', color: DIM, label: '' };
const look = (state) => (Object.hasOwn(LOOKS, state) ? LOOKS[state] : UNKNOWN_LOOK);

const CI = {
  p: { mark: '✓', color: 71, word: 'passing' },
  f: { mark: '✗', color: 203, word: 'failing' },
  r: { mark: '◌', color: 75, word: 'running' },
};

const COLUMNS = [
  { key: 'state', title: 'STATE', width: 19 },
  { key: 'session', title: 'SESSION', width: 16 },
  { key: 'repo', title: 'REPO · BRANCH', width: 30 },
  { key: 'pr', title: 'PR · CI', width: 28 },
  { key: 'wait', title: 'WAITING ON', width: 20 },
  { key: 'model', title: 'MODEL · MODE', width: 20 },
];

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

const fg = (n, s) => `${ESC}[38;5;${n}m${s}${ESC}[39m`;
const bold = (s) => `${ESC}[1m${s}${ESC}[22m`;

function charWidth(cp) {
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)
  ) return 2;
  return 1;
}

export function textWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += charWidth(ch.codePointAt(0));
  return w;
}

export function fit(s, width) {
  if (!(width > 0)) return '';
  s = String(s ?? '');
  const w = textWidth(s);
  if (w <= width) return s + ' '.repeat(width - w);
  let out = '';
  let used = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0));
    if (used + cw > width - 1) break;
    out += ch;
    used += cw;
  }
  return out + '…' + ' '.repeat(width - used - 1);
}

export function age(now, since) {
  if (!now || !since || now < since) return '';
  const s = now - since;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const stateText = (row, now) => [look(row.state).label, age(now, row.since)].filter(Boolean).join(' ');

function basename(p) {
  const parts = String(p ?? '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

export function repoLabel(rev, cwd) {
  const [common = '', branch = ''] = String(rev ?? '').split('\n').map((s) => s.trim());
  if (!common.startsWith('/')) return basename(cwd);
  const parts = common.split('/').filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : '';
  const repo = last === '.git' ? (parts.length > 1 ? parts[parts.length - 2] : '') : last.replace(/\.git$/, '');
  return `${repo} · ${!branch || branch === 'HEAD' ? 'detached' : branch}`;
}

export const needsConfirm = (state) => state !== 'done' && state !== 'seen';

export function optionValue(s, max = 40) {
  const clean = String(s ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(clean).slice(0, max).join('').replace(/[;\s]+$/, '');
}

export const NAME_MAX = 120;

export function nameOf(text) {
  for (const row of String(text ?? '').split(/\r?\n/)) {
    const name = optionValue(row, NAME_MAX);
    if (name) return name;
  }
  return '';
}

// A transcript line's name for its window: { title } from Claude Code's
// `ai-title` line, { prompt } from a typed prompt, null from anything else.
export function entryName(entry) {
  if (entry?.type === 'ai-title') {
    const title = nameOf(entry.aiTitle);
    return title ? { title } : null;
  }
  if (entry?.type !== 'user' || entry.isMeta || entry.isSidechain) return null;
  const content = entry.message?.content;
  const texts = typeof content === 'string' ? [content]
    : Array.isArray(content) ? content.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text) : [];
  const typed = texts.map((t) => t.trim()).find((t) => t && !t.startsWith('<') && !t.startsWith('[Request interrupted'));
  const prompt = nameOf(typed);
  return prompt ? { prompt } : null;
}

export function parseWindows(stdout) {
  const rows = [];
  for (const line of String(stdout ?? '').split('\n')) {
    const f = line.split('\t');
    const text = (i) => (f[i] ?? '').replace(CONTROL, '');
    const id = f[0] ?? '';
    if (!/^@\d+$/.test(id)) continue;
    rows.push({
      id,
      active: f[1] === '1',
      state: text(2),
      tag: text(3),
      since: /^\d+$/.test(f[4] ?? '') ? Number(f[4]) : 0,
      wait: text(5),
      model: text(6),
      repo: text(7),
      pr: text(8),
      group: text(9),
      name: f.slice(10).join(' ').replace(CONTROL, ''),
    });
  }
  return rows;
}

// ---- pull requests ----

const PR_ITEM = /^([1-9]\d{0,8}):([omc]):([pfr]?)$/;

export function parsePrs(value) {
  const prs = [];
  for (const item of String(value ?? '').split(',')) {
    const m = PR_ITEM.exec(item);
    if (m) prs.push({ number: Number(m[1]), state: m[2], ci: m[3] });
    if (prs.length === MAX_PRS) break;
  }
  return prs;
}

export function prValue(prs) {
  const out = [];
  for (const pr of prs ?? []) {
    const item = `${pr?.number}:${pr?.state}:${pr?.ci ?? ''}`;
    if (PR_ITEM.test(item)) out.push(item);
    if (out.length === MAX_PRS) break;
  }
  return out.join(',');
}

function leadPr(prs) {
  const open = prs.filter((p) => p.state === 'o');
  for (const ci of ['f', 'r', 'p', '']) {
    const hit = open.find((p) => p.ci === ci);
    if (hit) return hit;
  }
  return prs[prs.length - 1];
}

function prColor(pr) {
  if (pr.state === 'm') return 141;
  if (pr.state === 'c') return DIM;
  return CI[pr.ci]?.color ?? DIM;
}

function prWord(pr) {
  if (pr.state === 'm') return 'merged';
  if (pr.state === 'c') return 'closed';
  return CI[pr.ci]?.word ?? 'open';
}

export function prBadge(prs) {
  if (!prs || !prs.length) return null;
  const lead = leadPr(prs);
  let text = `#${lead.number}`;
  if (prs.length > 1) text += `+${prs.length - 1}`;
  if (lead.state === 'o') {
    if (CI[lead.ci]) text += ` ${CI[lead.ci].mark}`;
  } else {
    text += lead.state === 'm' ? ' merged' : ' closed';
  }
  return { text, color: prColor(lead) };
}

export function prCell(prs) {
  if (!prs || !prs.length) return { text: '', color: DIM };
  return { text: prs.map((p) => `#${p.number} ${prWord(p)}`).join(', '), color: prColor(leadPr(prs)) };
}

// ---- groups ----

// A name for `@band_group` or `@band_focus`: tmux expands `#` in formats and
// ends a command at an argument ending in `;`.
export const groupName = (s) => optionValue(String(s ?? '').replace(/#/g, ''), GROUP_MAX);

export function newGroupName(rows) {
  const used = new Set(rows.map((r) => r.group));
  let n = 1;
  while (used.has(`group ${n}`)) n++;
  return `group ${n}`;
}

const focusOf = (rows, focus) => (focus && rows.some((r) => r.group === focus) ? focus : null);
const rowItem = (row, group) => ({ kind: 'row', key: row.id, row, group });
const headItem = (group) => ({ kind: 'head', key: `g:${group}`, group });

// The list both views draw: ungrouped rows, then each group (in the order of
// its first member) as a head and its rows. `order` is a drag's item keys; a
// row there belongs to the nearest head above it.
export function listItems({ rows, focus = null, order = null }) {
  const on = focusOf(rows, focus);
  if (!order) {
    const shown = on ? rows.filter((r) => r.group === on) : rows;
    const out = shown.filter((r) => !r.group).map((r) => rowItem(r, ''));
    for (const group of new Set(shown.map((r) => r.group).filter(Boolean))) {
      out.push(headItem(group), ...shown.filter((r) => r.group === group).map((r) => rowItem(r, group)));
    }
    return out;
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = [];
  let group = '';
  for (const key of order) {
    if (key.startsWith('g:')) {
      group = key.slice(2);
      out.push(headItem(group));
    } else if (byId.has(key)) {
      out.push(rowItem(byId.get(key), group));
    }
  }
  const listed = new Set(order);
  for (const r of rows) {
    if (listed.has(r.id) || (on && r.group !== on)) continue;
    let at = out.findIndex((i) => i.kind === 'head' && (!r.group || i.group === r.group));
    if (r.group && at < 0) at = out.push(headItem(r.group)) - 1;
    if (at < 0) at = out.length;
    else if (r.group) for (at++; at < out.length && out[at].kind === 'row'; at++);
    out.splice(at, 0, rowItem(r, r.group));
  }
  return out;
}

function waitingText(items, rows, focus) {
  const on = focusOf(rows, focus);
  const input = (r) => r.state === 'input';
  const waiting = items.filter((i) => i.kind === 'row' && input(i.row)).length;
  const elsewhere = on ? rows.filter((r) => r.group !== on && input(r)).length : 0;
  return { waiting, elsewhere: elsewhere ? `, ${elsewhere} elsewhere` : '' };
}

// headHit() reads the eye in the last EYE_COLS.
function headLine(group, width, focused, draft) {
  if (width < EYE_COLS + 2) return fit('', width);
  const eye = focused ? fg(FOCUS_COLOR, ' ◉ ') : fg(DIM, ' ◎ ');
  const room = width - EYE_COLS - 1;
  if (draft !== null) {
    let text = `${draft}▏`;
    while (textWidth(text) > room) text = Array.from(text).slice(1).join('');
    return ` ${fg(HEAD_COLOR, fit(text, room))}${eye}`;
  }
  if (textWidth(group) + 1 > room) return ` ${fg(HEAD_COLOR, bold(fit(group, room)))}${eye}`;
  return ` ${fg(HEAD_COLOR, `${bold(group)} ${'─'.repeat(room - textWidth(group) - 1)}`)}${eye}`;
}

function headHit(group, x, width) {
  return { kind: x > width - EYE_COLS ? 'focus' : 'rename', id: null, group };
}

// ---- the viewport ----

// The index of the first item shown: `start` when given (a drag holds the
// view still), else the smallest that shows the head being renamed whole,
// else the active row.
function firstShown(items, lines, room, start, editing) {
  let last = items.length;
  for (let used = 0; last > 0 && used + lines[last - 1] <= room; last--) used += lines[last - 1];
  if (start !== null && start !== undefined) return Math.max(0, Math.min(start, last));
  const head = editing === null ? -1 : items.findIndex((i) => i.kind === 'head' && i.group === editing);
  const target = head >= 0 ? head : items.findIndex((i) => i.kind === 'row' && i.row.active);
  if (target < 0) return 0;
  let first = target + 1;
  for (let used = 0; first > 0 && used + lines[first - 1] <= room; first--) used += lines[first - 1];
  return Math.min(first, last);
}

// The items shown, each with `at`, the 1-based line it starts on, and `lines`.
function place(items, { height, start, zoomed, editing = null }) {
  const lines = items.map((i) => (zoomed ? 1 : i.kind === 'head' ? HEAD_LINES : ROW_LINES));
  const top = zoomed ? TABLE_HEADER_LINES : HEADER_LINES;
  const room = Math.max(0, height - top - (zoomed ? 0 : NEW_LINES + BOX_LINES));
  const out = [];
  let used = 0;
  for (let i = firstShown(items, lines, room, start, editing); i < items.length && used + lines[i] <= room; i++) {
    out.push({ ...items[i], at: top + 1 + used, lines: lines[i] });
    used += lines[i];
  }
  return out;
}

// ---- normal view ----

// listItems() entries plus `top`, the 1-based line of the item's spacer.
export function layout({ rows, height, start = null, focus = null, order = null }) {
  return place(listItems({ rows, focus, order }), { height, start, zoomed: false })
    .map(({ at, lines, ...item }) => ({ ...item, top: at }));
}

const newLineOf = (shown) => HEADER_LINES + shown.reduce((n, s) => n + s.lines, 0) + NEW_LINES;

// The 1-based line of `+ new session`; the new group box is the lines under it.
export function newLine({ rows, height, start = null, focus = null, order = null }) {
  return newLineOf(place(listItems({ rows, focus, order }), { height, start, zoomed: false }));
}

const dropTone = (text, drop) => (drop === 'new' ? `${DRAG_BG}${fg(FOCUS_COLOR, text)}${RESET}` : fg(DIM, text));

// The BOX_LINES lines of the new group box, one column in from each side.
function newGroupBox(width, drop) {
  const inner = width - 4;
  if (inner < BOX_TEXT.length) return Array.from({ length: BOX_LINES }, () => fit('', width));
  const left = Math.floor((inner - BOX_TEXT.length) / 2);
  const label = ' '.repeat(left) + BOX_TEXT + ' '.repeat(inner - BOX_TEXT.length - left);
  return [`┌${'┄'.repeat(inner)}┐`, `┆${label}┆`, `└${'┄'.repeat(inner)}┘`].map((l) => dropTone(` ${l} `, drop));
}

export function render({ rows, width, height, confirm = null, now = 0, dragging = null, start = null, order = null, drop = null, focus = null, edit = null }) {
  const items = listItems({ rows, focus, order });
  const on = focusOf(rows, focus);
  const lines = [];
  lines.push(width > 7 ? bold(fit(' band', width - 2)) + fg(DIM, EXPAND_TEXT) : bold(fit(' band', width)));
  const { waiting, elsewhere } = waitingText(items, rows, focus);
  const summary = waiting === 0 ? ' nothing waiting' : waiting === 1 ? ' 1 needs input' : ` ${waiting} need input`;
  lines.push(fg(DIM, fit(summary + elsewhere, width)));
  for (const item of place(items, { height, start, zoomed: false, editing: edit?.group ?? null })) {
    if (item.kind === 'head') {
      lines.push(fit('', width), headLine(item.group, width, on === item.group, edit?.group === item.group ? edit.text : null));
      continue;
    }
    const { row } = item;
    const { color } = look(row.state);
    const held = dragging !== null && dragging === row.id;
    const lead = held ? DRAG_LOOK : look(row.state);
    const bg = held ? DRAG_BG : row.active ? ACTIVE_BG : '';
    lines.push(fit('', width));
    if (width > 6) {
      const name = fit(row.name, width - 6);
      lines.push(`${bg} ${fg(lead.color, lead.mark)} ${row.active ? bold(name) : name}${fg(DIM, CLOSE_TEXT)}${RESET}`);
    } else {
      lines.push(bg + fit('', width) + RESET);
    }
    if (confirm !== null && confirm === row.id) {
      lines.push(bg + fit(CONFIRM_TEXT, width) + RESET);
    } else {
      const label = '   ' + stateText(row, now);
      const tag = row.tag ? ' ' + row.tag : '';
      const badge = prBadge(parsePrs(row.pr));
      const badgeText = badge && width - textWidth(badge.text) - 2 >= BADGE_MIN_ROOM ? ` ${badge.text} ` : '';
      const text = fit(label + tag, width - textWidth(badgeText));
      lines.push(
        bg + fg(color, text.slice(0, label.length)) + fg(DIM, text.slice(label.length)) +
        (badgeText ? fg(badge.color, badgeText) : '') + RESET,
      );
    }
    lines.push(bg + fg(DIM, fit('   ' + row.repo, width)) + RESET);
  }
  lines.push(fit('', width));
  lines.push(fg(DIM, fit(NEW_TEXT, width)));
  lines.push(...newGroupBox(width, drop));
  return lines.slice(0, Math.max(0, height)).join('\n');
}

function confirmHit(x, id) {
  if (x >= 10 && x <= 12) return { kind: 'yes', id };
  if (x >= 16 && x <= 17) return { kind: 'no', id };
  return { kind: 'none', id: null };
}

export function hit({ x, y, rows, width, height, confirm = null, focus = null }) {
  if (y === 1 && x > width - 3) return { kind: 'expand', id: null };
  if (y === newLine({ rows, height, focus }) && x <= textWidth(NEW_TEXT)) return { kind: 'new', id: null };
  for (const item of layout({ rows, height, focus })) {
    const { top } = item;
    if (item.kind === 'head') {
      if (y === top + 1) return headHit(item.group, x, width);
      if (y === top) return { kind: 'none', id: null };
      continue;
    }
    if (y < top || y >= top + ROW_LINES) continue;
    const line = y - top;
    const id = item.row.id;
    if (confirm !== null && confirm === id && line === 2) return confirmHit(x, id);
    if (line === 1 && x > width - 3) return { kind: 'close', id };
    return { kind: 'select', id };
  }
  return { kind: 'none', id: null };
}

// ---- table view ----

// listItems() entries plus `y`, the 1-based line of the item.
export function tableLayout({ rows, height, start = null, focus = null, order = null }) {
  return place(listItems({ rows, focus, order }), { height, start, zoomed: true })
    .map(({ at, lines, ...item }) => ({ ...item, y: at }));
}

function tableColumns(width) {
  const cols = COLUMNS.map((c) => ({ ...c }));
  const total = () => 1 + cols.reduce((n, c) => n + c.width, 0) + 3;
  while (cols.length > 2 && total() > width) cols.pop();
  const session = cols.find((c) => c.key === 'session');
  session.width = Math.max(16, 16 + width - total());
  return cols;
}

function tableCell(col, row, now, held) {
  const { mark, color } = look(row.state);
  const w = col.width;
  switch (col.key) {
    case 'state':
      return held
        ? fg(DRAG_LOOK.color, DRAG_LOOK.mark) + fg(color, fit(` ${stateText(row, now)}`, w - 1))
        : fg(color, fit(`${mark} ${stateText(row, now)}`, w));
    case 'session': {
      const name = fit(row.name, w - 1);
      return (row.active ? bold(name) : name) + ' ';
    }
    case 'repo': return fit(row.repo, w - 1) + ' ';
    case 'pr': {
      const cell = prCell(parsePrs(row.pr));
      return fg(cell.color, fit(cell.text, w - 1) + ' ');
    }
    case 'wait': return fg(color, fit(row.wait, w - 1) + ' ');
    default: return fg(DIM, fit(row.model, w));
  }
}

export function renderTable({ rows, width, height, confirm = null, now = 0, dragging = null, start = null, order = null, drop = null, focus = null, edit = null }) {
  const cols = tableColumns(width);
  const sum = cols.reduce((n, c) => n + c.width, 0);
  const items = listItems({ rows, focus, order });
  const on = focusOf(rows, focus);
  const count = items.filter((i) => i.kind === 'row').length;
  const { waiting, elsewhere } = waitingText(items, rows, focus);
  const summary = ` band   ${count} session${count === 1 ? '' : 's'}, ${waiting} need${waiting === 1 ? 's' : ''} input${elsewhere}`;
  const lines = [];
  lines.push(width > 17 ? bold(fit(summary, width - 11)) + fg(DIM, COLLAPSE_TEXT) : bold(fit(summary, width)));
  lines.push(dropTone(fit(TABLE_BOX_TEXT, width), drop));
  lines.push(fg(DIM, fit(' ' + cols.map((c) => fit(c.title, c.width)).join(''), width)));
  for (const item of place(items, { height, start, zoomed: true, editing: edit?.group ?? null })) {
    if (item.kind === 'head') {
      lines.push(headLine(item.group, width, on === item.group, edit?.group === item.group ? edit.text : null));
      continue;
    }
    const { row } = item;
    const held = dragging !== null && dragging === row.id;
    const bg = held ? DRAG_BG : row.active ? ACTIVE_BG : '';
    if (confirm !== null && confirm === row.id) {
      lines.push(bg + fit(CONFIRM_TEXT, width) + RESET);
      continue;
    }
    const fill = ' '.repeat(Math.max(0, width - (1 + sum) - 3));
    lines.push(`${bg} ${cols.map((c) => tableCell(c, row, now, held)).join('')}${fill}${fg(DIM, CLOSE_TEXT)}${RESET}`);
  }
  return lines.slice(0, Math.max(0, height)).join('\n');
}

export function hitTable({ x, y, rows, width, height, confirm = null, focus = null }) {
  if (y === 1) return { kind: x > width - 11 ? 'collapse' : 'none', id: null };
  const at = tableLayout({ rows, height, focus }).find((r) => r.y === y);
  if (!at) return { kind: 'none', id: null };
  if (at.kind === 'head') return headHit(at.group, x, width);
  const id = at.row.id;
  if (confirm !== null && confirm === id) return confirmHit(x, id);
  if (x > width - 3) return { kind: 'close', id };
  return { kind: 'select', id };
}

// ---- dragging a row to reorder ----

// tmux sends a release to the pane under the pointer, so a drag that ends
// outside the sidebar never ends here: one with no mouse event for this long
// is over.
export const DRAG_STALE_MS = 10_000;
// A press that slips one line within this time is still a click.
const DRAG_SLIP_MS = 250;

// The lines of the items shown: [{ key, from, to }]. A head's spacer is its own.
function spans(items, { height, start, zoomed }) {
  return place(items, { height, start, zoomed }).map((s) => ({ key: s.key, from: s.at, to: s.at + s.lines - 1 }));
}

// `ids` with `id` moved to where `over` is.
export function moveId(ids, id, over) {
  const from = ids.indexOf(id);
  const to = ids.indexOf(over);
  if (from < 0 || to < 0 || from === to) return ids;
  const out = ids.filter((v) => v !== id);
  out.splice(to, 0, id);
  return out;
}

// The tmux arguments that put window `id` where `order` has it; null when
// `id` is alone or missing.
export function moveArgs(order, id) {
  const at = order.indexOf(id);
  if (at < 0 || order.length < 2) return null;
  return at < order.length - 1
    ? ['move-window', '-d', '-b', '-s', id, '-t', order[at + 1]]
    : ['move-window', '-d', '-a', '-s', id, '-t', order[at - 1]];
}

// A press on row `id` at line y. { id, order, start, drop, y, at, last,
// engaged, moved }: `order` is the item keys listed at the press, `start` the
// first item shown, held for the whole drag, `drop` 'new' over the new group box.
export function dragBegin({ id, y, rows, height, zoomed = false, now, focus = null }) {
  const items = listItems({ rows, focus });
  const first = spans(items, { height, start: null, zoomed })[0];
  return {
    id, y, at: now, last: now, engaged: false, moved: false, drop: null,
    order: items.map((i) => i.key),
    start: first ? items.findIndex((i) => i.key === first.key) : 0,
  };
}

export function dragMove(drag, { y, rows, height, zoomed = false, now, focus = null }) {
  const next = { ...drag, last: now };
  if (!next.engaged) {
    const dy = Math.abs(y - drag.y);
    if (dy < 1 || (dy < 2 && now - drag.at < DRAG_SLIP_MS)) return next;
    next.engaged = true;
  }
  const items = listItems({ rows, focus, order: next.order });
  let shown = spans(items, { height, start: next.start, zoomed });
  const box = zoomed ? y === 2 : y > newLineOf(place(items, { height, start: next.start, zoomed: false }));
  next.drop = box ? 'new' : null;
  if (box || !shown.length) return next;
  next.start = items.findIndex((i) => i.key === shown[0].key);
  // The first and last items shown are the scroll zones: the table's last
  // line is the pane's last line, so there is nothing below it to reach.
  if (y <= shown[0].to && next.start > 0) next.start -= 1;
  else if (y >= shown.at(-1).from && next.start + shown.length < items.length) next.start += 1;
  shown = spans(items, { height, start: next.start, zoomed });
  const over = (shown.filter((s) => y >= s.from).at(-1) || shown[0]).key;
  if (over !== next.id) {
    next.order = moveId(items.map((i) => i.key), next.id, over);
    next.moved = true;
  }
  return next;
}

// What a release does: { kind: 'select', id } for a row that never moved,
// { kind: 'move', id, args, group, created }, else { kind: 'none' }. `group`
// is null when it stays. A section lists its rows in tmux's order, so `args`
// names a neighbour from the row's own section, and is null when tmux
// already has the section in the previewed order.
export function dragEnd(drag, rows, focus = null) {
  const row = drag && rows.find((r) => r.id === drag.id);
  if (!row) return { kind: 'none' };
  const ids = rows.map((r) => r.id);
  if (drag.engaged && drag.drop === 'new') {
    const args = ids.at(-1) === row.id ? null : moveArgs(ids.filter((v) => v !== row.id).concat(row.id), row.id);
    return { kind: 'move', id: row.id, args, group: newGroupName(rows), created: true };
  }
  if (!drag.moved) return { kind: 'select', id: row.id };
  const items = listItems({ rows, focus, order: drag.order });
  const to = items.find((i) => i.key === row.id).group;
  const section = items
    .filter((i) => i.kind === 'row' && i.group === to && (i.key === row.id || i.row.group === to))
    .map((i) => i.key);
  const listed = new Set(section);
  const already = ids.filter((v) => listed.has(v)).every((v, i) => v === section[i]);
  const args = already ? null : moveArgs(section, row.id);
  const group = to === row.group ? null : to;
  if (!args && group === null) return { kind: 'none' };
  return { kind: 'move', id: row.id, args, group, created: false };
}

// One tmux argv from argv lists: a lone `;` argument separates commands.
export const chain = (cmds) => cmds.flatMap((c, i) => (i ? [';', ...c] : c));

// The tmux commands for dragEnd()'s `move`: the group first, then the move
// with the renumber and the reselect of the window that was current (tmux's
// current window is an index, so a move can change which window it names).
export function releaseCmds(end, { rows, focus = null }) {
  const cmds = [];
  const group = typeof end.group === 'string' ? groupName(end.group) : null;
  if (group) cmds.push(['set-option', '-w', '-t', end.id, '@band_group', group]);
  else if (group === '') cmds.push(['set-option', '-wu', '-t', end.id, '@band_group']);
  if (end.args) {
    const active = rows.find((r) => r.active)?.id;
    cmds.push(end.args, ['move-window', '-r', '-t', '=band:'], ...(active ? [['select-window', '-t', active]] : []));
  }
  if (end.created && focus) cmds.push(['set-option', '-gu', '@band_focus']);
  return cmds;
}

// The tmux commands that rename `group` to the typed `text`; none when the
// name is empty or the same.
export function renameCmds({ rows, group, text, focus = null }) {
  const name = groupName(text);
  if (!name || name === group) return [];
  const cmds = rows.filter((r) => r.group === group).map((r) => ['set-option', '-w', '-t', r.id, '@band_group', name]);
  if (focus === group) cmds.push(['set-option', '-g', '@band_focus', name]);
  return cmds;
}

// A rename draft after the terminal bytes `data`: { text, end }, `end`
// 'commit' on Enter, 'cancel' on a lone ESC, else null. CSI and SS3
// sequences (mouse, arrows) are dropped.
export function editInput(text, data) {
  const keys = String(data).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1bO./g, '');
  let out = text;
  for (const ch of keys) {
    if (ch === '\x1b') return { text: out, end: 'cancel' };
    if (ch === '\r' || ch === '\n') return { text: out, end: 'commit' };
    if (ch === '\x7f' || ch === '\b') out = Array.from(out).slice(0, -1).join('');
    else if (!/[\u0000-\u001f\u007f-\u009f]/.test(ch) && Array.from(out).length < GROUP_MAX) out += ch;
  }
  return { text: out, end: null };
}

export function dragExpired(drag, now) {
  return Boolean(drag) && now - drag.last > DRAG_STALE_MS;
}

export function dragView(rows, drag, now) {
  const live = drag && drag.engaged && !dragExpired(drag, now);
  return live
    ? { rows, order: drag.order, dragging: drag.id, start: drag.start, drop: drag.drop }
    : { rows, order: null, dragging: null, start: null, drop: null };
}

// ---- the sidebar's width ----

export const WIDTH_DEFAULT = 30;
export const WIDTH_MIN = 20;
export const WIDTH_MAX = 60;
// Columns the session pane keeps when the terminal is narrower than the
// width asks for.
const SESSION_MIN = 20;

// A width from an option or a file; null when it is not one.
export function parseWidth(value) {
  const n = /^\d{1,3}$/.test(String(value ?? '').trim()) ? Number(value) : NaN;
  return n >= WIDTH_MIN && n <= WIDTH_MAX ? n : null;
}

// `now` and `prev` are a tick's reading { own, option, windowWidth, active,
// panes } (prev null when there is none to trust), `saved` the width on disk.
// Returns { set, resize }: a width for the option, one for the pane, or null.
// tmux's border drag changes a pane's width and nothing else in a reading.
export function widthStep(now, prev, saved = null) {
  let option = parseWidth(now.option);
  let set = null;
  if (option === null) {
    option = parseWidth(saved) ?? WIDTH_DEFAULT;
    set = option;
  } else if (now.active && now.panes === 2 && prev && prev.active && prev.panes === 2
    && prev.own !== now.own && prev.windowWidth === now.windowWidth && parseWidth(prev.option) === option) {
    const width = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, now.own));
    if (width !== option) set = width;
    option = width;
  }
  const room = Number.isFinite(now.windowWidth) ? now.windowWidth - SESSION_MIN - 1 : option;
  const target = Math.max(1, Math.min(option, room));
  return { set, resize: now.own === target ? null : target };
}
