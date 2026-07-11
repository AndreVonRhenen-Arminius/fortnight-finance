import {
  ONEDRIVE_FILE_NAME, ONEDRIVE_SCOPE, createOneDriveEnvelope,
  validateOneDriveEnvelope, compareOneDriveCopies, getOrCreateDeviceId,
  validateMicrosoftConfig
} from './onedrive-core.js';

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const CONFIG_KEY = 'ff.microsoftConfig.v1';
const META_KEY = 'ff.onedrive.meta.v1';
const DEFAULT_AUTHORITY = 'https://login.microsoftonline.com/common';
let msalClient = null;
let microsoftAccount = null;
let runtime = null;
let autoTimer = null;
const listeners = new Set();

let status = {
  state: 'not-configured',
  message: 'Microsoft OneDrive is not configured.',
  error: '',
  accountName: '',
  accountUsername: '',
  lastSuccessfulSync: '',
  pending: false,
  fileName: ONEDRIVE_FILE_NAME,
  scope: ONEDRIVE_SCOPE
};

function browserStorage() { return runtime?.storage || window.localStorage; }
function browserFetch(...args) { return (runtime?.fetchImpl || window.fetch.bind(window))(...args); }
function isOnline() { return runtime?.isOnline ? runtime.isOnline() : navigator.onLine !== false; }
function defaultConfig() {
  const fileConfig = window.APP_MICROSOFT_CONFIG || {};
  return {
    clientId: String(fileConfig.clientId || ''),
    authority: String(fileConfig.authority || DEFAULT_AUTHORITY),
    redirectUri: String(fileConfig.redirectUri || `${window.location.origin}${window.location.pathname}`)
  };
}
function readJson(key, fallback) {
  try { return JSON.parse(browserStorage().getItem(key) || '') || fallback; } catch { return fallback; }
}
function writeJson(key, value) { browserStorage().setItem(key, JSON.stringify(value)); }
function getMeta() { return { baseHash: '', lastSuccessfulSync: '', pending: false, ...readJson(META_KEY, {}) }; }
function setMeta(patch) {
  const next = { ...getMeta(), ...patch };
  writeJson(META_KEY, next);
  return next;
}
function emit(patch = {}) {
  status = { ...status, ...patch };
  for (const callback of listeners) callback({ ...status });
}
function cleanError(error) {
  const text = String(error?.message || error || 'Microsoft OneDrive operation failed.').replace(/[<>]/g, '').trim();
  if (/interaction_required|login_required|consent_required/i.test(String(error?.errorCode || '') + text)) return 'Microsoft sign-in or consent is required.';
  if (/Files\.ReadWrite\.AppFolder|accessDenied|Authorization_RequestDenied|403/i.test(text)) return 'OneDrive app-folder access was denied. Confirm Files.ReadWrite.AppFolder consent and use a supported Microsoft account.';
  return text.slice(0, 500);
}
function updateFromMeta({ notify = true } = {}) {
  const meta = getMeta();
  const patch = { lastSuccessfulSync: meta.lastSuccessfulSync || '', pending: Boolean(meta.pending) };
  if (notify) emit(patch);
  else status = { ...status, ...patch };
}
function accountLabel(account) { return account?.name || account?.username || 'Microsoft account'; }
function metadataUrl() { return `${GRAPH_ROOT}/me/drive/special/approot:/${encodeURIComponent(ONEDRIVE_FILE_NAME)}`; }
function contentUrl() { return `${metadataUrl()}:/content`; }

export function getMicrosoftConfig() {
  return { ...defaultConfig(), ...readJson(CONFIG_KEY, {}) };
}

export async function saveMicrosoftConfiguration(input) {
  const checked = validateMicrosoftConfig(input, window.location);
  if (!checked.valid) throw new Error(checked.errors.join(' '));
  writeJson(CONFIG_KEY, checked.config);
  await initialiseMicrosoftOneDrive({ reinitialise: true });
  return checked.config;
}

export function getOneDriveStatus() { updateFromMeta({ notify: false }); return { ...status }; }
export function subscribeOneDriveStatus(callback) { listeners.add(callback); return () => listeners.delete(callback); }
export function clearOneDriveError() { emit({ error: '', message: microsoftAccount ? 'Signed in to Microsoft OneDrive.' : status.message, state: microsoftAccount ? 'ready' : status.state }); }
export function isOneDriveConfigured() { return validateMicrosoftConfig(getMicrosoftConfig(), window.location).valid; }
export function isMicrosoftOneDriveSignedIn() { return Boolean(microsoftAccount); }

