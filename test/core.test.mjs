import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseWindows, render, renderTable, layout, newLine, tableLayout, moveId, moveArgs, dragBegin, dragMove, dragEnd, dragView, dragExpired, DRAG_STALE_MS, widthStep, parseWidth, WIDTH_DEFAULT, WIDTH_MIN, WIDTH_MAX, hit, hitTable,
  needsConfirm, age, repoLabel, fit, textWidth, optionValue, nameOf, entryName, parsePrs, prValue, prBadge, prCell,
  listItems, groupName, newGroupName, GROUP_MAX, chain, releaseCmds, renameCmds, editInput,
} from '../sidebar-core.mjs';

const vectors = JSON.parse(fs.readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const lines = (opts) => render(opts).split('\n').map(strip);
const tableLines = (opts) => renderTable(opts).split('\n').map(strip);
const pick = (...indexes) => indexes.map((i) => vectors.rows[i]);
const ALL = pick(0, 1, 2, 3, 4, 5);

for (const c of vectors.cases) {
  test(`vector: ${c.name}`, () => {
    const draw = c.view === 'table' ? renderTable : render;
    const extra = { dragging: c.dragging ?? null, drop: c.drop ?? null, focus: c.focus ?? null, edit: c.edit ?? null };
    const out = draw({ rows: pick(...c.rows), width: c.width, height: c.height, confirm: c.confirm, now: vectors.now, ...extra });
    assert.deepEqual(out.split('\n'), c.raw);
    assert.deepEqual(strip(out).split('\n'), c.text);
  });
}

test('render and renderTable default confirm and now', () => {
  const out = render({ rows: pick(3), width: 30, height: 11 });
  assert.equal(strip(out).split('\n')[4], '   done work      #318 merged ');
  assert.equal(strip(renderTable({ rows: pick(3), width: 60, height: 4 })).split('\n')[3].trimEnd(), ' ✓ done             summarize PR feedback                 ✕');
});

test('fit pads, truncates with an ellipsis and counts wide characters', () => {
  assert.equal(fit('abc', 5), 'abc  ');
  assert.equal(fit('abcdef', 5), 'abcd…');
  assert.equal(fit('abcde', 5), 'abcde');
  assert.equal(fit('abc', 0), '');
  assert.equal(fit('abc', -2), '');
  assert.equal(fit('修复修复', 5), '修复…');
  assert.equal(fit('修复修复', 6), '修复… ');
  assert.equal(fit('', 3), '   ');
  assert.equal(textWidth('修复 bug 🐛'), 11);
  assert.equal(textWidth('é'), 1);
});

test('age', () => {
  assert.equal(age(0, 100), '');
  assert.equal(age(100, 0), '');
  assert.equal(age(100, 101), '');
  assert.equal(age(100, 100), 'now');
  assert.equal(age(159, 100), 'now');
  assert.equal(age(160, 100), '1m');
  assert.equal(age(3699, 100), '59m');
  assert.equal(age(3700, 100), '1h');
  assert.equal(age(86499, 100), '23h');
  assert.equal(age(86500, 100), '1d');
  assert.equal(age(100 + 86400 * 9, 100), '9d');
});

test('repoLabel', () => {
  assert.equal(repoLabel('/code/web-app/.git\nfix-login\n', '/code/web-app/src'), 'web-app · fix-login');
  assert.equal(repoLabel('/code/web-app/.git\nfeature\n', '/code/worktrees/feature'), 'web-app · feature');
  assert.equal(repoLabel('/srv/git/api.git\nmain\n', '/srv/git/api.git'), 'api · main');
  assert.equal(repoLabel('/srv/git/bare\nmain', '/x'), 'bare · main');
  assert.equal(repoLabel('/code/web/.git\nHEAD\n', '/code/web'), 'web · detached');
  assert.equal(repoLabel('/code/web/.git\n', '/code/web'), 'web · detached');
  assert.equal(repoLabel(null, '/tmp/scratch'), 'scratch');
  assert.equal(repoLabel(null, '/tmp/scratch/'), 'scratch');
  assert.equal(repoLabel('.git\nmain\n', '/tmp/rel'), 'rel');
  assert.equal(repoLabel('', '/'), '');
});

test('optionValue', () => {
  assert.equal(optionValue('  a\tb\n c  '), 'a b c');
  assert.equal(optionValue('find . ;'), 'find .');
  assert.equal(optionValue('a; ; '), 'a');
  assert.equal(optionValue('a\u0000b\u007fc\u009fd'), 'a b c d');
  assert.equal(optionValue('x'.repeat(50)).length, 40);
  assert.equal(optionValue('修'.repeat(50), 60), '修'.repeat(50));
  assert.equal(Array.from(optionValue('🐛'.repeat(50))).length, 40);
  assert.equal(optionValue('abc; def', 4), 'abc');
  assert.equal(optionValue('abcdef', 3), 'abc');
  assert.equal(optionValue(''), '');
  assert.equal(optionValue('#(echo hi)'), '#(echo hi)');
});

test('parsePrs and prValue', () => {
  assert.deepEqual(parsePrs('88:o:r,90:o:p'), [{ number: 88, state: 'o', ci: 'r' }, { number: 90, state: 'o', ci: 'p' }]);
  assert.deepEqual(parsePrs('7:c:'), [{ number: 7, state: 'c', ci: '' }]);
  assert.deepEqual(parsePrs(''), []);
  assert.deepEqual(parsePrs(undefined), []);
  assert.deepEqual(parsePrs('0:o:p,x,12:z:p,1234567890:o:,5:m:q,6:m:'), [{ number: 6, state: 'm', ci: '' }]);
  assert.equal(parsePrs('1:o:,2:o:,3:o:,4:o:').length, 3);
  assert.equal(prValue(parsePrs('88:o:r,90:o:p')), '88:o:r,90:o:p');
  assert.equal(prValue([{ number: 1, state: 'o', ci: '' }, { number: 0, state: 'o', ci: '' }, { number: 2, state: 'x', ci: '' }]), '1:o:');
  assert.equal(prValue([1, 2, 3, 4].map((number) => ({ number, state: 'm', ci: 'p' }))), '1:m:p,2:m:p,3:m:p');
  assert.equal(prValue([]), '');
});

test('prBadge follows the lead PR', () => {
  assert.equal(prBadge([]), null);
  assert.deepEqual(prBadge(parsePrs('412:o:f')), { text: '#412 ✗', color: 203 });
  assert.deepEqual(prBadge(parsePrs('88:o:r,90:o:p')), { text: '#88+1 ◌', color: 75 });
  assert.deepEqual(prBadge(parsePrs('501:o:,502:o:p')), { text: '#502+1 ✓', color: 71 });
  assert.deepEqual(prBadge(parsePrs('1:o:p,2:o:r,3:o:f')), { text: '#3+2 ✗', color: 203 });
  assert.deepEqual(prBadge(parsePrs('5:o:')), { text: '#5', color: 244 });
  assert.deepEqual(prBadge(parsePrs('318:m:p')), { text: '#318 merged', color: 141 });
  assert.deepEqual(prBadge(parsePrs('7:c:')), { text: '#7 closed', color: 244 });
  assert.deepEqual(prBadge(parsePrs('1:m:p,2:o:')), { text: '#2+1', color: 244 });
  assert.deepEqual(prBadge(parsePrs('1:m:p,2:c:f')), { text: '#2+1 closed', color: 244 });
  assert.deepEqual(prBadge(parsePrs('1:c:,2:m:')), { text: '#2+1 merged', color: 141 });
});

test('prCell lists every PR', () => {
  assert.deepEqual(prCell([]), { text: '', color: 244 });
  assert.deepEqual(prCell(parsePrs('88:o:r,90:o:p')), { text: '#88 running, #90 passing', color: 75 });
  assert.deepEqual(prCell(parsePrs('501:o:,502:o:f,3:m:p')), { text: '#501 open, #502 failing, #3 merged', color: 203 });
  assert.deepEqual(prCell(parsePrs('7:c:,8:m:')), { text: '#7 closed, #8 merged', color: 141 });
});

test('needsConfirm', () => {
  assert.equal(needsConfirm('done'), false);
  assert.equal(needsConfirm('seen'), false);
  for (const s of ['', 'working', 'input', 'other']) assert.equal(needsConfirm(s), true);
});

test('layout keeps five lines for the new-session line and the box, and scrolls to the active row', () => {
  assert.deepEqual(layout({ rows: ALL, height: 27 }).map((l) => [l.row.id, l.top]), [['@1', 3], ['@2', 7], ['@3', 11], ['@4', 15], ['@5', 19]]);
  assert.deepEqual(layout({ rows: ALL, height: 29 }).map((l) => l.row.id), ['@1', '@2', '@3', '@4', '@5']);
  assert.deepEqual(layout({ rows: ALL, height: 31 }).map((l) => l.row.id), ['@1', '@2', '@3', '@4', '@5', '@6']);
  assert.deepEqual(layout({ rows: pick(0, 2, 3, 4, 6), height: 15 }).map((l) => [l.row.id, l.top]), [['@5', 3], ['@7', 7]]);
  assert.deepEqual(layout({ rows: pick(0, 6, 2, 3, 4), height: 15 }).map((l) => l.row.id), ['@1', '@7']);
  assert.deepEqual(layout({ rows: pick(0, 2, 3), height: 16 }).map((l) => l.row.id), ['@1', '@3']);
  assert.deepEqual(layout({ rows: pick(0, 2, 3), height: 15 }).map((l) => l.row.id), ['@1', '@3']);
  assert.deepEqual(layout({ rows: ALL, height: 10 }), []);
  assert.deepEqual(layout({ rows: ALL, height: 0 }), []);
  assert.deepEqual(layout({ rows: [], height: 24 }), []);
});

test('newLine is the line the new-session text is drawn on', () => {
  assert.equal(newLine({ rows: [], height: 9 }), 4);
  assert.equal(newLine({ rows: ALL, height: 27 }), 24);
  assert.equal(newLine({ rows: ALL, height: 15 }), 12);
  assert.equal(newLine({ rows: pick(0, 2, 3), height: 16 }), 12);
  assert.equal(newLine({ rows: pick(0), height: 40 }), 8);
  for (const c of vectors.cases.filter((v) => v.view === 'normal')) {
    const at = newLine({ rows: pick(...c.rows), height: c.height });
    if (at <= c.text.length) assert.equal(c.text[at - 1].trimEnd(), fit(' + new session', c.width).trimEnd(), c.name);
  }
});

test('the table keeps the window order, whatever the states', () => {
  const rows = [
    { id: '@1', state: 'seen', since: 5 }, { id: '@2', state: 'input', since: 0 }, { id: '@3', state: 'done', since: 9 },
    { id: '@4', state: 'input', since: 50 }, { id: '@5', state: 'working', since: 1 },
  ];
  assert.deepEqual(tableLayout({ rows, height: 40 }).map((l) => l.row.id), ['@1', '@2', '@3', '@4', '@5']);
});

test('moveId puts a row where another is; moveArgs names the tmux move for it', () => {
  const ids = ['@1', '@2', '@3', '@4'];
  assert.deepEqual(moveId(ids, '@1', '@3'), ['@2', '@3', '@1', '@4']);
  assert.deepEqual(moveId(ids, '@4', '@2'), ['@1', '@4', '@2', '@3']);
  assert.equal(moveId(ids, '@2', '@2'), ids);
  assert.equal(moveId(ids, '@9', '@2'), ids);
  assert.deepEqual(moveArgs(['@2', '@3', '@1', '@4'], '@1'), ['move-window', '-d', '-b', '-s', '@1', '-t', '@4']);
  assert.deepEqual(moveArgs(['@2', '@3', '@1'], '@1'), ['move-window', '-d', '-a', '-s', '@1', '-t', '@3']);
  assert.equal(moveArgs(['@1'], '@1'), null);
  assert.equal(moveArgs(ids, '@9'), null);
});

const mk = (over) => ({ id: '@0', active: false, state: '', tag: '', since: 0, wait: '', model: '', repo: '', pr: '', group: '', name: '', ...over });
const SIX = Array.from({ length: 6 }, (_, i) => mk({ id: `@${i + 1}`, active: i === 1, name: `w${i + 1}` }));
const ids = (rows) => rows.map((r) => r.id);
const keys = (items) => items.map((i) => i.key);
const moved = (id, args, group = null, created = false) => ({ kind: 'move', id, args, group, created });
// A press on `id` at line y at time 0, then one move per [y, ms].
function dragged(id, y, moves, opts = {}) {
  const base = { rows: SIX, height: 40, zoomed: false, ...opts };
  let drag = dragBegin({ id, y, now: 0, ...base });
  for (const [to, now] of moves) drag = dragMove(drag, { y: to, now, ...base });
  return drag;
}

test('a press and release without moving selects the row; a quick one-line slip still does', () => {
  assert.deepEqual(dragEnd(dragged('@1', 4, []), SIX), { kind: 'select', id: '@1' });
  const slip = dragged('@1', 5, [[6, 80]], { zoomed: true });
  assert.equal(slip.engaged, false);
  assert.deepEqual(dragEnd(slip, SIX), { kind: 'select', id: '@1' });
  assert.equal(dragView(SIX, slip, 100).dragging, null, 'a click never draws the held look');
});

test('a slow one-line move or any two-line move starts the drag', () => {
  assert.equal(dragged('@2', 5, [[6, 400]], { zoomed: true }).engaged, true);
  assert.equal(dragged('@2', 5, [[7, 50]], { zoomed: true }).engaged, true);
});

test('the held row takes the place of the row under the pointer, in both views', () => {
  const down = dragged('@1', 4, [[8, 300], [12, 400]]);
  assert.deepEqual(down.order, ['@2', '@3', '@1', '@4', '@5', '@6']);
  assert.deepEqual(dragEnd(down, SIX), moved('@1', ['move-window', '-d', '-b', '-s', '@1', '-t', '@4']));
  const up = dragged('@6', 9, [[4, 300]], { zoomed: true });
  assert.deepEqual(up.order, ['@6', '@1', '@2', '@3', '@4', '@5']);
  const last = dragged('@1', 4, [[9, 300]], { zoomed: true });
  assert.deepEqual(dragEnd(last, SIX), moved('@1', ['move-window', '-d', '-a', '-s', '@1', '-t', '@6']));
});

test('dragging a row away and back cancels: no move and no select', () => {
  const back = dragged('@1', 4, [[8, 300], [4, 400]]);
  assert.deepEqual(back.order, ids(SIX));
  assert.deepEqual(dragEnd(back, SIX), { kind: 'none' });
});

test('a drag survives rows changing under it, and ends as nothing when its row is gone', () => {
  const drag = dragged('@1', 4, [[12, 300]]);
  const fewer = SIX.filter((r) => r.id !== '@3');
  const more = [...SIX, mk({ id: '@9', name: 'new' })];
  assert.deepEqual(keys(listItems({ rows: fewer, order: drag.order })), ['@2', '@1', '@4', '@5', '@6']);
  assert.deepEqual(keys(listItems({ rows: more, order: drag.order })), ['@2', '@3', '@1', '@4', '@5', '@6', '@9']);
  assert.deepEqual(dragEnd(drag, fewer), moved('@1', ['move-window', '-d', '-b', '-s', '@1', '-t', '@4']));
  assert.deepEqual(dragEnd(drag, SIX.filter((r) => r.id !== '@1')), { kind: 'none' });
  assert.deepEqual(dragEnd(null, SIX), { kind: 'none' });
});

test('the view holds still during a drag and scrolls one row past either end', () => {
  const many = Array.from({ length: 10 }, (_, i) => mk({ id: `@${i}`, active: i === 6, name: `w${i}` }));
  const opts = { rows: many, height: 27, zoomed: false };
  assert.deepEqual(layout({ rows: many, height: 27 }).map((s) => s.row.id), ['@2', '@3', '@4', '@5', '@6']);
  let drag = dragBegin({ id: '@6', y: 20, now: 0, ...opts });
  assert.equal(drag.start, 2);
  drag = dragMove(drag, { y: 8, now: 300, ...opts });
  const view = dragView(many, drag, 300);
  assert.deepEqual(layout({ rows: view.rows, height: 27, start: view.start, order: view.order }).map((s) => s.row.id), ['@2', '@6', '@3', '@4', '@5'],
    'the active row moved up and the view did not follow it');
  drag = dragMove(drag, { y: 1, now: 400, ...opts });
  assert.equal(drag.start, 1);
  assert.deepEqual(drag.order.slice(0, 3), ['@0', '@6', '@1']);
  drag = dragMove(drag, { y: 1, now: 500, ...opts });
  assert.equal(drag.start, 0);
  assert.equal(drag.order[0], '@6');
  drag = dragMove(drag, { y: 1, now: 600, ...opts });
  assert.equal(drag.start, 0);
  let down = dragBegin({ id: '@2', y: 4, now: 0, ...opts });
  down = dragMove(down, { y: 22, now: 300, ...opts });
  assert.equal(down.start, 3);
  assert.equal(down.order.indexOf('@2'), 7);
  assert.equal(dragMove(down, { y: 24, now: 400, ...opts }).drop, null, 'the new-session line is not the box');
  assert.equal(dragMove(down, { y: 25, now: 400, ...opts }).drop, 'new', 'the lines under it are');
});

test('a drag with no mouse event for DRAG_STALE_MS is over: not drawn, and expired for the tick to drop', () => {
  const drag = dragged('@1', 4, [[12, 300]]);
  assert.equal(dragView(SIX, drag, 300 + DRAG_STALE_MS).dragging, '@1');
  assert.equal(dragExpired(drag, 300 + DRAG_STALE_MS), false);
  const stale = dragView(SIX, drag, 301 + DRAG_STALE_MS);
  assert.deepEqual([stale.dragging, stale.start, stale.rows], [null, null, SIX]);
  assert.equal(dragExpired(drag, 301 + DRAG_STALE_MS), true);
  assert.equal(dragExpired(null, 0), false);
  assert.deepEqual(dragView(SIX, null, 0), { rows: SIX, order: null, dragging: null, start: null, drop: null });
});

test('the expanded list scrolls from its first and last rows, whose lines are the pane edges', () => {
  const many = Array.from({ length: 30 }, (_, i) => mk({ id: `@${i}`, active: i === 0, name: `w${i}` }));
  const opts = { rows: many, height: 12, zoomed: true };
  let drag = dragBegin({ id: '@2', y: 6, now: 0, ...opts });
  assert.equal(drag.start, 0);
  drag = dragMove(drag, { y: 12, now: 300, ...opts });
  assert.equal(drag.start, 1);
  assert.equal(drag.order.indexOf('@2'), 9);
  drag = dragMove(drag, { y: 12, now: 400, ...opts });
  assert.equal(drag.start, 2);
  assert.equal(drag.order.indexOf('@2'), 10);
  drag = dragMove(drag, { y: 4, now: 500, ...opts });
  assert.equal(drag.start, 1);
  assert.equal(drag.order.indexOf('@2'), 1);
});

test('a held row changes only its mark and background', () => {
  const opts = { rows: pick(0, 1, 2), width: 30, height: 24, now: vectors.now };
  assert.equal(render({ ...opts, dragging: null }), render(opts));
  const plain = render(opts).split('\n');
  const held = render({ ...opts, dragging: '@1' }).split('\n');
  assert.deepEqual(held.map((l, i) => l !== plain[i]).flatMap((d, i) => (d ? [i] : [])), [3, 4, 5]);
  assert.ok(held[3].startsWith('\x1b[48;5;239m \x1b[38;5;75m↕\x1b[39m '), JSON.stringify(held[3]));
});

test('tableLayout', () => {
  assert.deepEqual(tableLayout({ rows: ALL, height: 12 }).map((l) => [l.row.id, l.y]), [['@1', 4], ['@2', 5], ['@3', 6], ['@4', 7], ['@5', 8], ['@6', 9]]);
  assert.deepEqual(tableLayout({ rows: ALL, height: 5 }).map((l) => [l.row.id, l.y]), [['@1', 4], ['@2', 5]]);
  assert.deepEqual(tableLayout({ rows: pick(0, 2, 3, 4, 6), height: 5 }).map((l) => [l.row.id, l.y]), [['@5', 4], ['@7', 5]]);
  assert.deepEqual(tableLayout({ rows: ALL, height: 3 }), []);
});

test('hit: normal view', () => {
  const at = (x, y, extra = {}) => hit({ x, y, rows: ALL, width: 30, height: 27, confirm: null, ...extra });
  assert.deepEqual(at(28, 1), { kind: 'expand', id: null });
  assert.deepEqual(at(30, 1), { kind: 'expand', id: null });
  assert.deepEqual(at(27, 1), { kind: 'none', id: null });
  assert.deepEqual(at(5, 2), { kind: 'none', id: null });
  assert.deepEqual(at(5, 3), { kind: 'select', id: '@1' });
  assert.deepEqual(at(5, 4), { kind: 'select', id: '@1' });
  assert.deepEqual(at(27, 4), { kind: 'select', id: '@1' });
  assert.deepEqual(at(28, 4), { kind: 'close', id: '@1' });
  assert.deepEqual(at(30, 4), { kind: 'close', id: '@1' });
  assert.deepEqual(at(29, 5), { kind: 'select', id: '@1' });
  assert.deepEqual(at(29, 6), { kind: 'select', id: '@1' });
  assert.deepEqual(at(29, 7), { kind: 'select', id: '@2' });
  assert.deepEqual(at(29, 8), { kind: 'close', id: '@2' });
  assert.deepEqual(at(1, 22), { kind: 'select', id: '@5' });
  assert.deepEqual(at(1, 23), { kind: 'none', id: null });
});

test('hit: the new-session line', () => {
  const at = (x, y, rows = ALL, height = 27) => hit({ x, y, rows, width: 30, height, confirm: null });
  assert.deepEqual(at(1, 24), { kind: 'new', id: null });
  assert.deepEqual(at(14, 24), { kind: 'new', id: null });
  assert.deepEqual(at(15, 24), { kind: 'none', id: null });
  for (const y of [25, 26, 27]) assert.deepEqual(at(3, y), { kind: 'none', id: null }, 'a press on the box does nothing');
  assert.deepEqual(at(3, 4, [], 9), { kind: 'new', id: null });
  assert.deepEqual(at(3, 3, [], 9), { kind: 'none', id: null });
  assert.deepEqual(at(3, 12, ALL, 15), { kind: 'new', id: null });
  assert.deepEqual(at(3, 11, ALL, 15), { kind: 'none', id: null });
  assert.deepEqual(at(3, 12, pick(0, 2, 3), 16), { kind: 'new', id: null });
  assert.deepEqual(at(3, 13, pick(0, 2, 3), 16), { kind: 'none', id: null });
  assert.deepEqual(at(3, 8, pick(0), 40), { kind: 'new', id: null });
  assert.deepEqual(at(3, 12, pick(0), 40), { kind: 'none', id: null });
});

test('hit: confirming a close', () => {
  const at = (x, y) => hit({ x, y, rows: ALL, width: 30, height: 24, confirm: '@3' });
  assert.deepEqual(at(9, 13), { kind: 'none', id: null });
  assert.deepEqual(at(10, 13), { kind: 'yes', id: '@3' });
  assert.deepEqual(at(12, 13), { kind: 'yes', id: '@3' });
  assert.deepEqual(at(13, 13), { kind: 'none', id: null });
  assert.deepEqual(at(15, 13), { kind: 'none', id: null });
  assert.deepEqual(at(16, 13), { kind: 'no', id: '@3' });
  assert.deepEqual(at(17, 13), { kind: 'no', id: '@3' });
  assert.deepEqual(at(18, 13), { kind: 'none', id: null });
  assert.deepEqual(at(29, 12), { kind: 'close', id: '@3' });
  assert.deepEqual(at(11, 12), { kind: 'select', id: '@3' });
  assert.deepEqual(at(11, 14), { kind: 'select', id: '@3' });
  assert.deepEqual(at(11, 9), { kind: 'select', id: '@2' });
});

test('hit: scrolled list and narrow widths', () => {
  const rows = pick(0, 2, 3, 4, 6);
  assert.deepEqual(hit({ x: 2, y: 4, rows, width: 30, height: 15, confirm: null }), { kind: 'select', id: '@5' });
  assert.deepEqual(hit({ x: 29, y: 8, rows, width: 30, height: 15, confirm: null }), { kind: 'close', id: '@7' });
  assert.deepEqual(hit({ x: 4, y: 1, rows: pick(0), width: 6, height: 13, confirm: null }), { kind: 'expand', id: null });
  assert.deepEqual(hit({ x: 3, y: 1, rows: pick(0), width: 6, height: 13, confirm: null }), { kind: 'none', id: null });
});

test('hitTable', () => {
  const at = (x, y, confirm = null) => hitTable({ x, y, rows: ALL, width: 100, height: 12, confirm });
  assert.deepEqual(at(90, 1), { kind: 'collapse', id: null });
  assert.deepEqual(at(100, 1), { kind: 'collapse', id: null });
  assert.deepEqual(at(89, 1), { kind: 'none', id: null });
  assert.deepEqual(at(50, 2), { kind: 'none', id: null });
  assert.deepEqual(at(50, 3), { kind: 'none', id: null });
  assert.deepEqual(at(50, 4), { kind: 'select', id: '@1' });
  assert.deepEqual(at(50, 9), { kind: 'select', id: '@6' });
  assert.deepEqual(at(97, 7), { kind: 'select', id: '@4' });
  assert.deepEqual(at(98, 7), { kind: 'close', id: '@4' });
  assert.deepEqual(at(100, 8), { kind: 'close', id: '@5' });
  assert.deepEqual(at(50, 10), { kind: 'none', id: null });
  assert.deepEqual(at(11, 7, '@4'), { kind: 'yes', id: '@4' });
  assert.deepEqual(at(16, 7, '@4'), { kind: 'no', id: '@4' });
  assert.deepEqual(at(99, 7, '@4'), { kind: 'none', id: null });
  assert.deepEqual(at(11, 8, '@4'), { kind: 'select', id: '@5' });
  assert.deepEqual(at(1, 12), { kind: 'none', id: null });
  assert.deepEqual(hitTable({ x: 14, y: 24, rows: ALL, width: 30, height: 24, confirm: null }), { kind: 'none', id: null });
});

test('parseWindows', () => {
  const out = [
    '@1\t1\tinput\twork\t1763298140\tplan approval\topus · plan\tetl · main\t412:o:f\tweb\tplan the importer',
    '@2\t0\t\t\t\t\t\t\t\t\tname\twith\ttabs',
    'not a window\t1',
    '@x\t1\tdone\t\t5\t\t\t\t\t\tbad id',
    '@3\t0\tdone\tt\u0007ag\t12x\t\t\t\t\tg\u0007x\tbe\u001bll',
    '',
  ].join('\n');
  assert.deepEqual(parseWindows(out), [
    { id: '@1', active: true, state: 'input', tag: 'work', since: 1763298140, wait: 'plan approval', model: 'opus · plan', repo: 'etl · main', pr: '412:o:f', group: 'web', name: 'plan the importer' },
    { id: '@2', active: false, state: '', tag: '', since: 0, wait: '', model: '', repo: '', pr: '', group: '', name: 'name with tabs' },
    { id: '@3', active: false, state: 'done', tag: 'tag', since: 0, wait: '', model: '', repo: '', pr: '', group: 'gx', name: 'bell' },
  ]);
  assert.deepEqual(parseWindows(''), []);
});

// ---- groups ----

// tmux order @1..@5; listed as @1 @3, then web: @2 @5, then api: @4.
const GROUPED = [
  mk({ id: '@1', state: 'input', name: 'a' }),
  mk({ id: '@2', state: 'input', group: 'web', name: 'b' }),
  mk({ id: '@3', name: 'c' }),
  mk({ id: '@4', group: 'api', name: 'd' }),
  mk({ id: '@5', state: 'input', group: 'web', name: 'e' }),
];
const LISTED = ['@1', '@3', 'g:web', '@2', '@5', 'g:api', '@4'];
function groupDrag(id, y, moves, opts = {}) {
  const base = { rows: GROUPED, height: 40, zoomed: false, ...opts };
  let drag = dragBegin({ id, y, now: 0, ...base });
  for (const [to, now] of moves) drag = dragMove(drag, { y: to, now, ...base });
  return drag;
}

test('groupName strips what tmux would read as a format or a command end, and caps the length', () => {
  assert.equal(groupName(' a\tb\u0000c  '), 'a b c');
  assert.equal(groupName('#{pane_id} x'), '{pane_id} x');
  assert.equal(groupName('a # b'), 'a b');
  assert.equal(groupName('web;'), 'web');
  assert.equal(groupName('web ; ;'), 'web');
  assert.equal(groupName('x'.repeat(30)), 'x'.repeat(GROUP_MAX));
  assert.equal(groupName('日本'.repeat(20)), '日本'.repeat(12));
  assert.equal(groupName(`${'y'.repeat(23)};z`), `${'y'.repeat(23)}`);
  assert.deepEqual([null, undefined, '', ' # '].map(groupName), ['', '', '', '']);
});

test('newGroupName takes the lowest group number not in use', () => {
  assert.equal(newGroupName(GROUPED), 'group 1');
  assert.equal(newGroupName([mk({ group: 'group 1' }), mk({ group: 'group 3' })]), 'group 2');
});

test('listItems: ungrouped rows first, then each group in the order of its first member', () => {
  assert.deepEqual(keys(listItems({ rows: GROUPED })), LISTED);
  assert.deepEqual(listItems({ rows: GROUPED }).map((i) => i.group), ['', '', 'web', 'web', 'web', 'api', 'api']);
  assert.deepEqual(keys(listItems({ rows: GROUPED, focus: 'web' })), ['g:web', '@2', '@5']);
  assert.deepEqual(keys(listItems({ rows: GROUPED, focus: 'gone' })), LISTED, 'a focus naming no member is ignored');
  assert.deepEqual(keys(listItems({ rows: SIX })), ids(SIX), 'no group, no head');
});

test('listItems with a drag order: a row belongs to the head above it, and heads stay', () => {
  const preview = listItems({ rows: GROUPED, order: ['@1', 'g:web', '@3', '@2', '@5', 'g:api', '@4'] });
  assert.deepEqual(preview.map((i) => [i.key, i.group]), [['@1', ''], ['g:web', 'web'], ['@3', 'web'], ['@2', 'web'], ['@5', 'web'], ['g:api', 'api'], ['@4', 'api']]);
  const emptied = listItems({ rows: GROUPED, order: ['@1', '@3', 'g:web', '@2', '@5', '@4', 'g:api'] });
  assert.deepEqual(keys(emptied), ['@1', '@3', 'g:web', '@2', '@5', '@4', 'g:api'], 'the head of the held row\'s old group stays');
  const changed = [...GROUPED.filter((r) => r.id !== '@3'), mk({ id: '@9', group: 'web' })];
  assert.deepEqual(keys(listItems({ rows: changed, order: LISTED })), ['@1', 'g:web', '@2', '@5', '@9', 'g:api', '@4'],
    'a new row ends its own group\'s section; a gone one is dropped');
  const plain = [...changed, mk({ id: '@8' }), mk({ id: '@7', group: 'new' })];
  assert.deepEqual(keys(listItems({ rows: plain, order: LISTED })), ['@1', '@8', 'g:web', '@2', '@5', '@9', 'g:api', '@4', 'g:new', '@7']);
  assert.deepEqual(keys(listItems({ rows: changed, order: ['g:web', '@2', '@5'], focus: 'web' })), ['g:web', '@2', '@5', '@9']);
});

test('a group head is a spacer and a title line with the name, a rule and the focus eye', () => {
  const out = lines({ rows: GROUPED, width: 30, height: 40 });
  assert.equal(out.length, 2 + 4 * 5 + 2 * 2 + 5);
  for (const l of out) assert.equal(textWidth(l), 30, JSON.stringify(l));
  assert.equal(out[10].trim(), '');
  assert.equal(out[11], ` web ${'─'.repeat(22)} ◎ `);
  assert.equal(out[21], ` api ${'─'.repeat(22)} ◎ `);
  assert.match(out[13], / b /);
  assert.equal(out.at(-4).trimEnd(), ' + new session');
  const raw = render({ rows: GROUPED, width: 30, height: 40 }).split('\n')[11];
  assert.ok(raw.includes('\x1b[1mweb\x1b[22m'), 'the name is bold');
  assert.ok(raw.startsWith(` \x1b[38;5;176m\x1b[1mweb\x1b[22m ${'─'.repeat(22)}\x1b[39m`), 'the name and rule take the head colour');
  assert.ok(raw.endsWith('\x1b[38;5;244m ◎ \x1b[39m'), JSON.stringify(raw));
  const focused = render({ rows: GROUPED, width: 30, height: 40, focus: 'web' }).split('\n');
  assert.equal(focused.length, 2 + 2 + 4 * 2 + 5);
  assert.ok(focused[3].endsWith('\x1b[38;5;75m ◉ \x1b[39m'), JSON.stringify(focused[3]));
  const long = 'x'.repeat(GROUP_MAX);
  for (const width of [WIDTH_MIN, 25, 30, WIDTH_MAX]) {
    const shown = lines({ rows: [mk({ id: '@1', group: long, name: 'n' })], width, height: 20 });
    for (const l of shown) assert.equal(textWidth(l), width, `${width}: ${JSON.stringify(l)}`);
    assert.ok(shown[3].endsWith(' ◎ '));
  }
  assert.equal(lines({ rows: [mk({ id: '@1', group: long, name: 'n' })], width: 20, height: 20 })[3], ` ${'x'.repeat(15)}… ◎ `, 'the rule goes first');
});

test('a group being renamed shows the draft and a cursor in place of the name and rule', () => {
  const out = lines({ rows: GROUPED, width: 30, height: 40, edit: { group: 'web', text: 'front end' } });
  assert.equal(out[11], ` front end▏${' '.repeat(16)} ◎ `);
  assert.equal(out[21], ` api ${'─'.repeat(22)} ◎ `);
  const long = lines({ rows: GROUPED, width: 20, height: 40, edit: { group: 'web', text: 'abcdefghijklmnopqrstuvwx' } });
  assert.equal(long[11], ' jklmnopqrstuvwx▏ ◎ ', 'a long draft shows its end');
  const table = tableLines({ rows: GROUPED, width: 120, height: 40, edit: { group: 'api', text: '' } });
  assert.equal(table[8], ` ▏${' '.repeat(115)} ◎ `);
  const short = GROUPED.map((r) => ({ ...r, active: r.id === '@1' }));
  assert.ok(!lines({ rows: short, width: 30, height: 16 }).some((l) => l.startsWith(' api')));
  assert.ok(lines({ rows: short, width: 30, height: 16, edit: { group: 'api', text: 'api' } }).some((l) => l.startsWith(' api▏')),
    'the view scrolls to the head being renamed');
  assert.ok(tableLines({ rows: short, width: 80, height: 6, edit: { group: 'api', text: 'api' } }).some((l) => l.startsWith(' api▏')));
});

test('hit agrees with render on a head: the eye focuses, the rest renames, the spacer is nothing', () => {
  for (const width of [WIDTH_MIN, 30, WIDTH_MAX]) {
    const opts = { rows: GROUPED, width, height: 40 };
    const out = lines(opts);
    const y = out.findIndex((l) => l.startsWith(' web')) + 1;
    assert.equal(y, 12);
    for (const x of [width - 2, width - 1, width]) assert.deepEqual(hit({ ...opts, x, y }), { kind: 'focus', id: null, group: 'web' });
    assert.equal(out[y - 1][width - 2], '◎');
    for (const x of [1, 3, width - 3]) assert.deepEqual(hit({ ...opts, x, y }), { kind: 'rename', id: null, group: 'web' });
    assert.deepEqual(hit({ ...opts, x: 3, y: y - 1 }), { kind: 'none', id: null });
    assert.deepEqual(hit({ ...opts, x: 3, y: y + 2 }), { kind: 'select', id: '@2' });
    assert.deepEqual(hit({ ...opts, x: 3, y: newLine(opts) }), { kind: 'new', id: null });
    assert.equal(out[newLine(opts) - 1].trimEnd(), ' + new session');
  }
  const focused = { rows: GROUPED, width: 30, height: 40, focus: 'web' };
  assert.deepEqual(hit({ ...focused, x: 29, y: 4 }), { kind: 'focus', id: null, group: 'web' });
  assert.deepEqual(hit({ ...focused, x: 3, y: 6 }), { kind: 'select', id: '@2' });
  for (const width of [80, 120]) {
    const opts = { rows: GROUPED, width, height: 40 };
    const out = tableLines(opts);
    for (const l of out) assert.equal(textWidth(l), width, JSON.stringify(l));
    assert.deepEqual(out.slice(3).map((l) => l.trim().split(/\s+/)[0]), ['●', '·', 'web', '●', '●', 'api', '·']);
    assert.equal(out[5], ` web ${'─'.repeat(width - 8)} ◎ `);
    assert.deepEqual(hitTable({ ...opts, x: width, y: 6 }), { kind: 'focus', id: null, group: 'web' });
    assert.deepEqual(hitTable({ ...opts, x: 5, y: 6 }), { kind: 'rename', id: null, group: 'web' });
    assert.deepEqual(hitTable({ ...opts, x: 5, y: 7 }), { kind: 'select', id: '@2' });
    assert.deepEqual(hitTable({ ...opts, x: width, y: 7 }), { kind: 'close', id: '@2' });
  }
});

test('with a focus on, the counts name the rows outside the group that need input', () => {
  assert.equal(lines({ rows: GROUPED, width: 30, height: 40 })[1].trimEnd(), ' 3 need input');
  assert.equal(lines({ rows: GROUPED, width: 30, height: 40, focus: 'web' })[1].trimEnd(), ' 2 need input, 1 elsewhere');
  assert.equal(lines({ rows: GROUPED, width: 30, height: 40, focus: 'api' })[1].trimEnd(), ' nothing waiting, 3 elsewhere');
  assert.match(tableLines({ rows: GROUPED, width: 120, height: 40, focus: 'web' })[0], /^ band {3}2 sessions, 2 need input, 1 elsewhere +⤡ collapse $/);
  assert.match(tableLines({ rows: GROUPED, width: 120, height: 40, focus: 'gone' })[0], /^ band {3}5 sessions, 3 need input +⤡/);
});

test('the viewport fits items by their lines and keeps the active row whole', () => {
  const at = (active) => GROUPED.map((r) => ({ ...r, active: r.id === active }));
  assert.deepEqual(keys(layout({ rows: at('@3'), height: 19 })), ['@1', '@3', 'g:web']);
  assert.deepEqual(keys(layout({ rows: at('@5'), height: 19 })), ['g:web', '@2', '@5', 'g:api']);
  assert.deepEqual(layout({ rows: at('@5'), height: 19 }).map((s) => s.top), [3, 5, 9, 13]);
  assert.deepEqual(keys(layout({ rows: GROUPED, height: 19, start: 10 })), ['@5', 'g:api', '@4'], 'a start past the end is clamped to fill the view');
  assert.deepEqual(keys(layout({ rows: GROUPED, height: 19, start: 1 })), ['@3', 'g:web', '@2']);
  assert.equal(newLine({ rows: at('@5'), height: 19 }), 16);
  const out = lines({ rows: at('@5'), height: 19, width: 30 });
  assert.equal(out.length, 19);
  assert.equal(out[3].trimStart().slice(0, 3), 'web');
  assert.deepEqual(tableLayout({ rows: at('@4'), height: 6 }).map((s) => [s.key, s.y]), [['@5', 4], ['g:api', 5], ['@4', 6]]);
});

test('dragging a row onto a group member moves it into that group', () => {
  const drag = groupDrag('@1', 4, [[14, 300]]);
  assert.deepEqual(drag.order, ['@3', 'g:web', '@2', '@1', '@5', 'g:api', '@4']);
  assert.deepEqual(dragEnd(drag, GROUPED), moved('@1', ['move-window', '-d', '-b', '-s', '@1', '-t', '@5'], 'web'));
  const view = dragView(GROUPED, drag, 300);
  assert.match(lines({ ...view, width: 30, height: 40 })[13], /↕ a/, 'the preview draws it under the head');
});

test('dragging a member above its head takes it out of the group', () => {
  const drag = groupDrag('@5', 18, [[4, 300]]);
  assert.deepEqual(drag.order, ['@5', '@1', '@3', 'g:web', '@2', 'g:api', '@4']);
  assert.deepEqual(dragEnd(drag, GROUPED), moved('@5', ['move-window', '-d', '-b', '-s', '@5', '-t', '@1'], ''));
  const up = groupDrag('@2', 14, [[11, 300]]);
  assert.deepEqual(up.order, ['@1', '@3', '@2', 'g:web', '@5', 'g:api', '@4']);
  assert.deepEqual(dragEnd(up, GROUPED), moved('@2', ['move-window', '-d', '-a', '-s', '@2', '-t', '@3'], ''));
});

test('a row crossing a head joins that group, and crossing back undoes it', () => {
  let drag = groupDrag('@3', 8, [[12, 300]]);
  assert.deepEqual(drag.order, ['@1', 'g:web', '@3', '@2', '@5', 'g:api', '@4']);
  assert.deepEqual(dragEnd(drag, GROUPED), moved('@3', ['move-window', '-d', '-b', '-s', '@3', '-t', '@2'], 'web'));
  drag = dragMove(drag, { y: 8, rows: GROUPED, height: 40, now: 400 });
  assert.deepEqual(drag.order, LISTED);
  assert.deepEqual(dragEnd(drag, GROUPED), { kind: 'none' });
  const table = groupDrag('@3', 5, [[6, 400]], { zoomed: true });
  assert.deepEqual(table.order, ['@1', 'g:web', '@3', '@2', '@5', 'g:api', '@4'], 'the expanded list crosses the same way');
});

test('dragEnd moves a window only among its own section\'s rows in tmux order', () => {
  // tmux order: c (in G), a, b. The list shows a, b, then G: c.
  const rows = [mk({ id: '@1', group: 'G', name: 'c' }), mk({ id: '@2', name: 'a' }), mk({ id: '@3', name: 'b' })];
  let drag = dragBegin({ id: '@2', y: 4, rows, height: 40, now: 0 });
  drag = dragMove(drag, { y: 8, rows, height: 40, now: 300 });
  assert.deepEqual(drag.order, ['@3', '@2', 'g:G', '@1']);
  assert.deepEqual(dragEnd(drag, rows), moved('@2', ['move-window', '-d', '-a', '-s', '@2', '-t', '@3']));
  // tmux order G: c, a, G: d. Moving a into G between c and d changes no index.
  const middle = [mk({ id: '@1', group: 'G' }), mk({ id: '@2' }), mk({ id: '@3', group: 'G' })];
  const into = { ...dragBegin({ id: '@2', y: 4, rows: middle, height: 40, now: 0 }), engaged: true, moved: true, order: ['g:G', '@1', '@2', '@3'] };
  assert.deepEqual(dragEnd(into, middle), moved('@2', null, 'G'));
});

test('the new group box: three lines under the new-session line, then a new group on release', () => {
  const opts = { rows: GROUPED, height: 40, zoomed: false };
  const box = newLine(opts);
  assert.equal(box, 28);
  assert.equal(groupDrag('@1', 4, [[box, 300]]).drop, null, 'the new-session line is not the box');
  let drag = groupDrag('@1', 4, [[box + 1, 300]]);
  assert.equal(drag.drop, 'new');
  assert.deepEqual(drag.order, LISTED, 'the order is left as it was');
  const view = dragView(GROUPED, drag, 300);
  assert.equal(view.drop, 'new');
  const raw = render({ ...view, width: 30, height: 40 }).split('\n');
  assert.equal(strip(raw[box - 1]).trimEnd(), ' + new session');
  assert.equal(strip(raw[box]), ` ┌${'┄'.repeat(26)}┐ `);
  assert.equal(strip(raw[box + 1]), ` ┆${' '.repeat(8)}new group${' '.repeat(9)}┆ `);
  assert.equal(strip(raw[box + 2]), ` └${'┄'.repeat(26)}┘ `);
  assert.equal(raw.length, box + 3);
  for (const l of raw.slice(box)) assert.ok(l.startsWith('\x1b[48;5;239m\x1b[38;5;75m'), JSON.stringify(l));
  assert.deepEqual(dragEnd(drag, GROUPED), moved('@1', ['move-window', '-d', '-a', '-s', '@1', '-t', '@5'], 'group 1', true));
  assert.equal(groupDrag('@5', 18, [[box + 3, 300]]).drop, 'new', 'below the line counts');
  assert.deepEqual(dragEnd(groupDrag('@5', 18, [[box + 1, 300]]), GROUPED), moved('@5', null, 'group 1', true), 'already last');
  drag = dragMove(drag, { y: 4, now: 400, ...opts });
  assert.equal(drag.drop, null);
  const away = render({ ...dragView(GROUPED, drag, 400), width: 30, height: 40 }).split('\n');
  assert.match(strip(away[box + 1]), /^ ┆ +new group +┆ $/);
  assert.ok(away[box + 1].startsWith('\x1b[38;5;244m'), 'dim while not the drop');
  assert.deepEqual(dragEnd(drag, GROUPED), { kind: 'select', id: '@1' });
  assert.match(strip(render({ rows: GROUPED, width: 30, height: 40 }).split('\n')[box + 1]), /^ ┆ +new group +┆ $/, 'drawn with no drag');

  let table = groupDrag('@3', 5, [[2, 300]], { zoomed: true });
  assert.equal(table.drop, 'new');
  assert.equal(table.start, 0, 'no scroll over the box');
  const tableRaw = renderTable({ ...dragView(GROUPED, table, 300), width: 80, height: 40 }).split('\n');
  assert.equal(strip(tableRaw[1]).trimEnd(), ' ┆ new group ┆');
  assert.ok(tableRaw[1].startsWith('\x1b[48;5;239m'));
  assert.equal(tableLines({ rows: GROUPED, width: 80, height: 40 })[1].trim(), '┆ new group ┆', 'drawn with no drag');
  assert.deepEqual(dragEnd(table, [...GROUPED, mk({ id: '@6', group: 'group 1' })]),
    moved('@3', ['move-window', '-d', '-a', '-s', '@3', '-t', '@6'], 'group 2', true));
  table = dragMove(table, { y: 4, rows: GROUPED, height: 40, zoomed: true, now: 400 });
  assert.equal(table.drop, null);
});

test('a drag under a focus lists only the group, and dragging above its head leaves it', () => {
  const drag = groupDrag('@5', 10, [[4, 300]], { focus: 'web' });
  assert.deepEqual(drag.order, ['@5', 'g:web', '@2']);
  assert.deepEqual(dragEnd(drag, GROUPED, 'web'), moved('@5', null, ''), 'it joins the ungrouped rows at its tmux place');
  const within = groupDrag('@2', 6, [[10, 300]], { focus: 'web' });
  assert.deepEqual(within.order, ['g:web', '@5', '@2']);
  assert.deepEqual(dragEnd(within, GROUPED, 'web'), moved('@2', ['move-window', '-d', '-a', '-s', '@2', '-t', '@5']));
});

test('no group and no focus render exactly as before', () => {
  const extras = { focus: 'gone', edit: { group: 'gone', text: 'x' }, order: null, drop: null };
  const now = vectors.now;
  for (const width of [WIDTH_MIN, 30, WIDTH_MAX]) {
    assert.equal(render({ rows: ALL, width, height: 40, now, ...extras }), render({ rows: ALL, width, height: 40, now }));
  }
  assert.equal(renderTable({ rows: ALL, width: 120, height: 40, now, ...extras }), renderTable({ rows: ALL, width: 120, height: 40, now }));
  assert.equal(lines({ rows: ALL, width: 30, height: 40, now }).length, 2 + 4 * ALL.length + 5);
  assert.ok(!listItems({ rows: ALL }).some((i) => i.kind === 'head'));
});


test('a row that joins a group mid-drag is listed in that group, and never names the move', () => {
  const before = [mk({ id: '@1' }), mk({ id: '@2' }), mk({ id: '@3', group: 'A' })];
  let drag = dragBegin({ id: '@1', y: 4, rows: before, height: 40, now: 0 });
  drag = dragMove(drag, { y: 8, rows: before, height: 40, now: 300 });
  const after = [mk({ id: '@0', group: 'A' }), ...before, mk({ id: '@9', group: 'B' })];
  assert.deepEqual(listItems({ rows: after, order: drag.order }).map((i) => [i.key, i.group]),
    [['@2', ''], ['@1', ''], ['g:A', 'A'], ['@3', 'A'], ['@0', 'A'], ['g:B', 'B'], ['@9', 'B']]);
  assert.deepEqual(dragEnd(drag, after), { kind: 'move', id: '@1', args: ['move-window', '-d', '-a', '-s', '@1', '-t', '@2'], group: null, created: false });
  const regrouped = [before[0], mk({ id: '@2', group: 'A' }), before[2]];
  assert.deepEqual(dragEnd(drag, regrouped), { kind: 'none' }, 'the only ungrouped row left has no neighbour');
});

test('releaseCmds sets the group before the move, reselects the current window, and unsets a focus for a new group', () => {
  const rows = [mk({ id: '@1', active: true }), mk({ id: '@2' }), mk({ id: '@3', group: 'A' })];
  const move = ['move-window', '-d', '-b', '-s', '@2', '-t', '@3'];
  assert.deepEqual(releaseCmds({ id: '@2', args: move, group: 'A;', created: false }, { rows }), [
    ['set-option', '-w', '-t', '@2', '@band_group', 'A'], move, ['move-window', '-r', '-t', '=band:'], ['select-window', '-t', '@1'],
  ]);
  assert.deepEqual(releaseCmds({ id: '@3', args: null, group: '', created: false }, { rows }),
    [['set-option', '-wu', '-t', '@3', '@band_group']]);
  assert.equal(releaseCmds({ id: '@2', args: move, group: null, created: false }, { rows, focus: 'A' }).length, 3);
  assert.deepEqual(releaseCmds({ id: '@3', args: null, group: 'group 1', created: true }, { rows, focus: 'A' }),
    [['set-option', '-w', '-t', '@3', '@band_group', 'group 1'], ['set-option', '-gu', '@band_focus']]);
  assert.deepEqual(chain([['a', 'b'], ['c'], ['d', 'e']]), ['a', 'b', ';', 'c', ';', 'd', 'e']);
});

test('renameCmds renames every member and carries the focus; an empty or same name does nothing', () => {
  const rows = [mk({ id: '@1', group: 'A' }), mk({ id: '@2' }), mk({ id: '@3', group: 'A' })];
  assert.deepEqual(renameCmds({ rows, group: 'A', text: ' web #1; ', focus: 'A' }), [
    ['set-option', '-w', '-t', '@1', '@band_group', 'web 1'], ['set-option', '-w', '-t', '@3', '@band_group', 'web 1'],
    ['set-option', '-g', '@band_focus', 'web 1'],
  ]);
  assert.equal(renameCmds({ rows, group: 'A', text: 'B', focus: 'other' }).length, 2);
  assert.deepEqual(renameCmds({ rows, group: 'A', text: 'A' }), []);
  assert.deepEqual(renameCmds({ rows, group: 'A', text: ' # ' }), []);
});

test('editInput types, deletes, caps at 24, ends on Enter or a lone ESC, and drops mouse and arrow sequences', () => {
  assert.deepEqual(editInput('ab', 'c'), { text: 'abc', end: null });
  assert.deepEqual(editInput('ab', '\x7f\x7f\x7fz'), { text: 'z', end: null });
  assert.deepEqual(editInput('ab', 'c\rd'), { text: 'abc', end: 'commit' });
  assert.deepEqual(editInput('ab', '\x1b'), { text: 'ab', end: 'cancel' });
  assert.deepEqual(editInput('ab', '\x1b[<32;5;7M\x1b[A\x1bOPc\x1b[<0;5;7m'), { text: 'abc', end: null });
  assert.deepEqual(editInput('', 'a\tb\x01c'), { text: 'abc', end: null });
  assert.equal(editInput('x'.repeat(23), 'yz').text, 'x'.repeat(23) + 'y');
});

// ---- the sidebar's width ----

test('parseWidth admits whole numbers from WIDTH_MIN to WIDTH_MAX', () => {
  assert.deepEqual(['30', '20', '60', ' 45\n', 45].map(parseWidth), [30, 20, 60, 45, 45]);
  assert.deepEqual(['', '19', '61', '30.5', 'abc', '-30', null, undefined, '1e1'].map(parseWidth), Array(9).fill(null));
  assert.deepEqual([WIDTH_DEFAULT, WIDTH_MIN, WIDTH_MAX], [30, 20, 60]);
});

const STEADY = { own: 30, option: '30', windowWidth: 150, active: true, panes: 2 };

test('widthStep: an unset option takes the saved width, else the default', () => {
  const now = { ...STEADY, option: '' };
  assert.deepEqual(widthStep(now, null, '45\n'), { set: 45, resize: 45 });
  assert.deepEqual(widthStep(now, null, null), { set: 30, resize: null });
  assert.deepEqual(widthStep(now, null, '999'), { set: 30, resize: null });
  assert.deepEqual(widthStep({ ...now, option: 'junk', own: 80 }, null, null), { set: 30, resize: 30 });
});

test('widthStep: a pane dragged by its border sets the option, clamped', () => {
  const drag = (own) => widthStep({ ...STEADY, own }, STEADY);
  assert.deepEqual(drag(30), { set: null, resize: null });
  assert.deepEqual(drag(45), { set: 45, resize: null });
  assert.deepEqual(drag(90), { set: 60, resize: 60 });
  assert.deepEqual(drag(5), { set: 20, resize: 20 });
});

test('widthStep: any other difference goes back to the option', () => {
  const back = { set: null, resize: 30 };
  const moved = { ...STEADY, own: 45 };
  assert.deepEqual(widthStep({ ...STEADY, own: 24, windowWidth: 120 }, STEADY), back, 'the terminal was resized');
  assert.deepEqual(widthStep({ ...moved, active: false }, STEADY), back, 'an inactive window is not being dragged');
  assert.deepEqual(widthStep(moved, { ...STEADY, active: false }), back, 'nor one that was inactive a tick ago (a window switch)');
  assert.deepEqual(widthStep(moved, null), back, 'a first reading has nothing to compare');
  assert.deepEqual(widthStep(moved, moved), back, 'a width that did not change was not dragged');
  assert.deepEqual(widthStep({ ...moved, panes: 3 }, STEADY), back, 'a third pane changes the layout');
  assert.deepEqual(widthStep(moved, { ...STEADY, panes: 3 }), back, 'and so does one that just closed');
  assert.deepEqual(widthStep({ ...STEADY, option: '45' }, STEADY), { set: null, resize: 45 }, 'another window changed the option');
});

test('widthStep: a terminal too narrow for the option keeps the option and leaves the session 20 columns', () => {
  const narrow = { ...STEADY, option: '60', own: 60, windowWidth: 50 };
  assert.deepEqual(widthStep(narrow, { ...STEADY, option: '60', own: 60 }), { set: null, resize: 29 });
  assert.deepEqual(widthStep({ ...narrow, own: 29 }, null), { set: null, resize: null }, 'what fits is steady');
  assert.deepEqual(widthStep({ ...narrow, own: 29 }, { ...narrow, own: 29 }), { set: null, resize: null });
  assert.deepEqual(widthStep({ ...narrow, own: 25 }, { ...narrow, own: 29 }), { set: 25, resize: null }, 'a drag there still sets it');
  assert.deepEqual(widthStep({ ...narrow, own: 60, windowWidth: 150 }, null), { set: null, resize: null }, 'wide again: back to 60');
  assert.deepEqual(widthStep({ ...narrow, own: 10, windowWidth: 12 }, null), { set: null, resize: 1 });
  assert.deepEqual(widthStep({ ...STEADY, own: 30, windowWidth: NaN }, null), { set: null, resize: null });
});

test('render and hit work at every width the sidebar can take', () => {
  const strip = (v) => v.replace(/\x1b\[[0-9;]*m/g, '');
  const rows = pick(0, 1, 2);
  for (const width of [WIDTH_MIN, 37, WIDTH_MAX]) {
    const out = render({ rows, width, height: 24, now: vectors.now }).split('\n').map(strip);
    for (const l of out) assert.equal(textWidth(l), width, `${width}: ${JSON.stringify(l)}`);
    assert.deepEqual(hit({ rows, width, height: 24, x: width - 1, y: 4, confirm: null }), { kind: 'close', id: '@1' });
    assert.deepEqual(hit({ rows, width, height: 24, x: width - 1, y: 1, confirm: null }), { kind: 'expand', id: null });
  }
  const wide = render({ rows, width: 60, height: 24, now: vectors.now }).split('\n').map(strip);
  assert.equal(wide[11], ` ◌ ${'write migration test for 0042 rollback'.padEnd(54)} ✕ `);
});

test('nameOf is the first line with text, cleaned and cut to 120', () => {
  assert.equal(nameOf('\n  \n fix\tthe  login ;\nsecond'), 'fix the login');
  assert.equal(nameOf('x'.repeat(200)).length, 120);
  assert.equal(nameOf(''), '');
  assert.equal(nameOf(undefined), '');
});

test('entryName reads a title or a typed prompt from a transcript line', () => {
  const user = (content, more = {}) => ({ type: 'user', message: { role: 'user', content }, ...more });
  assert.deepEqual(entryName({ type: 'ai-title', aiTitle: ' Fix SSO redirect ' }), { title: 'Fix SSO redirect' });
  assert.equal(entryName({ type: 'ai-title', aiTitle: '' }), null);
  assert.equal(entryName({ type: 'ai-title' }), null);
  assert.deepEqual(entryName(user('fix the redirect\nplease')), { prompt: 'fix the redirect' });
  assert.deepEqual(entryName(user([{ type: 'text', text: '<system-reminder>x</system-reminder>' }, { type: 'text', text: 'real one' }])), { prompt: 'real one' });
  assert.equal(entryName(user('<command-name>/clear</command-name>')), null);
  assert.equal(entryName(user('[Request interrupted by user]')), null);
  assert.equal(entryName(user([{ type: 'tool_result', content: 'ok' }])), null);
  assert.equal(entryName(user('hidden', { isMeta: true })), null);
  assert.equal(entryName(user('agent prompt', { isSidechain: true })), null);
  assert.equal(entryName({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }), null);
  assert.equal(entryName(null), null);
});
