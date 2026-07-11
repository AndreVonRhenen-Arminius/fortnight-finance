import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createOneDriveEnvelope } from '../js/onedrive-core.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

function financeState(amount = 100, updatedAt = '2026-07-11T08:00:00.000Z') {
  return {
    schemaVersion: 5, updatedAt, settings: { householdName: 'Household' },
    accounts: [], bills: [{ id: 'bill-1', amount }], incomes: [], budgets: [],
    sinkingFunds: [], debts: [], transactions: [], rules: [], audit: [], rates: {}, bankSync: {}
  };
}

async function loadModule({ fetchImpl, online = true, existingAccounts = [] } = {}) {
  const storage = new MemoryStorage();
  const events = new Map();
  let isOnline = online;
  const trace = { loginRequests: [], silentRequests: [], popupRequests: [], handleRedirectCalls: 0 };
  class MockMsalClient {
    async initialize() {}
    async handleRedirectPromise() { trace.handleRedirectCalls++; return null; }
    getActiveAccount() { return null; }
    getAllAccounts() { return existingAccounts; }
    setActiveAccount(account) { this.account = account; }
    async loginPopup(request) { trace.loginRequests.push(request); return { account: { name: 'Andre Test', username: 'andre@example.test' } }; }
    async logoutPopup() {}
    async acquireTokenSilent(request) { trace.silentRequests.push(request); return { accessToken: 'temporary-test-token' }; }
    async acquireTokenPopup(request) { trace.popupRequests.push(request); return { accessToken: 'temporary-test-token' }; }
  }
  globalThis.window = {
    APP_MICROSOFT_CONFIG: {
      clientId: '11111111-1111-4111-8111-111111111111',
      authority: 'https://login.microsoftonline.com/common',
      redirectUri: 'https://example.test/fortnight-finance/'
    },
    FINANCE_CONFIG: { appUrl: 'https://example.test/fortnight-finance/' },
    location: new URL('https://example.test/fortnight-finance/'),
    localStorage: storage,
    crypto: webcrypto,
    fetch: fetchImpl,
    msal: { PublicClientApplication: MockMsalClient },
    addEventListener(name, callback) { events.set(name, callback); }
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get onLine() { return isOnline; } } });
  const url = new URL('../js/onedrive.js', import.meta.url);
  url.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  const mod = await import(url.href);
  return { mod, storage, events, trace, setOnline(value) { isOnline = value; } };
}

test('mock MSAL initialisation and sign-in use the configured restricted scope', async () => {
  const env = await loadModule({ fetchImpl: async () => new Response('', { status: 404 }) });
  await env.mod.initOneDrive({ getState: () => financeState(), storage: env.storage, fetchImpl: async () => new Response('', { status: 404 }), msalLibrary: window.msal, cryptoImpl: webcrypto });
  assert.equal(env.mod.getOneDriveStatus().state, 'configured');
  await env.mod.signInMicrosoftOneDrive();
  assert.equal(env.mod.getOneDriveStatus().accountName, 'Andre Test');
  assert.deepEqual(env.trace.loginRequests[0].scopes, ['Files.ReadWrite.AppFolder']);
});


test('mock MSAL resumes an existing session after returning to the app', async () => {
  const account = { name: 'Andre Resumed', username: 'resumed@example.test' };
  const env = await loadModule({ fetchImpl: async () => new Response('', { status: 404 }), existingAccounts: [account] });
  await env.mod.initOneDrive({ getState: () => financeState(), storage: env.storage, fetchImpl: async () => new Response('', { status: 404 }), msalLibrary: window.msal, cryptoImpl: webcrypto });
  assert.equal(env.trace.handleRedirectCalls, 1);
  assert.equal(env.mod.getOneDriveStatus().state, 'ready');
  assert.equal(env.mod.getOneDriveStatus().accountName, 'Andre Resumed');
});