export async function initOneDrive(options = {}) {
  runtime = {
    getState: options.getState,
    applyState: options.applyState,
    storage: options.storage || window.localStorage,
    fetchImpl: options.fetchImpl,
    isOnline: options.isOnline,
    msalLibrary: options.msalLibrary || window.msal,
    cryptoImpl: options.cryptoImpl || window.crypto
  };
  updateFromMeta();
  window.addEventListener?.('online', () => {
    if (getMeta().pending) queueOneDriveSync({ immediate: true });
  });
  await initialiseMicrosoftOneDrive();
  return getOneDriveStatus();
}

export async function initialiseMicrosoftOneDrive({ reinitialise = false } = {}) {
  if (reinitialise) { msalClient = null; microsoftAccount = null; }
  const config = getMicrosoftConfig();
  const checked = validateMicrosoftConfig(config, window.location);
  if (!checked.valid) {
    emit({ state: 'not-configured', message: config.clientId ? checked.errors.join(' ') : 'Enter a Microsoft client ID to enable OneDrive sync.', error: config.clientId ? checked.errors.join(' ') : '', accountName: '', accountUsername: '' });
    return null;
  }
  const library = runtime?.msalLibrary || window.msal;
  if (!library?.PublicClientApplication) {
    emit({ state: 'error', message: 'MSAL Browser could not be loaded.', error: 'MSAL Browser could not be loaded.' });
    return null;
  }
  if (!msalClient) {
    try {
      msalClient = new library.PublicClientApplication({
        auth: {
          clientId: checked.config.clientId,
          authority: checked.config.authority,
          redirectUri: checked.config.redirectUri,
          postLogoutRedirectUri: checked.config.redirectUri,
          navigateToLoginRequestUrl: false
        },
        cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false },
        system: { allowNativeBroker: false }
      });
      await msalClient.initialize();
      const redirectResult = await msalClient.handleRedirectPromise();
      microsoftAccount = redirectResult?.account || msalClient.getActiveAccount?.() || msalClient.getAllAccounts?.()[0] || null;
      if (microsoftAccount && msalClient.setActiveAccount) msalClient.setActiveAccount(microsoftAccount);
    } catch (error) {
      msalClient = null;
      microsoftAccount = null;
      const message = cleanError(error);
      emit({ state: 'error', message, error: message, accountName: '', accountUsername: '' });
      throw new Error(message);
    }
  }
  if (microsoftAccount) {
    emit({ state: 'ready', message: 'Signed in to Microsoft OneDrive.', error: '', accountName: accountLabel(microsoftAccount), accountUsername: microsoftAccount.username || '' });
  } else {
    emit({ state: 'configured', message: 'Microsoft OneDrive is configured but not signed in.', error: '', accountName: '', accountUsername: '' });
  }
  return msalClient;
}

export async function signInMicrosoftOneDrive() {
  await initialiseMicrosoftOneDrive();
  if (!msalClient) throw new Error('Save a valid Microsoft configuration before signing in.');
  emit({ state: 'syncing', message: 'Opening Microsoft sign-in…', error: '' });
  try {
    const result = await msalClient.loginPopup({ scopes: [ONEDRIVE_SCOPE], prompt: 'select_account' });
    microsoftAccount = result.account;
    if (msalClient.setActiveAccount) msalClient.setActiveAccount(microsoftAccount);
    emit({ state: 'ready', message: 'Microsoft sign-in completed.', error: '', accountName: accountLabel(microsoftAccount), accountUsername: microsoftAccount?.username || '' });
    return microsoftAccount;
  } catch (error) {
    const message = cleanError(error);
    emit({ state: 'error', message, error: message });
    throw new Error(message);
  }
}

export async function signOutMicrosoftOneDrive() {
  if (!msalClient || !microsoftAccount) return;
  try {
    await msalClient.logoutPopup({ account: microsoftAccount, postLogoutRedirectUri: getMicrosoftConfig().redirectUri, mainWindowRedirectUri: getMicrosoftConfig().redirectUri });
  } finally {
    microsoftAccount = null;
    emit({ state: 'configured', message: 'Signed out of Microsoft OneDrive.', error: '', accountName: '', accountUsername: '' });
  }
}

