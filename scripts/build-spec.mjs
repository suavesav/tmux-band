#!/usr/bin/env node
// Regenerates test/vectors.json from sidebar-core.mjs and fills
// spec/spec.src.html into docs/spec.html.  Run: node scripts/build-spec.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, renderTable } from '../sidebar-core.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NOW = 1763300000;
const rows = [
  { id: '@1', active: false, state: 'input', tag: 'work', since: NOW - 31 * 60, wait: 'plan approval', model: 'opus · plan', repo: 'etl · main', pr: '', name: 'plan the importer' },
  { id: '@2', active: true, state: 'input', tag: '', since: NOW - 4 * 60, wait: 'permission: Bash', model: 'sonnet · default', repo: 'web-app · fix-login', pr: '412:o:f', name: 'fix login redirect' },
  { id: '@3', active: false, state: 'working', tag: '', since: NOW - 12 * 60, wait: '', model: '', repo: 'api · main', pr: '88:o:r,90:o:p', name: 'write migration test for 0042 rollback' },
  { id: '@4', active: false, state: 'done', tag: 'work', since: NOW - 3600, wait: '', model: '', repo: 'docs · review-fixes', pr: '318:m:p', name: 'summarize PR feedback' },
  { id: '@5', active: false, state: 'seen', tag: '', since: NOW - 2 * 86400, wait: '', model: '', repo: 'web · main', pr: '', name: '修复 bug 🐛 emoji' },
  { id: '@6', active: false, state: '', tag: '', since: 0, wait: '', model: '', repo: 'scratch', pr: '7:c:', name: 'no state yet' },
  { id: '@7', active: true, state: 'done', tag: '', since: NOW - 45, wait: '', model: '', repo: 'api · fix-ci', pr: '501:o:,502:o:p', name: 'retry flaky test' },
];
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const cases = [
  { name: "normal 30x24", view: "normal", width: 30, height: 24, confirm: null, rows: [0, 1, 2, 3, 4, 5] },
  { name: "normal 30x24, close confirm on @3", view: "normal", width: 30, height: 24, confirm: "@3", rows: [0, 1, 2, 3, 4, 5] },
  { name: "normal 30x12 (2 rows fit; scrolled so the active one shows)", view: "normal", width: 30, height: 12, confirm: null, rows: [0, 1, 2, 3, 4, 5] },
  { name: "normal 6x10 (narrow fallbacks), first row only", view: "normal", width: 6, height: 10, confirm: null, rows: [0] },
  { name: "table 150x12", view: "table", width: 150, height: 12, confirm: null, rows: [0, 1, 2, 3, 4, 5] },
  { name: "table 100x12, close confirm on @4", view: "table", width: 100, height: 12, confirm: "@4", rows: [0, 1, 2, 3, 4, 5] },
  { name: "normal 30x12, active row last (list scrolls)", view: "normal", width: 30, height: 12, confirm: null, rows: [0, 2, 3, 4, 6] },
  { name: "normal 30x16, nothing waiting", view: "normal", width: 30, height: 16, confirm: null, rows: [2, 3, 6] },
  { name: "normal 20x8 (badge shown: 20 − 6 − 2 = 12)", view: "normal", width: 20, height: 8, confirm: null, rows: [1] },
  { name: "normal 19x8 (badge dropped: 19 − 6 − 2 = 11)", view: "normal", width: 19, height: 8, confirm: null, rows: [1] },
  { name: "normal 30x6, no sessions (new-session line only)", view: "normal", width: 30, height: 6, confirm: null, rows: [] },
  { name: "normal 30x13 (one row fewer: 2 lines kept for new session)", view: "normal", width: 30, height: 13, confirm: null, rows: [0, 2, 3] },
  { name: "normal 30x24, row @3 held (being dragged)", view: "normal", width: 30, height: 24, confirm: null, dragging: "@3", rows: [0, 1, 2, 3, 4, 5] },
  { name: "normal 30x12, the active row held", view: "normal", width: 30, height: 12, confirm: null, dragging: "@2", rows: [0, 1] },
  { name: "table 100x12, row @4 held", view: "table", width: 100, height: 12, confirm: null, dragging: "@4", rows: [0, 1, 2, 3, 4, 5] },
  { name: "normal 8x2 (header with ⤢)", view: "normal", width: 8, height: 2, confirm: null, rows: [6] },
  { name: "normal 7x2 (header without ⤢)", view: "normal", width: 7, height: 2, confirm: null, rows: [6] },
  { name: "table 120x6, one session", view: "table", width: 120, height: 6, confirm: null, rows: [6] },
  { name: "table 120x6, active row confirming", view: "table", width: 120, height: 6, confirm: "@7", rows: [3, 6] },
  { name: "table 18x1 (title with ⤡ collapse)", view: "table", width: 18, height: 1, confirm: null, rows: [6] },
  { name: "table 17x1 (title without ⤡ collapse)", view: "table", width: 17, height: 1, confirm: null, rows: [6] },
  { name: "table 60x8", view: "table", width: 60, height: 8, confirm: null, rows: [0, 1, 2, 3, 4, 5] },
];
const vectors = { now: NOW, rows, cases: cases.map((c) => {
  const fn = c.view === 'table' ? renderTable : render;
  const raw = fn({ rows: c.rows.map((i) => rows[i]), width: c.width, height: c.height, confirm: c.confirm, now: NOW, dragging: c.dragging ?? null });
  return { ...c, text: strip(raw).split('\n'), raw: raw.split('\n') };
}) };
fs.writeFileSync(path.join(root, 'test/vectors.json'), JSON.stringify(vectors, null, 1));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = vectors.cases.map((c) => {
  const fn = c.view === 'table' ? 'renderTable' : 'render';
  const call = `${fn}({ rows: rows[${c.rows.join(', ')}], width: ${c.width}, height: ${c.height}, confirm: ${c.confirm === null ? 'null' : JSON.stringify(c.confirm)}, now${c.dragging ? `, dragging: ${JSON.stringify(c.dragging)}` : ''} })`;
  return `<h3>${esc(c.name)}</h3>\n<p class="note"><code>${esc(call)}</code></p>\n<div class="scroll"><pre>${c.text.map((l) => esc(`|${l}|`)).join('\n')}</pre></div>`;
}).join('\n');
const out = fs.readFileSync(path.join(root, 'spec/spec.src.html'), 'utf8')
  .replace('<!--VECTORS_HTML-->', () => html)
  .replace('<!--VECTORS_JSON-->', () => JSON.stringify(vectors).replace(/</g, '\\u003c'));
fs.writeFileSync(path.join(root, 'docs/spec.html'), out);
console.log(`${vectors.cases.length} cases, docs/spec.html ${out.length} chars`);
