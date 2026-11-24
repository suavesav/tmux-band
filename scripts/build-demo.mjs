#!/usr/bin/env node
// Writes docs/demo.svg: an animated walk through the sidebar, drawn by
// sidebar-core.mjs (the session pane's text, the pointer and the typing are
// scripted on one timeline).
//   node scripts/build-demo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, renderTable } from '../sidebar-core.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const W = 30, PANE = 54, COLS = W + 1 + PANE, ROWS = 23;
const CW = 7.8, LH = 17, PAD = 12, BAR = 28, CAP = 34;
const NOW = 1763300000;
const WIDE = 44;
const COLOR = { 214: '#ffaf00', 71: '#5faf5f', 75: '#5fafff', 244: '#808080', 203: '#ff5f5f', 141: '#af87ff' };
const FG = '#d0d0d0', BG = '#1c1c1c', ACTIVE = '#3a3a3a', DIM = '#808080', HI = '#ffffff';

// One line of SGR text to [{ text, fg, bg, bold }].
function runs(line) {
  const out = [];
  let fg = null, bg = null, bold = false;
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (!m) {
      if (part) out.push({ text: part, fg, bg, bold });
      continue;
    }
    const codes = m[1].split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) { fg = null; bg = null; bold = false; }
      else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 39) fg = null;
      else if (c === 38) { fg = COLOR[codes[i + 2]] || FG; i += 2; }
      else if (c === 48) { bg = ACTIVE; i += 2; }
    }
  }
  return out;
}

const pad = (s, w) => (s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length));
const paneLine = ([text = '', fg = FG] = [], width) => [{ text: pad(` ${text}`, width), fg, bg: null, bold: false }];
const SEP = { text: '│', fg: '#444444', bg: null, bold: false };

const SHELL = '~/code/web-app $ ';
const PROMPT = 'add rate limiting to the upload API';
const WORKING = ['✻ Working… (esc to interrupt)', COLOR[214]];
const PANES = {
  login: [['> fix the login redirect after SSO'], [], ['● Read src/auth/callback.ts'], ['● Update src/auth/callback.ts'], ['  ⎿ +12 -4', DIM], [], WORKING],
  loginDone: [['> fix the login redirect after SSO'], [], ['● Update src/auth/callback.ts'], ['  ⎿ +12 -4', DIM], ['● Bash(gh pr create)'], ['  ⎿ github.com/acme/web-app/pull/412', DIM], [], ['● Opened #412.'], [], ['> ', HI]],
  ask: [['> add a test for migration 0042'], [], ['● Bash(npm test -- migrations)'], [], [' Do you want to proceed?', HI], [' ❯ 1. Yes', COLOR[75]], ['   2. No']],
  run: [['> add a test for migration 0042'], [], ['● Bash(npm test -- migrations)'], ['  ⎿ 14 passed', DIM], [], WORKING],
  shell: [[`${SHELL}claude`, HI]],
  claude: [[`${SHELL}claude`, HI], [], ['✻ Welcome to Claude Code', COLOR[214]], [], [`> ${PROMPT}`]],
  thinking: [[`> ${PROMPT}`], [], ['✻ Thinking…', COLOR[214]]],
  reading: [[`> ${PROMPT}`], [], ['● Read src/api/upload.ts'], [], WORKING],
  searching: [[`> ${PROMPT}`], [], ['● Read src/api/upload.ts'], ['● Search(pattern: "rateLimit")'], [], WORKING],
};

const base = (over = {}) => ({ tag: '', wait: '', model: '', pr: '', ...over });
const s1 = (o) => base({ id: '@1', name: 'fix login redirect after SSO callback', repo: 'web-app · fix-login', model: 'sonnet · auto', ...o });
const s2 = (o) => base({ id: '@2', name: 'write a test for migration 0042', repo: 'api · main', tag: 'work', model: 'opus · default', ...o });
const s3 = (o) => base({ id: '@3', name: 'summarize PR feedback', repo: 'docs · review-fixes', state: 'done', since: NOW - 3600, pr: '318:m:p', ...o });
const s4 = (o) => base({ id: '@4', name: 'terminal', repo: 'web-app · fix-login', state: '', ...o });

