import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');

test('all local HTML assets exist and HTML ids are unique', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(match => match[1])
    .filter(ref => !/^(?:https?:|#|data:)/.test(ref));
  for (const ref of refs) assert.ok(fs.existsSync(path.join(root, ref)), `Missing HTML asset: ${ref}`);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML id found');
});

test('all service-worker assets exist and authentication callbacks are not cached', () => {
  const sw = read('sw.js');
  const assetBlock = sw.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1] || '';
  const assets = [...assetBlock.matchAll(/'\.\/([^']*)'/g)].map(match => match[1]).filter(Boolean);
  for (const asset of assets) assert.ok(fs.existsSync(path.join(root, asset)), `Missing service-worker asset: ${asset}`);
  assert.match(sw, /fortnight-finance-v12/);
  assert.match(sw, /authCallback/);
  assert.match(sw, /url\.searchParams\.has/);
});

test('protected Version 3.3.2 files remain byte-for-byte unchanged', () => {
  const expected = {
    'js/config.js': 'f40c7f70c86c06b8340d7971c0f49b1aa63c846171440a213050316d0f64c9f0',
    'js/sync.js': 'da1d6f72b4708733485b048d32f93b1926b276bc82542968a1209e25e87bb247',
    'supabase/schema.sql': '93df29d479da4698e94f80399c809803a0e138b378361c46b821b9eca2f58ec6',
    'supabase/functions/asb-sync/index.ts': '48620a47084cbc1da02141fce20fca1ac44007140ee4400255ca88ad8e137df7'
  };
  for (const [file, digest] of Object.entries(expected)) assert.equal(hash(file), digest, `${file} changed`);
});

test('OneDrive source uses the restricted scope and unique file name only', () => {
  const source = `${read('js/onedrive-core.js')}\n${read('js/onedrive.js')}`;
  assert.match(source, /Files\.ReadWrite\.AppFolder/);
  assert.match(source, /fortnight-finance-state\.json/);
  assert.doesNotMatch(source, /Files\.ReadWrite\.All/);
  assert.doesNotMatch(source, /clientSecret\s*[:=]\s*['"][^'"]+/i);
});

test('obsolete root JavaScript duplicates are absent', () => {
  assert.equal(fs.existsSync(path.join(root, 'app.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'sync.js')), false);
  assert.ok(fs.existsSync(path.join(root, 'js/app.js')));
  assert.ok(fs.existsSync(path.join(root, 'js/sync.js')));
});
