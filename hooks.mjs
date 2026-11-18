#!/usr/bin/env node
// usage: node hooks.mjs write  <B>                  write <B>/hooks.json
//        node hooks.mjs merge  <B> <settings.json>  add the band hooks to a settings file
//        node hooks.mjs remove <B> <settings.json>  remove every band hook, from any install folder
// Exit 1 when the settings file is not valid JSON (it is left alone), 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shellQuote = (s) => (/^[A-Za-z0-9_./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

// The guard keeps a deleted install folder from failing every hook event.
export function hooksBlock(B) {
  const cmd = (script, arg) => {
    const file = shellQuote(path.join(B, 'bin', script));
    return { type: 'command', command: `[ ! -x ${file} ] || ${file} ${arg}`, timeout: 5 };
  };
  return {
    hooks: {
      SessionStart: [{ hooks: [cmd('band-record.sh', 'start')] }],
      UserPromptSubmit: [{ hooks: [cmd('band-state.sh', 'working')] }],
      PermissionRequest: [{ matcher: '*', hooks: [cmd('band-state.sh', 'input')] }],
      PostToolUse: [{ matcher: '*', hooks: [cmd('band-state.sh', 'working')] }],
      Stop: [{ hooks: [cmd('band-state.sh', 'done')] }],
      SessionEnd: [{ hooks: [cmd('band-state.sh', 'clear'), cmd('band-record.sh', 'end')] }],
    },
  };
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// A band hook from any install folder, in any quoting.
const OURS = /\/bin\/band-(state|record)\.sh\b/;
const ours = (h) => isObject(h) && typeof h.command === 'string' && OURS.test(h.command);

function checkShape(settings) {
  if (!isObject(settings)) throw new Error('settings is not a JSON object');
  if (settings.hooks === undefined) return;
  if (!isObject(settings.hooks)) throw new Error('"hooks" is not an object');
  for (const [event, list] of Object.entries(settings.hooks)) {
    if (!Array.isArray(list)) throw new Error(`"hooks.${event}" is not an array`);
  }
}

// Removes every band hook, then drops the entries, events and `hooks` object left empty.
export function removeHooks(settings) {
  checkShape(settings);
  if (!settings.hooks) return false;
  let changed = false;
  for (const [event, list] of Object.entries(settings.hooks)) {
    let touched = false;
    const kept = list.filter((entry) => {
      if (!isObject(entry) || !Array.isArray(entry.hooks)) return true;
      const rest = entry.hooks.filter((h) => !ours(h));
      if (rest.length === entry.hooks.length) return true;
      touched = true;
      entry.hooks = rest;
      return rest.length > 0;
    });
    if (!touched) continue;
    changed = true;
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (changed && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return changed;
}

// Replaces whatever band hooks are there (an older version, another folder)
// with `block`. Returns true when the settings changed.
export function mergeHooks(settings, block) {
  checkShape(settings);
  const before = JSON.stringify(settings);
  removeHooks(settings);
  settings.hooks ??= {};
  for (const [event, wanted] of Object.entries(block.hooks)) {
    (settings.hooks[event] ??= []).push(...structuredClone(wanted));
  }
  return JSON.stringify(settings) !== before;
}

// 0 unchanged, 3 changed, 1 left alone.
function edit(file, change, done) {
  let target;
  let text;
  try {
    target = fs.realpathSync(file);
    text = fs.readFileSync(target, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return 0;
    console.error(`band: ${file} could not be read, left alone (${e.message})`);
    return 1;
  }
  let settings;
  try {
    settings = text.trim() === '' ? {} : JSON.parse(text);
  } catch (e) {
    console.error(`band: ${file} is not valid JSON, left alone (${e.message})`);
    return 1;
  }
  let changed;
  try {
    changed = change(settings);
  } catch (e) {
    console.error(`band: ${file} left alone: ${e.message}`);
    return 1;
  }
  if (!changed) return 0;
  const tmp = `${target}.band-tmp-${process.pid}`;
  try {
    const backup = `${target}.bak-${Math.floor(Date.now() / 1000)}`;
    if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', { mode: fs.statSync(target).mode & 0o777 });
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { }
    console.error(`band: ${file} could not be written, left alone (${e.message})`);
    return 1;
  }
  console.log(`band: hooks ${done} ${file}`);
  return 0;
}

function main([action, B, file]) {
  if (!B || !path.isAbsolute(B)) return 2;
  if (action === 'write') {
    fs.writeFileSync(path.join(B, 'hooks.json'), JSON.stringify(hooksBlock(B), null, 2) + '\n');
    return 0;
  }
  if (action === 'merge' && file) return edit(file, (s) => mergeHooks(s, hooksBlock(B)), 'added to');
  if (action === 'remove' && file) return edit(file, (s) => removeHooks(s), 'removed from');
  return 2;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const code = main(process.argv.slice(2));
  if (code === 2) console.error('usage: node hooks.mjs write <B> | merge <B> <settings.json> | remove <B> <settings.json>');
  process.exit(code);
}