// ---- the timeline ----
// states: { at, rows, pane | table, w, dragging, typing: { line, skip, text, from, to } }
// points: the pointer's [t, col, line, linear]; rings: [from, to] it is held down.
const states = [], points = [], rings = [], captions = [];
let t = 0;
let at = [62, 12];
const show = (state) => states.push({ at: t, ...state });
const wait = (seconds) => { t += seconds; };
const caption = (text) => captions.push({ at: t, text });
function move(col, line, seconds = 0.8, linear = false) {
  points.push([t, ...at, linear]);
  t += seconds;
  at = [col, line];
  points.push([t, ...at, false]);
}
const click = () => { rings.push([t, t]); t += 0.12; };
// The state last shown reveals `text` one character at a time.
function type(line, skip, text, perChar) {
  states[states.length - 1].typing = { line, skip, text, from: t, to: t + text.length * perChar };
  t += text.length * perChar;
}

const one = (o) => s1({ state: 'working', since: NOW - 120, ...o });
const two = (o) => s2({ state: 'input', since: NOW - 240, wait: 'permission: Bash', ...o });

caption('Every session in one window. Orange needs you, blue is working, green is done.');
show({ rows: [one({ active: true }), two(), s3()], pane: PANES.login });
wait(2.6);

caption('Click a session to jump to it.');
move(12, 8);
click();
show({ rows: [one(), two({ active: true }), s3()], pane: PANES.ask });
wait(0.9);

caption('Answer it, and the row goes back to blue.');
move(38, 6, 0.7);
wait(0.5);
const ran = t;
const twoRun = (o) => s2({ state: 'working', since: NOW + ran, ...o });
show({ rows: [one(), twoRun({ active: true }), s3()], pane: PANES.run });
wait(1.6);

caption('A session opens a pull request: its CI shows up on the row.');
const done = t;
const oneDone = (o) => s1({ state: 'done', since: NOW + done, pr: '412:o:p', ...o });
show({ rows: [oneDone({ pr: '412:o:r' }), twoRun({ active: true }), s3()], pane: PANES.run });
wait(1.6);
show({ rows: [oneDone(), twoRun({ active: true }), s3()], pane: PANES.run });
wait(1.3);

caption('Looked at a finished session? It turns grey.');
move(12, 4);
click();
const oneSeen = (o) => oneDone({ state: 'seen', ...o });
const twoPlan = (o) => s2({ state: 'input', since: NOW + t, wait: 'plan approval', ...o });
show({ rows: [oneSeen({ active: true }), twoRun(), s3()], pane: PANES.loginDone });
wait(1.5);

caption('⤢ expands the list into a table with every detail.');
move(29, 1, 0.7);
click();
const planned = twoPlan();
show({ rows: [oneSeen({ active: true }), planned, s3()], table: true });
wait(2.2);
move(80, 1, 0.9);
click();
show({ rows: [oneSeen({ active: true }), planned, s3()], pane: PANES.loginDone });
wait(0.4);

caption('Drag a session to reorder the list.');
move(12, 12, 0.8);
wait(0.2);
{
  const from = t;
  const held = (rows) => show({ rows, pane: PANES.loginDone, dragging: '@3' });
  held([oneSeen({ active: true }), planned, s3()]);
  wait(0.25);
  const start = t, seconds = 1.3;
  move(12, 4, seconds, true);
  const end = t;
  t = start + seconds * 0.25;
  held([oneSeen({ active: true }), s3(), planned]);
  t = start + seconds * 0.75;
  held([s3(), oneSeen({ active: true }), planned]);
  t = end + 0.3;
  rings.push([from, t]);
}
const after = (o = {}) => [s3(), oneSeen({ active: !o.plain }), planned];
show({ rows: after(), pane: PANES.loginDone });
wait(0.8);

caption("Drag the sidebar's edge to make room for long titles.");
move(W + 1, 10, 0.8);
wait(0.2);
{
  const from = t;
  wait(0.2);
  const start = t, seconds = 1.5, steps = (WIDE - W) / 2;
  move(WIDE + 1, 10, seconds, true);
  const end = t;
  for (let i = 1; i <= steps; i++) {
    t = start + (seconds * (i - 0.5)) / steps;
    show({ rows: after(), pane: PANES.loginDone, w: W + i * 2 });
  }
  t = end + 0.3;
  rings.push([from, t]);
}
wait(1.2);

