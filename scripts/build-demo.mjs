#!/usr/bin/env node
// Writes docs/demo.svg: an animated walk through the sidebar, drawn by
// sidebar-core.mjs (the session pane's text is scripted).
//   node scripts/build-demo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, renderTable } from '../sidebar-core.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const W = 30, PANE = 54, COLS = W + 1 + PANE, ROWS = 20;
const CW = 7.8, LH = 17, PAD = 12, BAR = 28, CAP = 34;
const NOW = 1763300000;
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
const paneLine = ([text = '', fg = FG] = []) => [{ text: pad(` ${text}`, PANE), fg, bg: null, bold: false }];
const SEP = { text: '│', fg: '#444444', bg: null, bold: false };

const PANES = {
  login: [['> fix the login redirect after SSO'], [], ['● Read src/auth/callback.ts'], ['● Update src/auth/callback.ts'], ['  ⎿ +12 -4', DIM], [], ['✻ Working… (esc to interrupt)', COLOR[214]]],
  loginDone: [['> fix the login redirect after SSO'], [], ['● Update src/auth/callback.ts'], ['  ⎿ +12 -4', DIM], ['● Bash(gh pr create)'], ['  ⎿ github.com/acme/web-app/pull/412', DIM], [], ['● Opened #412. The redirect keeps the return path.'], [], ['> ', HI]],
  ask: [['> add a test for migration 0042'], [], ['● Bash(npm test -- migrations)'], [], [' Do you want to proceed?', HI], [' ❯ 1. Yes', COLOR[75]], ['   2. No']],
  run: [['> add a test for migration 0042'], [], ['● Bash(npm test -- migrations)'], ['  ⎿ 14 passed', DIM], [], ['✻ Working… (esc to interrupt)', COLOR[214]]],
  shell: [['~/code/web-app $ ', HI]],
};

const base = (over = {}) => ({ tag: '', wait: '', model: '', pr: '', ...over });
const s1 = (o) => base({ id: '@1', name: 'fix login redirect', repo: 'web-app · fix-login', model: 'sonnet · auto', ...o });
const s2 = (o) => base({ id: '@2', name: 'write migration test', repo: 'api · main', tag: 'work', model: 'opus · default', ...o });
const s3 = (o) => base({ id: '@3', name: 'summarize PR feedback', repo: 'docs · review-fixes', state: 'done', since: NOW - 3600, pr: '318:m:p', ...o });
const s4 = (o) => base({ id: '@4', name: 'terminal', repo: 'web-app · fix-login', state: '', since: NOW - 5, ...o });

// { seconds, caption, rows, pane | table, click: [col, line] }
const FRAMES = [
  { seconds: 3.2, caption: 'Every session in one window. Orange needs you, blue is working, green is done.',
    rows: [s1({ active: true, state: 'working', since: NOW - 120 }), s2({ state: 'input', since: NOW - 240, wait: 'permission: Bash' }), s3()], pane: PANES.login },
  { seconds: 2.6, caption: 'Click a session to jump to it.', click: [12, 8],
    rows: [s1({ state: 'working', since: NOW - 130 }), s2({ active: true, state: 'input', since: NOW - 250, wait: 'permission: Bash' }), s3()], pane: PANES.ask },
  { seconds: 2.6, caption: 'Answer it, and the row goes back to blue.',
    rows: [s1({ state: 'working', since: NOW - 140 }), s2({ active: true, state: 'working', since: NOW - 2 }), s3()], pane: PANES.run },
  { seconds: 3, caption: 'A session opens a pull request: its CI shows up on the row.',
    rows: [s1({ state: 'done', since: NOW - 3, pr: '412:o:r' }), s2({ active: true, state: 'working', since: NOW - 40 }), s3()], pane: PANES.run },
  { seconds: 3.6, caption: '⤢ expands the list into a table. Drag rows to reorder, here or in the sidebar.', table: true,
    rows: [s1({ state: 'done', since: NOW - 30, pr: '412:o:p' }), s2({ active: true, state: 'input', since: NOW - 4, wait: 'plan approval' }), s3()] },
  { seconds: 2.8, caption: 'Looked at a finished session? It turns grey.', click: [12, 4],
    rows: [s1({ active: true, state: 'seen', since: NOW - 40, pr: '412:o:p' }), s2({ state: 'input', since: NOW - 14, wait: 'plan approval' }), s3()], pane: PANES.loginDone },
  { seconds: 3.6, caption: '+ new session opens a shell in the same folder. Start any CLI there.', click: [2, 20],
    rows: [s1({ state: 'seen', since: NOW - 50, pr: '412:o:p' }), s2({ state: 'input', since: NOW - 24, wait: 'plan approval' }), s3(), s4({ active: true })], pane: PANES.shell },
];

function screen(frame) {
  if (frame.table) {
    return renderTable({ rows: frame.rows, width: COLS, height: ROWS, now: NOW }).split('\n').map(runs);
  }
  const side = render({ rows: frame.rows, width: W, height: ROWS, now: NOW }).split('\n').map(runs);
  const lines = [];
  for (let i = 0; i < ROWS; i++) {
    lines.push([...(side[i] || [{ text: ' '.repeat(W) }]), SEP, ...paneLine(frame.pane[i])]);
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
const total = FRAMES.reduce((sum, f) => sum + f.seconds, 0);

let css = `.t text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"DejaVu Sans Mono",monospace;font-size:13px;white-space:pre}
.f{opacity:0;animation-duration:${total}s;animation-iteration-count:infinite;animation-timing-function:step-end}
.t text.cap{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;fill:#8b949e}
`;
let body = '';
let at = 0;
FRAMES.forEach((frame, i) => {
  const from = n((at / total) * 100);
  at += frame.seconds;
  const to = n((at / total) * 100);
  css += `@keyframes f${i}{0%{opacity:0}${from}%{opacity:1}${to}%{opacity:0}100%{opacity:0}}\n.f${i}{animation-name:f${i}}\n`;
  let g = `<g class="f f${i}">`;
  screen(frame).forEach((line, row) => { g += drawLine(line, BAR + PAD + (row + 1) * LH - 4.5); });
  if (frame.click) {
    const [cx, cy] = frame.click;
    g += `<circle cx="${n(PAD + (cx - 0.5) * CW)}" cy="${n(BAR + PAD + (cy - 0.5) * LH)}" r="9" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.85"/>`;
  }
  g += `<text class="cap" x="${width / 2}" y="${BAR + termH + 23}" text-anchor="middle">${esc(frame.caption)}</text></g>\n`;
  body += g;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="tmux-band: a sidebar listing Claude Code sessions with their state, beside the selected session">
<style>${css}</style>
<rect width="${width}" height="${BAR + termH}" rx="9" fill="${BG}"/>
<path d="M0 ${BAR}V9a9 9 0 0 1 9-9h${width - 18}a9 9 0 0 1 9 9v${BAR - 9}z" fill="#2b2b2b"/>
<circle cx="16" cy="14" r="5.5" fill="#ff5f57"/><circle cx="34" cy="14" r="5.5" fill="#febc2e"/><circle cx="52" cy="14" r="5.5" fill="#28c840"/>
<text x="${width / 2}" y="18" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" fill="#9a9a9a">band</text>
<g class="t">
${body}</g>
</svg>
`;
fs.writeFileSync(path.join(root, 'docs/demo.svg'), svg);
console.log(`docs/demo.svg: ${FRAMES.length} frames, ${total.toFixed(1)}s loop, ${svg.length} bytes`);
