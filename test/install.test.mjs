import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionEnd'];

// Every run gets its own HOME and BAND_HOME, so nothing outside the temp dir is read or written.
function sandbox(t, name = 'band') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'band-install-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const B = path.join(root, name);
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const run = (args = [], env = {}, script = path.join(SRC, 'install.sh')) =>
    spawnSync('/bin/sh', [script, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, BAND_HOME: B, ...env },
    });
  const settings = (dir = '.claude') => path.join(home, dir, 'settings.json');
  const read = (dir) => JSON.parse(fs.readFileSync(settings(dir), 'utf8'));
  const backups = (dir = '.claude') => fs.readdirSync(path.join(home, dir)).filter((f) => f.startsWith('settings.json.bak-'));
  return { root, home, B, run, settings, read, backups };
}

const quote = (v) => (/^[A-Za-z0-9_./-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`);
// The command hooks.mjs writes: guarded so a deleted install folder is a no-op.
const hook = (B, script, arg) => {
  const file = quote(`${B}/bin/${script}`);
  return `[ ! -x ${file} ] || ${file} ${arg}`;
};
const entry = (B, script, arg) => ({ type: 'command', command: hook(B, script, arg), timeout: 5 });
const commands = (settings, event) => (settings.hooks?.[event] ?? []).flatMap((e) => e.hooks.map((h) => h.command));

test('install copies the files, writes hooks.json and links bin/', (t) => {
  const s = sandbox(t);
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['band-new', 'band-attach', 'band-restore', 'band-state.sh', 'band-record.sh']) {
    assert.ok(fs.statSync(path.join(s.B, 'bin', f)).mode & 0o100, `${f} is executable`);
  }
  for (const f of ['band', 'band-new', 'band-attach', 'band-restore']) {
    assert.equal(fs.readlinkSync(path.join(s.home, '.local/bin', f)), path.join(s.B, 'bin', f));
  }
  for (const f of ['band-state.sh', 'band-record.sh']) {
    assert.ok(!fs.existsSync(path.join(s.home, '.local/bin', f)), `${f} is not linked`);
  }
  for (const f of fs.readdirSync(path.join(SRC, 'bin'))) assert.ok(fs.existsSync(path.join(s.B, 'bin', f)), `bin/${f} copied`);
  for (const f of ['sidebar.mjs', 'sidebar-core.mjs', 'hooks.mjs', 'tmux.conf', 'install.sh', 'hooks.json', 'state']) {
    assert.ok(fs.existsSync(path.join(s.B, f)), f);
  }
  assert.equal(fs.existsSync(path.join(s.B, 'VERSION')), fs.existsSync(path.join(SRC, 'VERSION')));
  assert.equal(fs.existsSync(path.join(s.home, '.local/bin/band')), fs.existsSync(path.join(SRC, 'bin/band')));
  assert.equal(fs.statSync(s.B).mode & 0o777, 0o700);

  const block = JSON.parse(fs.readFileSync(path.join(s.B, 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(block), ['hooks']);
  assert.deepEqual(Object.keys(block.hooks), EVENTS);
  assert.deepEqual(block.hooks.SessionStart, [{ hooks: [entry(s.B, 'band-record.sh', 'start')] }]);
  assert.deepEqual(block.hooks.PermissionRequest, [{ matcher: '*', hooks: [entry(s.B, 'band-state.sh', 'input')] }]);
  assert.deepEqual(block.hooks.PostToolUse, [{ matcher: '*', hooks: [entry(s.B, 'band-state.sh', 'working')] }]);
  assert.deepEqual(commands(block, 'UserPromptSubmit'), [hook(s.B, 'band-state.sh', 'working')]);
  assert.deepEqual(commands(block, 'Stop'), [hook(s.B, 'band-state.sh', 'done')]);
  assert.deepEqual(commands(block, 'SessionEnd'), [hook(s.B, 'band-state.sh', 'clear'), hook(s.B, 'band-record.sh', 'end')]);
});

test('install creates settings.json as {} and merges the hooks block into it', (t) => {
  const s = sandbox(t);
  assert.equal(s.run().status, 0);
  assert.deepEqual(s.read(), JSON.parse(fs.readFileSync(path.join(s.B, 'hooks.json'), 'utf8')));
  assert.equal(s.backups().length, 1);
  assert.equal(fs.readFileSync(path.join(s.home, '.claude', s.backups()[0]), 'utf8'), '{}\n');
});

test('install does not create ~/.claude or a settings file in a ~/.claude-* dir without one', (t) => {
  const s = sandbox(t);
  fs.rmSync(path.join(s.home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(s.home, '.claude-empty'));
  assert.equal(s.run().status, 0);
  assert.equal(fs.existsSync(path.join(s.home, '.claude')), false);
  assert.deepEqual(fs.readdirSync(path.join(s.home, '.claude-empty')), []);
});

test('merge keeps other hooks and settings, replaces an older band hook, and backs up first', (t) => {
  const s = sandbox(t);
  const before = {
    model: 'opus',
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
      SessionEnd: [{ hooks: [{ type: 'command', command: `${s.B}/bin/band-state.sh clear` }] }],
      Notification: [{ matcher: 'x', hooks: [{ type: 'command', command: 'beep' }] }],
    },
  };
  const text = JSON.stringify(before);
  fs.writeFileSync(s.settings(), text);
  fs.mkdirSync(path.join(s.home, '.claude-work'));
  fs.writeFileSync(s.settings('.claude-work'), '{"theme":"dark"}');
  assert.equal(s.run().status, 0);

  const after = s.read();
  assert.equal(after.model, 'opus');
  assert.deepEqual(after.hooks.Notification, before.hooks.Notification);
  assert.deepEqual(commands(after, 'Stop'), ['say done', hook(s.B, 'band-state.sh', 'done')]);
  assert.deepEqual(commands(after, 'SessionEnd'), [hook(s.B, 'band-state.sh', 'clear'), hook(s.B, 'band-record.sh', 'end')]);
  assert.equal(after.hooks.PermissionRequest[0].matcher, '*');
  assert.equal(s.backups().length, 1);
  assert.match(s.backups()[0], /^settings\.json\.bak-\d{9,}$/);
  assert.equal(fs.readFileSync(path.join(s.home, '.claude', s.backups()[0]), 'utf8'), text);

  const work = s.read('.claude-work');
  assert.equal(work.theme, 'dark');
  assert.deepEqual(Object.keys(work.hooks), EVENTS);
  assert.equal(s.backups('.claude-work').length, 1);
});

test('a second install changes nothing and writes no backup', (t) => {
  const s = sandbox(t);
  assert.equal(s.run().status, 0);
  const text = fs.readFileSync(s.settings(), 'utf8');
  const backups = s.backups();
  fs.writeFileSync(path.join(s.B, 'state/conf-sourced'), '');
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(s.settings(), 'utf8'), text);
  assert.deepEqual(s.backups(), backups);
  for (const event of EVENTS) assert.equal(new Set(commands(s.read(), event)).size, commands(s.read(), event).length);
  assert.equal(fs.existsSync(path.join(s.B, 'state/conf-sourced')), false);
});

test('a settings file that is not valid JSON is left alone and the installer exits 1', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.settings(), '{ "hooks": ');
  fs.mkdirSync(path.join(s.home, '.claude-work'));
  fs.writeFileSync(s.settings('.claude-work'), '{}');
  const r = s.run();
  assert.equal(r.status, 1);
  assert.equal(fs.readFileSync(s.settings(), 'utf8'), '{ "hooks": ');
  assert.deepEqual(s.backups(), []);
  assert.deepEqual(Object.keys(s.read('.claude-work').hooks), EVENTS);
});

test('BAND_NO_LINK and BAND_NO_SETTINGS', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.settings(), '{"a":1}');
  assert.equal(s.run([], { BAND_NO_LINK: '1', BAND_NO_SETTINGS: '1' }).status, 0);
  assert.equal(fs.existsSync(path.join(s.home, '.local')), false);
  assert.equal(fs.readFileSync(s.settings(), 'utf8'), '{"a":1}');
  assert.ok(fs.existsSync(path.join(s.B, 'hooks.json')));
});

test('a path with a space is shell-quoted in hook commands', (t) => {
  const s = sandbox(t, "band home's");
  assert.equal(s.run().status, 0);
  const quoted = `'${s.B.replace(/'/g, `'\\''`)}/bin/band-state.sh'`;
  assert.deepEqual(commands(s.read(), 'Stop'), [`[ ! -x ${quoted} ] || ${quoted} done`]);
  const sh = spawnSync('/bin/sh', ['-c', `printf %s ${quoted}`], { encoding: 'utf8' });
  assert.equal(sh.stdout, `${s.B}/bin/band-state.sh`);
  assert.equal(s.run(['--uninstall']).status, 0);
  assert.deepEqual(s.read(), {});
});