caption('+ new session opens a shell in the same folder.');
move(5, 16, 0.9);
click();
const opened = t;
const four = (o) => s4({ active: true, since: NOW + opened, ...o });
show({ rows: [...after({ plain: true }), four()], pane: PANES.shell, w: WIDE });
wait(0.5);
move(74, 10, 0.7);
type(0, SHELL.length, 'claude', 0.11);
wait(0.5);

caption('Start Claude there, and the row takes its name from the session.');
show({ rows: [...after({ plain: true }), four()], pane: PANES.claude, w: WIDE });
wait(0.7);
type(4, 2, PROMPT, 0.06);
wait(0.4);
const asked = t;
const busy = (o) => four({ state: 'working', since: NOW + asked, model: 'sonnet · default', ...o });
show({ rows: [...after({ plain: true }), busy()], pane: PANES.thinking, w: WIDE });
wait(1.3);
show({ rows: [...after({ plain: true }), busy({ name: PROMPT })], pane: PANES.reading, w: WIDE });
wait(1.7);
show({ rows: [...after({ plain: true }), busy({ name: 'Add upload rate limiting' })], pane: PANES.searching, w: WIDE });
wait(2.8);
points.push([t, ...at, false]);
const total = t;

function screen(state) {
  const now = NOW + Math.floor(state.at);
  if (state.table) {
    return renderTable({ rows: state.rows, width: COLS, height: ROWS, now }).split('\n').map(runs);
  }
  const w = state.w || W;
  const side = render({ rows: state.rows, width: w, height: ROWS, now, dragging: state.dragging || null }).split('\n').map(runs);
  const lines = [];
  for (let i = 0; i < ROWS; i++) {
    lines.push([...(side[i] || [{ text: ' '.repeat(w) }]), SEP, ...paneLine(state.pane[i], COLS - 1 - w)]);
  }
  return lines;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v) => Number(v.toFixed(2));

// Each character sits on its own column, so a glyph from a fallback font
// cannot shift the rest of the line.
function drawLine(line, y) {
  let out = '';
  let col = 0;
  for (const run of line) {
    const chars = [...run.text];
    if (run.bg) out += `<rect x="${n(PAD + col * CW)}" y="${n(y - LH + 4.5)}" width="${n(chars.length * CW + 0.3)}" height="${LH}" fill="${run.bg}"/>`;
    let start = 0;
    const flush = (end) => {
      const text = chars.slice(start, end).join('');
      if (text.trim()) {
        const lead = text.length - text.trimStart().length;
        const body = text.trim();
        const xs = [...body].map((_, i) => n(PAD + (col + start + lead + i) * CW)).join(' ');
        out += `<text x="${xs}" y="${n(y)}" fill="${run.fg || FG}"${run.bold ? ' font-weight="700"' : ''}>${esc(body)}</text>`;
      }
      start = end;
    };
    flush(chars.length);
    col += chars.length;
  }
  return out;
}

const width = n(PAD * 2 + COLS * CW);
const termH = ROWS * LH + PAD * 2;
const height = BAR + termH + CAP;
const pct = (seconds) => Number(((Math.min(Math.max(seconds, 0), total) / total) * 100).toFixed(3));
const px = (col) => n(PAD + (col - 0.5) * CW);
const py = (line) => n(BAR + PAD + (line - 0.5) * LH);
// [[seconds, declarations]] to one @keyframes body; the first and last hold to the ends.
function keyframes(stops) {
  const out = [...stops];
  if (pct(out[0][0]) > 0) out.unshift([0, out[0][1]]);
  if (pct(out[out.length - 1][0]) < 100) out.push([total, out[out.length - 1][1]]);
  return out.map(([seconds, css]) => `${pct(seconds)}%{${css}}`).join('');
}