async function accessToken({ interactive = false } = {}) {
  if (!msalClient || !microsoftAccount) throw new Error('Sign in with Microsoft before using OneDrive.');
  const request = { scopes: [ONEDRIVE_SCOPE], account: microsoftAccount };
  try {
    return (await msalClient.acquireTokenSilent(request)).accessToken;
  } catch (error) {
    if (!interactive) throw error;
    return (await msalClient.acquireTokenPopup(request)).accessToken;
  }
}

async function graphRequest(url, options = {}, { interactive = false, allow404 = false } = {}) {
  const token = await accessToken({ interactive });
  const response = await browserFetch(url, {
    ...options,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    let detail = '';
    try { const body = await response.json(); detail = body?.error?.message || body?.error_description || ''; } catch { detail = await response.text().catch(() => ''); }
    const error = new Error(detail || `Microsoft Graph returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response;
}

async function fetchRemoteMetadata({ interactive = false } = {}) {
  const response = await graphRequest(metadataUrl(), { method: 'GET', headers: { Accept: 'application/json' } }, { interactive, allow404: true });
  return response ? response.json() : null;
}

export async function downloadOneDriveBackup({ interactive = false } = {}) {
  const metadata = await fetchRemoteMetadata({ interactive });
  if (!metadata) return null;
  const response = await graphRequest(contentUrl(), { method: 'GET', headers: { Accept: 'application/json' } }, { interactive });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('The OneDrive backup file is not valid JSON.'); }
  const envelope = await validateOneDriveEnvelope(parsed, { cryptoImpl: runtime?.cryptoImpl });
  return { envelope, etag: metadata.eTag || metadata.etag || '', metadata };
}

async function uploadEnvelope(envelope, { expectedEtag = '', expectMissing = false, interactive = false } = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (expectedEtag) headers['If-Match'] = expectedEtag;
  if (expectMissing) headers['If-None-Match'] = '*';
  try {
    const response = await graphRequest(contentUrl(), { method: 'PUT', headers, body: JSON.stringify(envelope, null, 2) }, { interactive });
    return response.json();
  } catch (error) {
    if (error.status === 409 || error.status === 412) {
      const conflict = new Error('The OneDrive copy changed before the upload completed. Compare both copies again.');
      conflict.code = 'ONEDRIVE_CONFLICT';
      throw conflict;
    }
    throw error;
  }
}

function markSuccess(dataHash, message) {
  const time = new Date().toISOString();
  setMeta({ baseHash: dataHash, lastSuccessfulSync: time, pending: false });
  emit({ state: 'synced', message, error: '', lastSuccessfulSync: time, pending: false });
}

export async function inspectOneDrive({ interactive = false } = {}) {
  if (!isOnline()) throw new Error('The device is offline. OneDrive sync remains queued.');
  if (!runtime?.getState) throw new Error('OneDrive was not initialised with an app-state provider.');
  emit({ state: 'syncing', message: 'Comparing local and OneDrive copies…', error: '' });
  const meta = getMeta();
  const deviceId = getOrCreateDeviceId(browserStorage(), runtime?.cryptoImpl?.randomUUID?.bind(runtime.cryptoImpl));
  const local = await createOneDriveEnvelope(runtime.getState(), { deviceId, baseHash: meta.baseHash, cryptoImpl: runtime?.cryptoImpl });
  const remoteFile = await downloadOneDriveBackup({ interactive });
  const comparison = compareOneDriveCopies(local, remoteFile?.envelope || null, meta.baseHash);
  emit({ state: comparison.kind === 'identical' ? 'synced' : 'ready', message: comparison.kind === 'identical' ? 'Local and OneDrive copies are up to date.' : 'Local and OneDrive copies were compared.', error: '' });
  return { ...comparison, remoteFile };
}

export async function pushStateToOneDrive(state = runtime?.getState?.(), { interactive = true, overwrite = false } = {}) {
  if (!state) throw new Error('No local finance state is available to upload.');
  if (!isOnline()) { setMeta({ pending: true }); emit({ state: 'offline', message: 'Offline. OneDrive upload is queued.', pending: true }); return { kind: 'queued' }; }
  emit({ state: 'syncing', message: 'Uploading this device to OneDrive…', error: '' });
  try {
    const meta = getMeta();
    const deviceId = getOrCreateDeviceId(browserStorage(), runtime?.cryptoImpl?.randomUUID?.bind(runtime.cryptoImpl));
    const envelope = await createOneDriveEnvelope(state, { deviceId, baseHash: meta.baseHash, cryptoImpl: runtime?.cryptoImpl });
    await validateOneDriveEnvelope(envelope, { cryptoImpl: runtime?.cryptoImpl });
    const remoteMetadata = await fetchRemoteMetadata({ interactive });
    await uploadEnvelope(envelope, { expectedEtag: remoteMetadata?.eTag || remoteMetadata?.etag || '', expectMissing: !remoteMetadata, interactive });
    markSuccess(envelope.dataHash, overwrite ? 'OneDrive copy was replaced with this device.' : 'OneDrive upload completed.');
    return { kind: 'pushed', envelope };
  } catch (error) {
    setMeta({ pending: true });
    const message = cleanError(error);
    emit({ state: 'error', message, error: message, pending: true });
    throw error.code === 'ONEDRIVE_CONFLICT' ? error : new Error(message);
  }
}

export async function pullStateFromOneDrive({ interactive = true } = {}) {
  if (!isOnline()) throw new Error('The device is offline. Connect to the internet before downloading from OneDrive.');
  emit({ state: 'syncing', message: 'Downloading and validating the OneDrive copy…', error: '' });
  try {
    const remoteFile = await downloadOneDriveBackup({ interactive });
    if (!remoteFile) throw new Error('No OneDrive backup file was found.');
    return remoteFile;
  } catch (error) {
    const message = cleanError(error);
    emit({ state: 'error', message, error: message });
    throw new Error(message);
  }
}

export function acceptPulledOneDrive(envelope) {
  markSuccess(envelope.dataHash, 'OneDrive copy was loaded on this device.');
}

export async function syncOneDrive({ mode = 'manual', interactive = mode !== 'auto' } = {}) {
  try {
    const result = await inspectOneDrive({ interactive });
    if (result.kind === 'missing-remote') return pushStateToOneDrive(result.local.data, { interactive, overwrite: false });
    if (result.kind === 'identical') { markSuccess(result.local.dataHash, 'Local and OneDrive copies are up to date.'); return { kind: 'identical', ...result }; }
    if (result.kind === 'local-only-change') return pushStateToOneDrive(result.local.data, { interactive, overwrite: false });
    if (result.kind === 'remote-only-change' && mode === 'auto' && runtime?.applyState) {
      await runtime.applyState(result.remote.data, result.remote);
      acceptPulledOneDrive(result.remote);
      return { kind: 'pulled', ...result };
    }
    if (result.kind === 'remote-only-change' || result.kind === 'remote-newer-unbased') {
      emit({ state: 'attention', message: 'A newer OneDrive copy is available. Review it before replacing local data.', error: '' });
      return { kind: 'needs-pull', ...result };
    }
    if (result.kind === 'local-newer-unbased') {
      emit({ state: 'attention', message: 'This device is newer than OneDrive. Confirm before replacing the OneDrive copy.', error: '' });
      return { kind: 'needs-push', ...result };
    }
    const conflictMessage = 'OneDrive conflict detected. Both copies changed independently; nothing was overwritten.';
    emit({ state: 'conflict', message: conflictMessage, error: conflictMessage });
    return { kind: 'conflict', ...result };
  } catch (error) {
    if (!isOnline()) {
      setMeta({ pending: true });
      emit({ state: 'offline', message: 'Offline. Local changes are safe and OneDrive sync is queued.', error: '', pending: true });
      return { kind: 'queued' };
    }
    const message = cleanError(error);
    emit({ state: 'error', message, error: message });
    throw new Error(message);
  }
}

export function queueOneDriveSync({ immediate = false } = {}) {
  if (!isOneDriveConfigured()) return;
  setMeta({ pending: true });
  emit({ pending: true, state: isOnline() ? 'pending' : 'offline', message: isOnline() ? 'OneDrive sync is pending.' : 'Offline. Local changes are safe and OneDrive sync is queued.' });
  clearTimeout(autoTimer);
  if (!microsoftAccount || !isOnline()) return;
  autoTimer = setTimeout(() => syncOneDrive({ mode: 'auto', interactive: false }).catch(() => null), immediate ? 0 : 3500);
}
