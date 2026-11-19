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
      name: f.slice(9).join(' ').replace(CONTROL, ''),
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

// ---- normal view ----

// The index of the first row shown: `start` when given (a drag holds the
// view still), else the one that keeps the active row in view.
function windowStart(rows, capacity, start = null) {
  const last = Math.max(0, rows.length - capacity);
  if (start !== null && start !== undefined) return Math.max(0, Math.min(start, last));
  if (rows.length <= capacity) return 0;
  const activeAt = Math.max(0, rows.findIndex((r) => r.active));
  return Math.max(0, Math.min(activeAt - capacity + 1, last));
}

export function layout({ rows, height, start = null }) {
  const capacity = Math.max(0, Math.floor((height - HEADER_LINES - NEW_LINES) / ROW_LINES));
  const first = windowStart(rows, capacity, start);
  return rows.slice(first, first + capacity).map((row, i) => ({ row, top: HEADER_LINES + 1 + ROW_LINES * i }));
}

export function newLine({ rows, height }) {
  return HEADER_LINES + ROW_LINES * layout({ rows, height }).length + NEW_LINES;
}

export function render({ rows, width, height, confirm = null, now = 0, dragging = null, start = null }) {
  const lines = [];
  lines.push(width > 7 ? bold(fit(' band', width - 2)) + fg(DIM, EXPAND_TEXT) : bold(fit(' band', width)));
  const waiting = rows.filter((r) => r.state === 'input').length;
  const summary = waiting === 0 ? ' nothing waiting' : waiting === 1 ? ' 1 needs input' : ` ${waiting} need input`;
  lines.push(fg(DIM, fit(summary, width)));
  for (const { row } of layout({ rows, height, start })) {
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
  return lines.slice(0, Math.max(0, height)).join('\n');
}

function confirmHit(x, id) {
  if (x >= 10 && x <= 12) return { kind: 'yes', id };
  if (x >= 16 && x <= 17) return { kind: 'no', id };
  return { kind: 'none', id: null };
}

export function hit({ x, y, rows, width, height, confirm = null }) {
  if (y === 1 && x > width - 3) return { kind: 'expand', id: null };
  if (y === newLine({ rows, height }) && x <= textWidth(NEW_TEXT)) return { kind: 'new', id: null };
  const at = layout({ rows, height }).find(({ top }) => top <= y && y < top + ROW_LINES);
  if (!at) return { kind: 'none', id: null };
  const line = y - at.top;
  const id = at.row.id;
  if (confirm !== null && confirm === id && line === 2) return confirmHit(x, id);
  if (line === 1 && x > width - 3) return { kind: 'close', id };
  return { kind: 'select', id };
}

// ---- table view ----

export function tableLayout({ rows, height, start = null }) {
  const capacity = Math.max(0, height - TABLE_HEADER_LINES);
  const first = windowStart(rows, capacity, start);
  return rows.slice(first, first + capacity).map((row, i) => ({ row, y: TABLE_HEADER_LINES + 1 + i }));
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

export function renderTable({ rows, width, height, confirm = null, now = 0, dragging = null, start = null }) {
  const cols = tableColumns(width);
  const sum = cols.reduce((n, c) => n + c.width, 0);
  const waiting = rows.filter((r) => r.state === 'input').length;
  const summary = ` band   ${rows.length} session${rows.length === 1 ? '' : 's'}, ${waiting} need${waiting === 1 ? 's' : ''} input`;
  const lines = [];
  lines.push(width > 17 ? bold(fit(summary, width - 11)) + fg(DIM, COLLAPSE_TEXT) : bold(fit(summary, width)));
  lines.push(fit('', width));
  lines.push(fg(DIM, fit(' ' + cols.map((c) => fit(c.title, c.width)).join(''), width)));
  for (const { row } of tableLayout({ rows, height, start })) {
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

export function hitTable({ x, y, rows, width, height, confirm = null }) {
  if (y === 1) return { kind: x > width - 11 ? 'collapse' : 'none', id: null };
  const at = tableLayout({ rows, height }).find((r) => r.y === y);
  if (!at) return { kind: 'none', id: null };
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

// The lines of the rows shown: [{ id, from, to }].
function spans({ rows, height, start, zoomed }) {
  return zoomed
    ? tableLayout({ rows, height, start }).map(({ row, y }) => ({ id: row.id, from: y, to: y }))
    : layout({ rows, height, start }).map(({ row, top }) => ({ id: row.id, from: top, to: top + ROW_LINES - 1 }));
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

// `rows` in a drag's order: its ids first (gone ones dropped), then the rest.
export function dragRows(rows, drag) {
  if (!drag) return rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return [...drag.order.map((id) => byId.get(id)).filter(Boolean), ...rows.filter((r) => !drag.order.includes(r.id))];
}

// A press on row `id` at line y. { id, order, start, y, at, last, engaged, moved }:
// `start` is the first row shown, held for the whole drag.
export function dragBegin({ id, y, rows, height, zoomed = false, now }) {
  const first = spans({ rows, height, start: null, zoomed })[0];
  return {
    id, y, at: now, last: now, engaged: false, moved: false,
    order: rows.map((r) => r.id),
    start: first ? rows.findIndex((r) => r.id === first.id) : 0,
  };
}

export function dragMove(drag, { y, rows, height, zoomed = false, now }) {
  const next = { ...drag, last: now };
  if (!next.engaged) {
    const dy = Math.abs(y - drag.y);
    if (dy < 1 || (dy < 2 && now - drag.at < DRAG_SLIP_MS)) return next;
    next.engaged = true;
  }
  const list = dragRows(rows, next);
  let shown = spans({ rows: list, height, start: next.start, zoomed });
  if (!shown.length) return next;
  next.start = list.findIndex((r) => r.id === shown[0].id);
  // The first and last rows shown are the scroll zones: the table's last
  // row sits on the pane's last line, so there is nothing below it to reach.
  if (y <= shown[0].to && next.start > 0) next.start -= 1;
  else if (y >= shown.at(-1).from && next.start + shown.length < list.length) next.start += 1;
  shown = spans({ rows: list, height, start: next.start, zoomed });
  const over = (shown.filter((s) => y >= s.from).at(-1) || shown[0]).id;
  if (over !== next.id) {
    next.order = moveId(list.map((r) => r.id), next.id, over);
    next.moved = true;
  }
  return next;
}

// What a release does: { kind: 'select', id } for a row that never moved,
// { kind: 'move', args } with moveArgs for a new order, else { kind: 'none' }.
export function dragEnd(drag, rows) {
  if (!drag || !rows.some((r) => r.id === drag.id)) return { kind: 'none' };
  if (!drag.moved) return { kind: 'select', id: drag.id };
  const order = dragRows(rows, drag).map((r) => r.id);
  const args = moveArgs(order, drag.id);
  if (!args || order.every((id, i) => id === rows[i].id)) return { kind: 'none' };
  return { kind: 'move', args };
}

export function dragExpired(drag, now) {
  return Boolean(drag) && now - drag.last > DRAG_STALE_MS;
}

export function dragView(rows, drag, now) {
  const live = drag && drag.engaged && !dragExpired(drag, now);
  return live ? { rows: dragRows(rows, drag), dragging: drag.id, start: drag.start } : { rows, dragging: null, start: null };
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
