import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}
const context = {
  todayISO: () => '2026-07-11',
  uid: prefix => `${prefix}-test`,
  number: value => Number(value || 0),
  Date,
  structuredClone
};
vm.createContext(context);
vm.runInContext(`${extractFunction('defaultState')}\n${extractFunction('migrate')}\nthis.defaultState=defaultState;this.migrate=migrate;`, context);

test('old saved state migrates additively without replacing existing finance records', () => {
  const old = {
    schemaVersion: 3,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    settings: { householdName: 'Andre Household', fortnightAnchor: '2026-07-03' },
    accounts: [{ id: 'acct-existing', name: 'Existing account' }],
    bills: [{ id: 'bill-existing', name: 'Mortgage', amount: 900 }],
    incomes: [], budgets: [], sinkingFunds: [], debts: [], transactions: [{ id: 'tx-existing', amount: 10 }], rules: [], audit: []
  };
  const migrated = context.migrate(old);
  assert.equal(migrated.schemaVersion, 5);
  assert.equal(migrated.settings.householdName, 'Andre Household');
  assert.equal(migrated.accounts[0].id, 'acct-existing');
  assert.equal(migrated.bills[0].id, 'bill-existing');
  assert.equal(migrated.transactions[0].id, 'tx-existing');
  assert.ok(migrated.rates && migrated.bankSync);
});

test('Version 3.3.3 does not alter the finance state schema', () => {
  assert.equal(context.defaultState().schemaVersion, 5);
});

test('local commit saves IndexedDB before queuing cloud providers', () => {
  const start = source.indexOf("async function commit(");
  const end = source.indexOf("function scheduleSync()", start);
  const commit = source.slice(start, end);
  assert.ok(commit.indexOf('storage.setState(state)') < commit.indexOf('queueOneDriveSync()'));
  assert.match(commit, /scheduleSync\(\);scheduleFolderBackup\(\);queueOneDriveSync\(\)/);
});
