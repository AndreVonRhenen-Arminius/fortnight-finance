import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  ONEDRIVE_APP_ID, ONEDRIVE_FILE_NAME, ONEDRIVE_SCOPE,
  createOneDriveEnvelope, validateOneDriveEnvelope, compareOneDriveCopies,
  validateMicrosoftConfig, cloneWithoutSensitiveData, hasMeaningfulFinanceData
} from '../js/onedrive-core.js';

const state = (updatedAt = '2026-07-11T08:00:00.000Z', amount = 100) => ({
  schemaVersion: 5,
  updatedAt,
  settings: { householdName: 'Household' },
  accounts: [], bills: [{ id: 'bill-1', amount }], incomes: [], budgets: [],
  sinkingFunds: [], debts: [], transactions: [], rules: [], audit: [], rates: {}, bankSync: {}
});

test('creates and validates a complete app-specific envelope', async () => {
  const envelope = await createOneDriveEnvelope(state(), { deviceId: 'device-test', cryptoImpl: webcrypto });
  assert.equal(envelope.appId, ONEDRIVE_APP_ID);
  assert.equal(ONEDRIVE_FILE_NAME, 'fortnight-finance-state.json');
  assert.equal(ONEDRIVE_SCOPE, 'Files.ReadWrite.AppFolder');
  const valid = await validateOneDriveEnvelope(envelope, { cryptoImpl: webcrypto });
  assert.equal(valid.data.bills[0].amount, 100);
});

test('rejects unrelated, malformed and tampered backups', async () => {
  const envelope = await createOneDriveEnvelope(state(), { deviceId: 'device-test', cryptoImpl: webcrypto });
  await assert.rejects(() => validateOneDriveEnvelope({ ...envelope, appId: 'other-app' }, { cryptoImpl: webcrypto }), /different application/);
  await assert.rejects(() => validateOneDriveEnvelope({ ...envelope, data: { ...envelope.data, bills: 'bad' } }, { cryptoImpl: webcrypto }), /invalid bills collection/);
  await assert.rejects(() => validateOneDriveEnvelope({ ...envelope, data: { ...envelope.data, bills: [{ amount: 999 }] } }, { cryptoImpl: webcrypto }), /integrity check/);
});

test('removes secret-like fields without deleting finance data', () => {
  const clean = cloneWithoutSensitiveData({ data: state(), accessToken: 'x', nested: { clientSecret: 'y', value: 2 } });
  assert.equal(clean.accessToken, undefined);
  assert.equal(clean.nested.clientSecret, undefined);
  assert.equal(clean.data.bills.length, 1);
});

test('detects local-only, remote-only and independent conflicts', async () => {
  const base = await createOneDriveEnvelope(state('2026-07-11T08:00:00.000Z', 100), { deviceId: 'a', cryptoImpl: webcrypto });
  const local = await createOneDriveEnvelope(state('2026-07-11T09:00:00.000Z', 120), { deviceId: 'a', baseHash: base.dataHash, cryptoImpl: webcrypto });
  const remote = await createOneDriveEnvelope(state('2026-07-11T10:00:00.000Z', 130), { deviceId: 'b', baseHash: base.dataHash, cryptoImpl: webcrypto });
  assert.equal(compareOneDriveCopies(local, base, base.dataHash).kind, 'local-only-change');
  assert.equal(compareOneDriveCopies(base, remote, base.dataHash).kind, 'remote-only-change');
  assert.equal(compareOneDriveCopies(local, remote, base.dataHash).kind, 'conflict');
});


test('first comparison never prefers a blank local state over meaningful OneDrive data', async () => {
  const blank = await createOneDriveEnvelope({
    ...state('2026-07-11T12:00:00.000Z', 0),
    bills: [],
    accounts: [
      { name: 'Main account' }, { name: 'Bills account' }, { name: 'Savings' }, { name: 'Credit card' }
    ]
  }, { deviceId: 'local', cryptoImpl: webcrypto });
  const meaningful = await createOneDriveEnvelope(state('2026-07-11T08:00:00.000Z', 100), { deviceId: 'remote', cryptoImpl: webcrypto });
  assert.equal(hasMeaningfulFinanceData(blank.data), false);
  assert.equal(hasMeaningfulFinanceData(meaningful.data), true);
  assert.equal(compareOneDriveCopies(blank, meaningful, '').kind, 'remote-newer-unbased');
});

test('validates SPA configuration and rejects insecure deployed redirects', () => {
  const good = validateMicrosoftConfig({
    clientId: '11111111-1111-4111-8111-111111111111',
    authority: 'https://login.microsoftonline.com/common',
    redirectUri: 'https://example.test/fortnight-finance/'
  }, new URL('https://example.test/fortnight-finance/'));
  assert.equal(good.valid, true);
  const bad = validateMicrosoftConfig({
    clientId: 'bad', authority: 'https://evil.test/common', redirectUri: 'http://example.test/'
  }, new URL('https://example.test/'));
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.length >= 3);
});
