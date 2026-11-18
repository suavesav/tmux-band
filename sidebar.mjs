#!/usr/bin/env node
// The band sidebar: node sidebar.mjs <tmux bin> <socket>, inside a tmux pane.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseWindows, render, renderTable, hit, hitTable, needsConfirm, dragBegin, dragMove, dragEnd, dragView, dragExpired,
  repoLabel, optionValue, prValue, SIDEBAR_WIDTH,
} from './sidebar-core.mjs';

const [TMUX_BIN, SOCK] = process.argv.slice(2);
const PANE = process.env.TMUX_PANE;
if (!TMUX_BIN || !SOCK || !PANE) {
  process.stderr.write('usage: node sidebar.mjs <tmux bin> <socket>   (inside a tmux pane)\n');
  process.exit(2);
}

const B = path.resolve(path.dirname(SOCK), '..');
const LOG = path.join(B, 'state', 'sidebar.log');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WINDOW_ID = /^@\d+$/;
const ESC = '\x1b';

const LIST_FORMAT = [
  '#{window_id}', '#{window_active}', '#{@band_state}', '#{@band_tag}', '#{@band_since}',
  '#{@band_wait}', '#{@band_model}', '#{@band_repo}', '#{@band_pr}', '#{window_name}',
].join('\t');
const OWN_FORMAT = [
  '#{window_id}', '#{pane_width}', '#{window_panes}', '#{session_attached}',
  '#{window_active}', '#{window_zoomed_flag}',
].join('\t');

function findBin(name) {
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return name;
}
const GIT_BIN = findBin('git');
const GH_BIN = process.env.BAND_GH || findBin('gh');