let css = `.t text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"DejaVu Sans Mono",monospace;font-size:13px;white-space:pre}
.a{animation-duration:${n(total)}s;animation-iteration-count:infinite;animation-timing-function:linear}
.s{opacity:0;animation-timing-function:step-end}
.cap{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;fill:#8b949e;opacity:0}
.r{transform-box:fill-box;transform-origin:center}
`;
let body = '';
states.forEach((state, i) => {
  const until = i + 1 < states.length ? states[i + 1].at : total;
  css += `@keyframes s${i}{${keyframes([[0, `opacity:${state.at > 0 ? 0 : 1}`], [state.at, 'opacity:1'], [until, 'opacity:0']])}}\n.s${i}{animation-name:s${i}}\n`;
  let g = `<g class="a s s${i}">`;
  screen(state).forEach((line, row) => { g += drawLine(line, BAR + PAD + (row + 1) * LH - 4.5); });
  if (state.typing) {
    // A background-coloured cover slides off the typed text one cell per step.
    const { line, skip, text, from, to } = state.typing;
    const x = n(PAD + ((state.w || W) + 2 + skip) * CW);
    const y = n(BAR + PAD + line * LH + 0.5);
    const shift = n(text.length * CW);
    css += `@keyframes k${i}{${keyframes([[from, `transform:translateX(0);animation-timing-function:steps(${text.length},end)`], [to, `transform:translateX(${shift}px)`]])}}\n.k${i}{animation-name:k${i}}\n`;
    g += `<g class="a k${i}"><rect x="${x}" y="${y}" width="${n(shift + 1)}" height="${LH}" fill="${BG}"/><rect x="${x}" y="${n(y + 1.5)}" width="${n(CW - 1)}" height="${LH - 3}" fill="${FG}" opacity="0.75"/></g>`;
  }
  body += `${g}</g>\n`;
});

let caps = '';
captions.forEach((cap, i) => {
  const until = i + 1 < captions.length ? captions[i + 1].at : total;
  const fade = 0.25;
  css += `@keyframes c${i}{${keyframes([[cap.at, 'opacity:0'], [cap.at + fade, 'opacity:1'], [until - fade, 'opacity:1'], [until, 'opacity:0']])}}\n.c${i}{animation-name:c${i}}\n`;
  caps += `<text class="a cap c${i}" x="${width / 2}" y="${BAR + termH + 23}" text-anchor="middle">${esc(cap.text)}</text>\n`;
});

css += `@keyframes ptr{${keyframes(points.map(([seconds, col, line, linear]) => [seconds, `transform:translate(${px(col)}px,${py(line)}px);animation-timing-function:${linear ? 'linear' : 'cubic-bezier(.45,0,.3,1)'}`]))}}\n.ptr{animation-name:ptr}\n`;
// A click is a ring that grows and fades; a drag holds it small until the release.
const ringStops = [[0, 'opacity:0;transform:scale(.4)']];
for (const [from, to] of rings) {
  ringStops.push([from - 0.02, 'opacity:0;transform:scale(.4)'], [from, 'opacity:.9;transform:scale(.4)']);
  if (to > from) ringStops.push([from + 0.15, 'opacity:.9;transform:scale(.7)'], [to, 'opacity:.9;transform:scale(.7)']);
  ringStops.push([to + 0.45, 'opacity:0;transform:scale(1.5)']);
}
css += `@keyframes ring{${keyframes(ringStops)}}\n.ring{animation-name:ring}\n`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="tmux-band: a sidebar listing Claude Code sessions with their state, beside the selected session">
<style>${css}</style>
<clipPath id="term"><rect width="${width}" height="${BAR + termH}" rx="9"/></clipPath>
<rect width="${width}" height="${BAR + termH}" rx="9" fill="${BG}"/>
<path d="M0 ${BAR}V9a9 9 0 0 1 9-9h${width - 18}a9 9 0 0 1 9 9v${BAR - 9}z" fill="#2b2b2b"/>
<circle cx="16" cy="14" r="5.5" fill="#ff5f57"/><circle cx="34" cy="14" r="5.5" fill="#febc2e"/><circle cx="52" cy="14" r="5.5" fill="#28c840"/>
<text x="${width / 2}" y="18" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" fill="#9a9a9a">band</text>
<g class="t" clip-path="url(#term)">
${body}</g>
${caps}<g class="a ptr"><circle class="a r ring" r="11" fill="none" stroke="#ffffff" stroke-width="2"/><path d="M0 0v15.5l4.2-3.6 2.7 6.1 2.3-1-2.7-6h5.6z" fill="#ffffff" stroke="#000000" stroke-width="1" stroke-linejoin="round"/></g>
</svg>
`;
fs.writeFileSync(path.join(root, 'docs/demo.svg'), svg);
console.log(`docs/demo.svg: ${states.length} states, ${total.toFixed(1)}s loop, ${svg.length} bytes`);