test('first sign-in sync uploads local state when no OneDrive file exists', async () => {
  let putCount = 0;
  const fetchImpl = async (url, options = {}) => {
    if ((options.method || 'GET') === 'PUT') {
      putCount++;
      return new Response(JSON.stringify({ id: 'file-1', eTag: 'etag-1' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('', { status: 404 });
  };
  const env = await loadModule({ fetchImpl });
  await env.mod.initOneDrive({ getState: () => financeState(), storage: env.storage, fetchImpl, msalLibrary: window.msal, cryptoImpl: webcrypto });
  await env.mod.signInMicrosoftOneDrive();
  const result = await env.mod.syncOneDrive({ mode: 'first-sign-in', interactive: true });
  assert.equal(result.kind, 'pushed');
  assert.equal(putCount, 1);
});

test('mock upload creates the unique OneDrive file and no token is written into JSON', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if ((options.method || 'GET') === 'GET') return new Response('', { status: 404 });
    return new Response(JSON.stringify({ id: 'file-1', eTag: 'etag-1' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  const env = await loadModule({ fetchImpl });
  await env.mod.initOneDrive({ getState: () => financeState(), storage: env.storage, fetchImpl, msalLibrary: window.msal, cryptoImpl: webcrypto });
  await env.mod.signInMicrosoftOneDrive();
  const result = await env.mod.pushStateToOneDrive(financeState(), { interactive: true });
  assert.equal(result.kind, 'pushed');
  const upload = calls.find(call => call.options.method === 'PUT');
  assert.match(upload.url, /fortnight-finance-state\.json:\/content$/);
  assert.doesNotMatch(upload.options.body, /temporary-test-token/);
});


test('push validation rejects incomplete local state before Graph upload', async () => {
  let putCount = 0;
  const fetchImpl = async (url, options = {}) => {
    if ((options.method || 'GET') === 'PUT') putCount++;
    return new Response('', { status: 404 });
  };
  const env = await loadModule({ fetchImpl });
  await env.mod.initOneDrive({ getState: () => financeState(), storage: env.storage, fetchImpl, msalLibrary: window.msal, cryptoImpl: webcrypto });
  await env.mod.signInMicrosoftOneDrive();
  await assert.rejects(() => env.mod.pushStateToOneDrive({ schemaVersion: 5, settings: {} }, { interactive: true }), /invalid accounts collection/);
  assert.equal(putCount, 0);
});

test('mock download validates the file before returning finance data', async () => {
  const envelope = await createOneDriveEnvelope(financeState(222), { deviceId: 'remote-device', cryptoImpl: webcrypto });
  const fetchImpl = async (url) => {
    if (String(url).endsWith(':/content')) return new Response(JSON.stringify(envelope), { status: 200 });
    return new Response(JSON.stringify({ id: 'file-1', eTag: 'etag-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const env = await loadModule({ fetchImpl });
  await env.mod.initOneDrive({ getState: () => financeState(), storage: env.storage, fetchImpl, msalLibrary: window.msal, cryptoImpl: webcrypto });
  await env.mod.signInMicrosoftOneDrive();
  const remote = await env.mod.pullStateFromOneDrive({ interactive: true });
  assert.equal(remote.envelope.data.bills[0].amount, 222);
});

test('offline changes remain queued and reconnect triggers an upload', async () => {
  let putCount = 0;
  const fetchImpl = async (url, options = {}) => {
    if ((options.method || 'GET') === 'PUT') { putCount++; return new Response(JSON.stringify({ id: 'file-1' }), { status: 201 }); }
    return new Response('', { status: 404 });
  };
  const env = await loadModule({ fetchImpl, online: false });
  await env.mod.initOneDrive({ getState: () => financeState(), storage: env.storage, fetchImpl, msalLibrary: window.msal, cryptoImpl: webcrypto, isOnline: () => navigator.onLine });
  await env.mod.signInMicrosoftOneDrive();
  env.mod.queueOneDriveSync({ immediate: true });
  assert.equal(env.mod.getOneDriveStatus().pending, true);
  assert.equal(putCount, 0);
  env.setOnline(true);
  env.events.get('online')();
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(putCount, 1);
  assert.equal(env.mod.getOneDriveStatus().pending, false);
});