test('--uninstall removes only band hooks and band links, and leaves B', (t) => {
  const s = sandbox(t);
  const own = {
    model: 'opus',
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
      SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }, { type: 'command', command: `'${s.B}/bin/band-record.sh' end` }] }],
    },
  };
  fs.writeFileSync(s.settings(), JSON.stringify(own));
  fs.mkdirSync(path.join(s.home, '.claude-work'));
  fs.writeFileSync(s.settings('.claude-work'), '{}');
  assert.equal(s.run().status, 0);
  const links = path.join(s.home, '.local/bin');
  fs.symlinkSync('/bin/ls', path.join(links, 'other-link'));
  fs.writeFileSync(path.join(links, 'plain-file'), 'x');

  // The installed copy runs without the source tree.
  const r = s.run(['--uninstall'], {}, path.join(s.B, 'install.sh'));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(s.read(), {
    model: 'opus',
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
      SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }],
    },
  });
  assert.deepEqual(s.read('.claude-work'), {});
  assert.deepEqual(fs.readdirSync(links).sort(), ['other-link', 'plain-file']);
  assert.ok(fs.existsSync(path.join(s.B, 'bin/band-new')));
  assert.ok(fs.existsSync(path.join(s.B, 'hooks.json')));
});

test('--uninstall honours the BAND_NO_* flags and exits 1 on invalid JSON', (t) => {
  const s = sandbox(t);
  assert.equal(s.run().status, 0);
  const text = fs.readFileSync(s.settings(), 'utf8');
  assert.equal(s.run(['--uninstall'], { BAND_NO_LINK: '1', BAND_NO_SETTINGS: '1' }).status, 0);
  assert.equal(fs.readFileSync(s.settings(), 'utf8'), text);
  assert.ok(fs.lstatSync(path.join(s.home, '.local/bin/band-new')).isSymbolicLink());
  fs.writeFileSync(s.settings(), 'nope');
  assert.equal(s.run(['--uninstall']).status, 1);
  assert.equal(fs.readFileSync(s.settings(), 'utf8'), 'nope');
  assert.deepEqual(fs.readdirSync(path.join(s.home, '.local/bin')), []);
});

