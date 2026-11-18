import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseWindows, render, renderTable, layout, newLine, tableLayout, tableRows, hit, hitTable,
  needsConfirm, age, repoLabel, fit, textWidth, optionValue, parsePrs, prValue, prBadge, prCell,
} from '../sidebar-core.mjs';

const vectors = JSON.parse(fs.readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const pick = (...indexes) => indexes.map((i) => vectors.rows[i]);
const ALL = pick(0, 1, 2, 3, 4, 5);

for (const c of vectors.cases) {
  test(`vector: ${c.name}`, () => {
    const draw = c.view === 'table' ? renderTable : render;
    const out = draw({ rows: pick(...c.rows), width: c.width, height: c.height, confirm: c.confirm, now: vectors.now });
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

test('tableRows sorts by state, then waiting time for input rows', () => {
  assert.deepEqual(tableRows(ALL).map((r) => r.id), ['@1', '@2', '@3', '@6', '@4', '@5']);
  const rows = [
    { id: '@1', state: 'seen', since: 5 }, { id: '@2', state: 'input', since: 0 }, { id: '@3', state: 'done', since: 9 },
    { id: '@4', state: 'input', since: 50 }, { id: '@5', state: 'weird', since: 1 }, { id: '@6', state: 'input', since: 20 },
    { id: '@7', state: 'working', since: 99 }, { id: '@8', state: '', since: 3 }, { id: '@9', state: 'input', since: 20 },
  ];
  assert.deepEqual(tableRows(rows).map((r) => r.id), ['@6', '@9', '@4', '@2', '@5', '@7', '@8', '@3', '@1']);
  assert.equal(rows[0].id, '@1');
});

test('tableLayout', () => {
  assert.deepEqual(tableLayout({ rows: ALL, height: 12 }).map((l) => [l.row.id, l.y]), [['@1', 4], ['@2', 5], ['@3', 6], ['@6', 7], ['@4', 8], ['@5', 9]]);
  assert.deepEqual(tableLayout({ rows: ALL, height: 5 }).map((l) => [l.row.id, l.y]), [['@1', 4], ['@2', 5]]);
  assert.deepEqual(tableLayout({ rows: pick(0, 2, 3, 4, 6), height: 5 }).map((l) => [l.row.id, l.y]), [['@4', 4], ['@7', 5]]);
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
  assert.deepEqual(at(50, 7), { kind: 'select', id: '@6' });
  assert.deepEqual(at(97, 8), { kind: 'select', id: '@4' });
  assert.deepEqual(at(98, 8), { kind: 'close', id: '@4' });
  assert.deepEqual(at(100, 9), { kind: 'close', id: '@5' });
  assert.deepEqual(at(50, 10), { kind: 'none', id: null });
  assert.deepEqual(at(11, 8, '@4'), { kind: 'yes', id: '@4' });
  assert.deepEqual(at(16, 8, '@4'), { kind: 'no', id: '@4' });
  assert.deepEqual(at(99, 8, '@4'), { kind: 'none', id: null });
  assert.deepEqual(at(11, 9, '@4'), { kind: 'select', id: '@5' });
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
