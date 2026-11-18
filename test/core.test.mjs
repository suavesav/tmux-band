import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseWindows, render, renderTable, layout, newLine, tableLayout, moveId, moveArgs, dragBegin, dragMove, dragEnd, dragView, dragRows, DRAG_STALE_MS, hit, hitTable,
  needsConfirm, age, repoLabel, fit, textWidth, optionValue, parsePrs, prValue, prBadge, prCell,
} from '../sidebar-core.mjs';

const vectors = JSON.parse(fs.readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const pick = (...indexes) => indexes.map((i) => vectors.rows[i]);
const ALL = pick(0, 1, 2, 3, 4, 5);

for (const c of vectors.cases) {
  test(`vector: ${c.name}`, () => {
    const draw = c.view === 'table' ? renderTable : render;
    const out = draw({ rows: pick(...c.rows), width: c.width, height: c.height, confirm: c.confirm, now: vectors.now, dragging: c.dragging ?? null });
    assert.deepEqual(out.split('\n'), c.raw);
    assert.deepEqual(strip(out).split('\n'), c.text);
  });
}

test('render and renderTable default confirm and now', () => {
  const out = render({ rows: pick(3), width: 30, height: 8 });
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

test('layout keeps two lines for the new-session line and scrolls to the active row', () => {
  assert.deepEqual(layout({ rows: ALL, height: 24 }).map((l) => [l.row.id, l.top]), [['@1', 3], ['@2', 7], ['@3', 11], ['@4', 15], ['@5', 19]]);
  assert.deepEqual(layout({ rows: ALL, height: 26 }).map((l) => l.row.id), ['@1', '@2', '@3', '@4', '@5']);
  assert.deepEqual(layout({ rows: ALL, height: 28 }).map((l) => l.row.id), ['@1', '@2', '@3', '@4', '@5', '@6']);
  assert.deepEqual(layout({ rows: pick(0, 2, 3, 4, 6), height: 12 }).map((l) => [l.row.id, l.top]), [['@5', 3], ['@7', 7]]);
  assert.deepEqual(layout({ rows: pick(0, 6, 2, 3, 4), height: 12 }).map((l) => l.row.id), ['@1', '@7']);
  assert.deepEqual(layout({ rows: pick(0, 2, 3), height: 13 }).map((l) => l.row.id), ['@1', '@3']);
  assert.deepEqual(layout({ rows: pick(0, 2, 3), height: 12 }).map((l) => l.row.id), ['@1', '@3']);
  assert.deepEqual(layout({ rows: ALL, height: 7 }), []);
  assert.deepEqual(layout({ rows: ALL, height: 0 }), []);
  assert.deepEqual(layout({ rows: [], height: 24 }), []);
});

test('newLine is the line the new-session text is drawn on', () => {
  assert.equal(newLine({ rows: [], height: 6 }), 4);
  assert.equal(newLine({ rows: ALL, height: 24 }), 24);
  assert.equal(newLine({ rows: ALL, height: 12 }), 12);
  assert.equal(newLine({ rows: pick(0, 2, 3), height: 13 }), 12);
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

const mk = (over) => ({ id: '@0', active: false, state: '', tag: '', since: 0, wait: '', model: '', repo: '', pr: '', name: '', ...over });
const SIX = Array.from({ length: 6 }, (_, i) => mk({ id: `@${i + 1}`, active: i === 1, name: `w${i + 1}` }));
const ids = (rows) => rows.map((r) => r.id);
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
  assert.deepEqual(dragEnd(down, SIX), { kind: 'move', args: ['move-window', '-d', '-b', '-s', '@1', '-t', '@4'] });
  const up = dragged('@6', 9, [[4, 300]], { zoomed: true });
  assert.deepEqual(up.order, ['@6', '@1', '@2', '@3', '@4', '@5']);
  const last = dragged('@1', 4, [[9, 300]], { zoomed: true });
  assert.deepEqual(dragEnd(last, SIX), { kind: 'move', args: ['move-window', '-d', '-a', '-s', '@1', '-t', '@6'] });
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
  assert.deepEqual(ids(dragRows(fewer, drag)), ['@2', '@1', '@4', '@5', '@6']);
  assert.deepEqual(ids(dragRows(more, drag)), ['@2', '@3', '@1', '@4', '@5', '@6', '@9']);
  assert.deepEqual(dragEnd(drag, fewer), { kind: 'move', args: ['move-window', '-d', '-b', '-s', '@1', '-t', '@4'] });
  assert.deepEqual(dragEnd(drag, SIX.filter((r) => r.id !== '@1')), { kind: 'none' });
  assert.deepEqual(dragEnd(null, SIX), { kind: 'none' });
});

test('the view holds still during a drag and scrolls one row past either end', () => {
  const many = Array.from({ length: 10 }, (_, i) => mk({ id: `@${i}`, active: i === 6, name: `w${i}` }));
  const opts = { rows: many, height: 24, zoomed: false };
  assert.deepEqual(layout({ rows: many, height: 24 }).map((s) => s.row.id), ['@2', '@3', '@4', '@5', '@6']);
  let drag = dragBegin({ id: '@6', y: 20, now: 0, ...opts });
  assert.equal(drag.start, 2);
  drag = dragMove(drag, { y: 8, now: 300, ...opts });
  const view = dragView(many, drag, 300);
  assert.deepEqual(layout({ rows: view.rows, height: 24, start: view.start }).map((s) => s.row.id), ['@2', '@6', '@3', '@4', '@5'],
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
  down = dragMove(down, { y: 24, now: 300, ...opts });
  assert.equal(down.start, 3);
  assert.equal(down.order.indexOf('@2'), 7);
});

test('a drag with no mouse event for DRAG_STALE_MS is drawn as not held, and its release still acts', () => {
  const drag = dragged('@1', 4, [[12, 300]]);
  assert.equal(dragView(SIX, drag, 300 + DRAG_STALE_MS).dragging, '@1');
  const stale = dragView(SIX, drag, 301 + DRAG_STALE_MS);
  assert.deepEqual([stale.dragging, stale.start, stale.rows], [null, null, SIX]);
  assert.equal(dragEnd(drag, SIX).kind, 'move');
  assert.equal(dragView(SIX, dragMove(drag, { y: 12, rows: SIX, height: 40, now: 60_000 }), 60_000).dragging, '@1');
  assert.deepEqual(dragView(SIX, null, 0), { rows: SIX, dragging: null, start: null });
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
  const at = (x, y, extra = {}) => hit({ x, y, rows: ALL, width: 30, height: 24, confirm: null, ...extra });
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
  const at = (x, y, rows = ALL, height = 24) => hit({ x, y, rows, width: 30, height, confirm: null });
  assert.deepEqual(at(1, 24), { kind: 'new', id: null });
  assert.deepEqual(at(14, 24), { kind: 'new', id: null });
  assert.deepEqual(at(15, 24), { kind: 'none', id: null });
  assert.deepEqual(at(3, 4, [], 6), { kind: 'new', id: null });
  assert.deepEqual(at(3, 3, [], 6), { kind: 'none', id: null });
  assert.deepEqual(at(3, 12, ALL, 12), { kind: 'new', id: null });
  assert.deepEqual(at(3, 11, ALL, 12), { kind: 'none', id: null });
  assert.deepEqual(at(3, 12, pick(0, 2, 3), 13), { kind: 'new', id: null });
  assert.deepEqual(at(3, 13, pick(0, 2, 3), 13), { kind: 'none', id: null });
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
  assert.deepEqual(hit({ x: 2, y: 4, rows, width: 30, height: 12, confirm: null }), { kind: 'select', id: '@5' });
  assert.deepEqual(hit({ x: 29, y: 8, rows, width: 30, height: 12, confirm: null }), { kind: 'close', id: '@7' });
  assert.deepEqual(hit({ x: 4, y: 1, rows: pick(0), width: 6, height: 10, confirm: null }), { kind: 'expand', id: null });
  assert.deepEqual(hit({ x: 3, y: 1, rows: pick(0), width: 6, height: 10, confirm: null }), { kind: 'none', id: null });
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
    '@1\t1\tinput\twork\t1763298140\tplan approval\topus · plan\tetl · main\t412:o:f\tplan the importer',
    '@2\t0\t\t\t\t\t\t\t\tname\twith\ttabs',
    'not a window\t1',
    '@x\t1\tdone\t\t5\t\t\t\t\tbad id',
    '@3\t0\tdone\tt\u0007ag\t12x\t\t\t\t\tbe\u001bll',
    '',
  ].join('\n');
  assert.deepEqual(parseWindows(out), [
    { id: '@1', active: true, state: 'input', tag: 'work', since: 1763298140, wait: 'plan approval', model: 'opus · plan', repo: 'etl · main', pr: '412:o:f', name: 'plan the importer' },
    { id: '@2', active: false, state: '', tag: '', since: 0, wait: '', model: '', repo: '', pr: '', name: 'name with tabs' },
    { id: '@3', active: false, state: 'done', tag: 'tag', since: 0, wait: '', model: '', repo: '', pr: '', name: 'bell' },
  ]);
  assert.deepEqual(parseWindows(''), []);
});