test('hooks from another install folder are replaced, not doubled', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.settings(), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '/old/place/bin/band-state.sh done' }] }] } }));
  assert.equal(s.run().status, 0);
  assert.deepEqual(commands(s.read(), 'Stop'), [hook(s.B, 'band-state.sh', 'done')]);
});

test('an empty settings file is treated as {} and a symlinked one stays a symlink', (t) => {
  const s = sandbox(t);
  const real = path.join(s.root, 'dotfiles-settings.json');
  fs.writeFileSync(real, '');
  fs.symlinkSync(real, s.settings());
  assert.equal(s.run().status, 0);
  assert.ok(fs.lstatSync(s.settings()).isSymbolicLink());
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(real, 'utf8')).hooks), EVENTS);
});

test('--uninstall takes the hooks out after the install folder was deleted', (t) => {
  const s = sandbox(t);
  assert.equal(s.run().status, 0);
  fs.rmSync(s.B, { recursive: true });
  const r = s.run(['--uninstall']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(s.read(), {});
});

test('a hook command is a no-op once its script is gone', (t) => {
  const s = sandbox(t);
  assert.equal(s.run().status, 0);
  const command = commands(s.read(), 'Stop')[0];
  fs.rmSync(s.B, { recursive: true });
  const r = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', input: '{}' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, '');
});

test('with no Claude settings folder the installer says no hooks were added', (t) => {
  const s = sandbox(t);
  fs.rmSync(path.join(s.home, '.claude'), { recursive: true });
  const r = s.run();
  assert.equal(r.status, 0);
  assert.match(r.stderr, /no hooks were added/);
});
