'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MODULES = ['db.js', 'ai.js'];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function regularFile(file) {
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() && !fs.lstatSync(file).isSymbolicLink();
}

function syncShared(root, mode = 'check') {
  if (!['check', 'sync'].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'));
  if (config.functionRoot !== 'cloudfunctions' || !Array.isArray(config.functions)) {
    throw new Error('Invalid CloudBase function manifest');
  }
  const names = config.functions.map(item => item.name);
  if (!names.length || new Set(names).size !== names.length ||
      names.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name) || name.startsWith('pr_'))) {
    throw new Error('Unsafe or duplicate function name in manifest');
  }
  const functionRoot = path.join(root, config.functionRoot);
  const sourceRoot = path.join(functionRoot, '_shared');
  const sourceHashes = new Map();
  for (const module of MODULES) {
    const source = path.join(sourceRoot, module);
    if (!regularFile(source)) throw new Error(`Missing or unsafe shared source: ${source}`);
    sourceHashes.set(module, sha256(source));
  }

  const drift = [];
  const updated = [];
  for (const name of names) {
    const directory = path.join(functionRoot, name);
    if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory() || fs.lstatSync(directory).isSymbolicLink()) {
      throw new Error(`Missing or unsafe function directory: ${name}`);
    }
    for (const module of MODULES) {
      const target = path.join(directory, module);
      const same = regularFile(target) && sha256(target) === sourceHashes.get(module);
      if (same) continue;
      const label = `${name}/${module}`;
      if (mode === 'check') { drift.push(label); continue; }
      if (fs.existsSync(target) && !regularFile(target)) throw new Error(`Unsafe shared target: ${label}`);
      fs.copyFileSync(path.join(sourceRoot, module), target);
      if (sha256(target) !== sourceHashes.get(module)) throw new Error(`Hash mismatch after sync: ${label}`);
      updated.push(label);
    }
  }
  if (drift.length) throw new Error(`Shared module drift (${drift.length}): ${drift.join(', ')}`);
  return { functions: names.length, files: names.length * MODULES.length, updated, hashes: Object.fromEntries(sourceHashes) };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length && !['--check', '--sync'].includes(args[0]))) {
      throw new Error('Usage: node tools/sync-shared.cjs [--check|--sync]');
    }
    const result = syncShared(path.resolve(__dirname, '..'), args[0] === '--sync' ? 'sync' : 'check');
    for (const file of result.updated) console.log(`[SYNC] ${file}`);
    console.log(`[PASS] ${result.files} shared copies in ${result.functions} functions match _shared`);
    for (const [module, hash] of Object.entries(result.hashes)) console.log(`[SHA256] ${module} ${hash}`);
  } catch (error) {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { syncShared };