function log(msg) {
  try {
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${PANE} ${msg}\n`);
  } catch { /* the log is best effort */ }
}

function run(bin, args, timeout, options = {}) {
  return new Promise((resolve) => {
    try {
      execFile(bin, args, { timeout, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options }, (err, stdout) => {
        resolve(err ? null : stdout);
      });
    } catch {
      resolve(null);
    }
  });
}
const tmux = (args, options) => run(TMUX_BIN, ['-S', SOCK, ...args], 3000, options);
const line = (out) => (out ?? '').replace(/\r?\n$/, '');

let rows = [];
let confirm = null;
let zoomed = false;
let zoomEpoch = 0;
let ownWindow = null;
let ticking = false;
let failures = 0;
let lastResize = 0;
let repoTicks = 0;
let inactiveTicks = 0;
let lastRepo = null;
let repoBusy = false;
let opening = false;
// dragBegin()'s value while a row is held.
let drag = null;
let lastDrawKey = '';
let quitting = false;

const size = () => ({ width: process.stdout.columns || SIDEBAR_WIDTH, height: process.stdout.rows || 24 });

function quit() {
  if (quitting) return;
  quitting = true;
  try {
    process.stdout.write(`${ESC}[?1006l${ESC}[?1002l${ESC}[?25h${ESC}[0m`);
  } catch { /* the pane may be gone */ }
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch { /* same */ }
  process.exit(0);
}

function draw() {
  if (quitting) return;
  const { width, height } = size();
  const now = Math.floor(Date.now() / 1000);
  const lines = (zoomed ? renderTable : render)({ ...dragView(rows, drag, Date.now()), width, height, confirm, now }).split('\n');
  const key = `${zoomed}:${width}:${height}`;
  let out = '';
  if (key !== lastDrawKey) out += `${ESC}[2J`;
  lastDrawKey = key;
  lines.forEach((text, i) => { out += `${ESC}[${i + 1};1H${text}`; });
  if (lines.length < height) out += `${ESC}[${lines.length + 1};1H${ESC}[J`;
  try {
    process.stdout.write(out);
  } catch { /* the pane may be gone */ }
}

async function setZoom(on) {
  zoomEpoch++;
  zoomed = on;
  await tmux(['if-shell', '-F', '-t', PANE, `#{==:#{window_zoomed_flag},${on ? 0 : 1}}`, `resize-pane -Z -t ${PANE}`]);
  zoomEpoch++;
}

const focusSession = (w) => (w ? tmux(['select-pane', '-t', `${w}.1`]) : null);

async function noteRepo() {
  if (repoBusy || !ownWindow) return;
  repoBusy = true;
  try {
    const cwd = line(await tmux(['display-message', '-p', '-t', `${ownWindow}.1`, '#{pane_current_path}']));
    if (!cwd) return;
    const rev = await run(GIT_BIN, ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--abbrev-ref', 'HEAD'], 2000);
    const label = optionValue(repoLabel(rev, cwd), 60);
    if (label === lastRepo) return;
    if ((await tmux(['set-option', '-w', '-t', ownWindow, '@band_repo', label])) !== null) lastRepo = label;
  } finally {
    repoBusy = false;
  }
}

// ---- PR poller ----

const PR_URL = /(?<=^|[\s([])https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
const CI_FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const CI_PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const pr = {
  path: '', offset: 0, urls: [], cache: new Map(), polledPath: null, lastPoll: 0,
  pending: false, prevState: undefined, running: false, lastWritten: null, logged: false,
};

function transcriptTexts(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  const texts = [];
  for (const item of content) {
    if (entry.type === 'assistant' && item?.type === 'text' && typeof item.text === 'string') texts.push(item.text);
    if (entry.type === 'user' && item?.type === 'tool_result') {
      if (typeof item.content === 'string') texts.push(item.content);
      else if (Array.isArray(item.content)) {
        for (const part of item.content) if (part?.type === 'text' && typeof part.text === 'string') texts.push(part.text);
      }
    }
  }
  return texts;
}

function readTranscript(file) {
  if (file !== pr.path) {
    pr.path = file;
    pr.offset = 0;
    pr.urls = [];
  }
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const total = fs.fstatSync(fd).size;
    if (total < pr.offset) {
      pr.offset = 0;
      pr.urls = [];
    }
    if (total === pr.offset) return;
    // One pass reads at most 8 MB; the next poll continues from the offset.
    const buf = Buffer.alloc(Math.min(total - pr.offset, 8 * 1024 * 1024));
    const got = fs.readSync(fd, buf, 0, buf.length, pr.offset);
    const end = buf.lastIndexOf(0x0a, got - 1);
    if (end < 0) {
      if (got === buf.length) pr.offset += got;
      return;
    }
    pr.offset += end + 1;
    for (const text of buf.toString('utf8', 0, end).split('\n')) {
      let entry;
      try {
        entry = JSON.parse(text);
      } catch {
        continue;
      }
      for (const t of transcriptTexts(entry)) {
        for (const url of t.match(PR_URL) ?? []) {
          if (pr.urls.includes(url)) continue;
          pr.urls.push(url);
          if (pr.urls.length > 10) pr.urls.shift();
        }
      }
    }
  } catch { /* no transcript yet */ } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function ciOf(rollup) {
  const items = Array.isArray(rollup) ? rollup : [];
  const results = items.map((i) => String(i?.conclusion || i?.state || '').toUpperCase());
  if (results.some((r) => CI_FAILED.has(r))) return 'f';
  if (results.some((r) => !CI_PASSED.has(r))) return 'r';
  return results.length ? 'p' : '';
}

async function fetchPr(url) {
  const out = await run(GH_BIN, ['pr', 'view', url, '--json', 'state,statusCheckRollup'], 10000);
  if (out === null) return null;
  try {
    const data = JSON.parse(out);
    const state = { OPEN: 'o', MERGED: 'm', CLOSED: 'c' }[data.state];
    return state ? { state, ci: ciOf(data.statusCheckRollup), at: Date.now() } : null;
  } catch {
    return null;
  }
}

async function poll(file) {
  readTranscript(file);
  const mine = pr.urls.slice(-3);
  for (const url of mine) {
    const cached = pr.cache.get(url);
    if (cached && (cached.state === 'm' || Date.now() - cached.at < 180000)) continue;
    const fresh = await fetchPr(url);
    if (!fresh) {
      if (!pr.logged) log(`gh pr view failed for ${url}`);
      pr.logged = true;
      break;
    }
    pr.cache.set(url, fresh);
  }
  const prs = [];
  for (const url of mine) {
    const cached = pr.cache.get(url);
    if (!cached || !(cached.state === 'm' || Date.now() - cached.at < 900000)) continue;
    prs.push({ number: Number(url.slice(url.lastIndexOf('/') + 1)), state: cached.state, ci: cached.ci });
  }
  const value = optionValue(prValue(prs), 60).replace(/#/g, '');
  if (value === pr.lastWritten) return;
  if ((await tmux(['set-option', '-w', '-t', ownWindow, '@band_pr', value])) !== null) pr.lastWritten = value;
}

async function kickPrs() {
  if (pr.running || !ownWindow) return;
  pr.running = true;
  try {
    const file = line(await tmux(['show-options', '-wqv', '-t', ownWindow, '@band_transcript']));
    if (!file) return;
    const since = Date.now() - pr.lastPoll;
    if (!(pr.polledPath !== file || since >= 180000 || (pr.pending && since >= 30000))) return;
    pr.polledPath = file;
    pr.lastPoll = Date.now();
    pr.pending = false;
    await poll(file);
  } catch (e) {
    log(`pr poll: ${e?.stack || e}`);
  } finally {
    pr.running = false;
  }
}

// ---- tick ----

async function tickBody() {
  const epoch = zoomEpoch;
  const own = line(await tmux(['display-message', '-p', '-t', PANE, OWN_FORMAT])).split('\t');
  // tmux 3.8 answers a gone pane with an empty line and status 0.
  if (!WINDOW_ID.test(own[0])) {
    if (++failures >= 3) quit();
    return;
  }
  failures = 0;
  const [windowId, paneWidth, panes, attached, activeFlag, zoomFlag] = own;
  ownWindow = windowId;
  if (epoch === zoomEpoch) zoomed = zoomFlag === '1';
  if (panes === '1') return quit();
  const active = activeFlag === '1';
  if (zoomed && !active) await setZoom(false);
  if (!zoomed && Number(paneWidth) !== SIDEBAR_WIDTH && Date.now() - lastResize >= 500) {
    lastResize = Date.now();
    await tmux(['resize-pane', '-t', PANE, '-x', String(SIDEBAR_WIDTH)]);
  }
  if (repoTicks++ % 5 === 0) noteRepo().catch((e) => log(`repo: ${e?.stack || e}`));
  kickPrs();
  if (active) inactiveTicks = 0;
  else if (inactiveTicks++ % 5 !== 0) return;
  const listed = await tmux(['list-windows', '-t', '=band', '-F', LIST_FORMAT]);
  if (listed !== null) rows = parseWindows(listed);
  const mine = rows.find((r) => r.id === ownWindow);
  if (listed !== null && mine) {
    if (mine.state === 'done' && pr.prevState !== undefined && pr.prevState !== 'done') pr.pending = true;
    pr.prevState = mine.state;
  }
  if (mine && mine.state === 'done' && active && Number(attached) > 0 && !zoomed) {
    await tmux(['set-option', '-w', '-t', ownWindow, '@band_state', 'seen']);
    mine.state = 'seen';
  }
  if (confirm !== null && !rows.some((r) => r.id === confirm)) confirm = null;
  if (drag && (dragExpired(drag, Date.now()) || !rows.some((r) => r.id === drag.id))) drag = null;
  draw();
}

async function tick() {
  if (ticking || quitting) return;
  ticking = true;
  try {
    await tickBody();
  } catch (e) {
    log(`tick: ${e?.stack || e}`);
  } finally {
    ticking = false;
  }
}

// ---- input ----

async function closeWindow(id) {
  const session = line(await tmux(['show-options', '-wqv', '-t', id, '@band_session']));
  if (UUID.test(session)) {
    try {
      fs.unlinkSync(path.join(B, 'state', 'sessions', session));
    } catch { /* no record */ }
  }
  await tmux(['kill-window', '-t', id]);
}

async function newWindow() {
  opening = true;
  try {
    const dir = ownWindow ? line(await tmux(['display-message', '-p', '-t', `${ownWindow}.1`, '#{pane_current_path}'])) : '';
    const odd = dir.includes('#') || dir.endsWith(';');
    const args = ['new-window', '-t', '=band:', '-n', 'terminal'];
    if (dir && !odd) args.push('-c', dir);
    args.push('-P', '-F', '#{window_id} #{pane_id}');
    // Without -c the window opens in the tmux client's cwd.
    const made = await tmux(args, odd && fs.existsSync(dir) ? { cwd: dir } : {});
    const m = /^(@\d+) (%\d+)$/.exec(line(made));
    if (!m) return;
    await tmux(['set-option', '-w', '-t', m[1], '@band_since', String(Math.floor(Date.now() / 1000))]);
    const split = await tmux(['split-window', '-d', '-hb', '-l', String(SIDEBAR_WIDTH), '-t', m[2], process.execPath, process.argv[1], TMUX_BIN, SOCK]);
    if (split === null) await tmux(['kill-window', '-t', m[1]]);
  } finally {
    opening = false;
  }
}

async function click(x, y) {
  const { width, height } = size();
  const result = (zoomed ? hitTable : hit)({ x, y, rows, width, height, confirm });
  switch (result.kind) {
    case 'expand':
      confirm = null;
      await setZoom(true);
      break;
    case 'collapse':
      confirm = null;
      await setZoom(false);
      await focusSession(ownWindow);
      break;
    case 'close': {
      const row = rows.find((r) => r.id === result.id);
      if (row && needsConfirm(row.state)) {
        confirm = result.id;
      } else {
        confirm = null;
        await closeWindow(result.id);
      }
      break;
    }
    case 'yes':
      confirm = null;
      await closeWindow(result.id);
      break;
    case 'no':
      confirm = null;
      break;
    case 'new':
      if (opening) return;
      confirm = null;
      await newWindow();
      break;
    default:
  }
  if (!zoomed && !['collapse', 'new'].includes(result.kind)) await focusSession(ownWindow);
  await tick();
  draw();
}

// press() takes every `select` hit, so click() never sees one.
async function select(id) {
  confirm = null;
  await setZoom(false);
  await tmux(['select-window', '-t', id]);
  await focusSession(id);
  await tick();
  draw();
}

function press(x, y) {
  // A press over a drag whose release never came lands on a preview that is
  // not the real order: it only puts the list back.
  if (drag) {
    drag = null;
    draw();
    return Promise.resolve();
  }
  const { width, height } = size();
  const result = (zoomed ? hitTable : hit)({ x, y, rows, width, height, confirm });
  if (result.kind !== 'select') return click(x, y);
  drag = dragBegin({ id: result.id, y, rows, height, zoomed, now: Date.now() });
  return Promise.resolve();
}

function dragTo(y) {
  if (!drag) return;
  drag = dragMove(drag, { y, rows, height: size().height, zoomed, now: Date.now() });
  draw();
}

async function release() {
  const held = drag;
  drag = null;
  const end = dragEnd(held, rows);
  if (end.kind === 'select') return select(end.id);
  if (end.kind === 'move') {
    confirm = null;
    // The current window is an index, so a move can change which window it is.
    const active = rows.find((r) => r.active)?.id;
    await tmux([...end.args, ';', 'move-window', '-r', '-t', '=band:', ...(active ? [';', 'select-window', '-t', active] : [])]);
    if (!zoomed) await focusSession(ownWindow);
    await tick();
  }
  draw();
}

async function keypress() {
  drag = null;
  zoomEpoch++;
  zoomed = false;
  await focusSession(ownWindow);
  await tick();
  draw();
}

function onInput(chunk) {
  const mouse = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let any = false;
  for (const m of String(chunk).matchAll(mouse)) {
    any = true;
    const fail = (e) => log(`mouse: ${e?.stack || e}`);
    if (m[4] === 'M' && m[1] === '0') press(Number(m[2]), Number(m[3])).catch(fail);
    else if (m[4] === 'M' && m[1] === '32') dragTo(Number(m[3]));
    else if (m[4] === 'm' && m[1] === '0') release().catch(fail);
  }
  if (!any) keypress().catch((e) => log(`key: ${e?.stack || e}`));
}

// ---- start ----

process.on('uncaughtException', (e) => log(`uncaught: ${e?.stack || e}`));
process.on('unhandledRejection', (e) => log(`unhandled: ${e?.stack || e}`));
for (const signal of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.on(signal, quit);
process.stdout.on('error', quit);

process.stdout.write(`${ESC}[?1002h${ESC}[?1006h${ESC}[?25l`);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', onInput);
process.stdin.on('end', quit);
process.stdin.on('error', quit);
process.stdin.resume();
process.stdout.on('resize', draw);
setInterval(tick, 1000);
tick();
