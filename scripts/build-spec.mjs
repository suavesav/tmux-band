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
  { id: '@1', active: false, state: 'input', tag: 'work', since: NOW - 31 * 60, wait: 'plan approval', model: 'opus · plan', repo: 'etl · main', pr: '', group: '', name: 'plan the importer' },
  { id: '@2', active: true, state: 'input', tag: '', since: NOW - 4 * 60, wait: 'permission: Bash', model: 'sonnet · default', repo: 'web-app · fix-login', pr: '412:o:f', group: '', name: 'fix login redirect' },
  { id: '@3', active: false, state: 'working', tag: '', since: NOW - 12 * 60, wait: '', model: '', repo: 'api · main', pr: '88:o:r,90:o:p', group: '', name: 'write migration test for 0042 rollback' },
  { id: '@4', active: false, state: 'done', tag: 'work', since: NOW - 3600, wait: '', model: '', repo: 'docs · review-fixes', pr: '318:m:p', group: '', name: 'summarize PR feedback' },
  { id: '@5', active: false, state: 'seen', tag: '', since: NOW - 2 * 86400, wait: '', model: '', repo: 'web · main', pr: '', group: '', name: '修复 bug 🐛 emoji' },
  { id: '@6', active: false, state: '', tag: '', since: 0, wait: '', model: '', repo: 'scratch', pr: '7:c:', group: '', name: 'no state yet' },
  { id: '@7', active: true, state: 'done', tag: '', since: NOW - 45, wait: '', model: '', repo: 'api · fix-ci', pr: '501:o:,502:o:p', group: '', name: 'retry flaky test' },
  { id: '@8', active: false, state: 'input', tag: '', since: NOW - 9 * 60, wait: 'question', model: 'opus · default', repo: 'web-app · cache', pr: '', group: 'web', name: 'cache the token lookup' },
  { id: '@9', active: false, state: 'working', tag: '', since: NOW - 2 * 60, wait: '', model: '', repo: 'web-app · auth-mw', pr: '77:o:p', group: 'web', name: 'move auth to middleware' },
  { id: '@10', active: false, state: 'done', tag: '', since: NOW - 20 * 60, wait: '', model: '', repo: 'docs · release-2.4', pr: '', group: 'release prep', name: 'draft the 2.4 notes' },
];
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const cases = [
  { name: "normal 30x24", view: "normal", width: 30, height: 24, confirm: null, rows: [0, 1, 2, 3, 4, 5] },
  { name: "normal 30x24, close confirm on @3", view: "normal", width: 30, height: 24, confirm: "@3", rows: [0, 1, 2, 3, 4, 5] },
  { name: "normal 30x15 (2 rows fit; scrolled so the active one shows)", view: "normal", width: 30, height: 15, confirm: null, rows: [0, 1, 2, 3, 4, 5] },
  { name: "normal 6x13 (narrow fallbacks), first row only", view: "normal", width: 6, height: 13, confirm: null, rows: [0] },
  { name: "table 150x12", view: "table", width: 150, height: 12, confirm: null, rows: [0, 1, 2, 3, 4, 5] },
  { name: "table 100x12, close confirm on @4", view: "table", width: 100, height: 12, confirm: "@4", rows: [0, 1, 2, 3, 4, 5] },
  { name: "normal 30x15, active row last (list scrolls)", view: "normal", width: 30, height: 15, confirm: null, rows: [0, 2, 3, 4, 6] },
  { name: "normal 30x19, nothing waiting", view: "normal", width: 30, height: 19, confirm: null, rows: [2, 3, 6] },
  { name: "normal 20x11 (badge shown: 20 − 6 − 2 = 12)", view: "normal", width: 20, height: 11, confirm: null, rows: [1] },
  { name: "normal 19x11 (badge dropped: 19 − 6 − 2 = 11)", view: "normal", width: 19, height: 11, confirm: null, rows: [1] },
  { name: "normal 30x9, no sessions (the new-session line and the new group box)", view: "normal", width: 30, height: 9, confirm: null, rows: [] },
  { name: "normal 30x16 (one row fewer: 5 lines kept for the new-session line and the box)", view: "normal", width: 30, height: 16, confirm: null, rows: [0, 2, 3] },
  { name: "normal 30x24, row @3 held (being dragged)", view: "normal", width: 30, height: 24, confirm: null, dragging: "@3", rows: [0, 1, 2, 3, 4, 5] },
  { name: "normal 30x15, the active row held", view: "normal", width: 30, height: 15, confirm: null, dragging: "@2", rows: [0, 1] },
  { name: "table 100x12, row @4 held", view: "table", width: 100, height: 12, confirm: null, dragging: "@4", rows: [0, 1, 2, 3, 4, 5] },
  { name: "normal 8x2 (header with ⤢)", view: "normal", width: 8, height: 2, confirm: null, rows: [6] },
  { name: "normal 7x2 (header without ⤢)", view: "normal", width: 7, height: 2, confirm: null, rows: [6] },
  { name: "table 120x6, one session", view: "table", width: 120, height: 6, confirm: null, rows: [6] },
  { name: "table 120x6, active row confirming", view: "table", width: 120, height: 6, confirm: "@7", rows: [3, 6] },
  { name: "table 18x1 (title with ⤡ collapse)", view: "table", width: 18, height: 1, confirm: null, rows: [6] },
  { name: "table 17x1 (title without ⤡ collapse)", view: "table", width: 17, height: 1, confirm: null, rows: [6] },
  { name: "table 60x8", view: "table", width: 60, height: 8, confirm: null, rows: [0, 1, 2, 3, 4, 5] },
  { name: "normal 30x31, groups: ungrouped rows first, then each group under its head", view: "normal", width: 30, height: 31, confirm: null, rows: [0, 7, 2, 8, 9] },
  { name: "normal 30x31, focus on web (◉; the count adds the rows elsewhere)", view: "normal", width: 30, height: 31, confirm: null, focus: "web", rows: [0, 7, 2, 8, 9] },
  { name: "normal 30x31, web being renamed", view: "normal", width: 30, height: 31, confirm: null, edit: { group: "web", text: "frontend" }, rows: [0, 7, 2, 8, 9] },
  { name: "normal 30x31, @1 held over the new group box", view: "normal", width: 30, height: 31, confirm: null, dragging: "@1", drop: "new", rows: [0, 7, 2, 8, 9] },
  { name: "normal 13x7 (the narrowest new group box)", view: "normal", width: 13, height: 7, confirm: null, rows: [] },
  { name: "normal 12x7 (no room for the box's label: blank lines)", view: "normal", width: 12, height: 7, confirm: null, rows: [] },
  { name: "table 120x12, groups", view: "table", width: 120, height: 12, confirm: null, rows: [0, 7, 2, 8, 9] },
  { name: "table 120x12, focus on web, @8 held over the new group box", view: "table", width: 120, height: 12, confirm: null, focus: "web", dragging: "@8", drop: "new", rows: [0, 7, 2, 8, 9] },
];
const vectors = { now: NOW, rows, cases: cases.map((c) => {
  const fn = c.view === 'table' ? renderTable : render;
  const extra = { dragging: c.dragging ?? null, drop: c.drop ?? null, focus: c.focus ?? null, edit: c.edit ?? null };
  const raw = fn({ rows: c.rows.map((i) => rows[i]), width: c.width, height: c.height, confirm: c.confirm, now: NOW, ...extra });
  return { ...c, text: strip(raw).split('\n'), raw: raw.split('\n') };
}) };
fs.writeFileSync(path.join(root, 'test/vectors.json'), JSON.stringify(vectors, null, 1));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = vectors.cases.map((c) => {
  const fn = c.view === 'table' ? 'renderTable' : 'render';
  const more = ['dragging', 'drop', 'focus', 'edit'].filter((k) => c[k]).map((k) => `, ${k}: ${JSON.stringify(c[k]).replace(/"(\w+)":/g, '$1: ')}`).join('');
  const call = `${fn}({ rows: rows[${c.rows.join(', ')}], width: ${c.width}, height: ${c.height}, confirm: ${c.confirm === null ? 'null' : JSON.stringify(c.confirm)}, now${more} })`;
  return `<h3>${esc(c.name)}</h3>\n<p class="note"><code>${esc(call)}</code></p>\n<div class="scroll"><pre>${c.text.map((l) => esc(`|${l}|`)).join('\n')}</pre></div>`;
}).join('\n');
const out = fs.readFileSync(path.join(root, 'spec/spec.src.html'), 'utf8')
  .replace('<!--VECTORS_HTML-->', () => html)
  .replace('<!--VECTORS_JSON-->', () => JSON.stringify(vectors).replace(/</g, '\\u003c'));
fs.writeFileSync(path.join(root, 'docs/spec.html'), out);
console.log(`${vectors.cases.length} cases, docs/spec.html ${out.length} chars`);
