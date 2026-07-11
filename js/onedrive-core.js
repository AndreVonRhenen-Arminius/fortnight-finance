export const ONEDRIVE_APP_ID = 'fortnight-finance-pwa';
export const ONEDRIVE_BACKUP_SCHEMA_VERSION = 1;
export const ONEDRIVE_FILE_NAME = 'fortnight-finance-state.json';
export const ONEDRIVE_SCOPE = 'Files.ReadWrite.AppFolder';
export const CURRENT_FINANCE_SCHEMA_VERSION = 5;

const SENSITIVE_KEY = /(password|passphrase|secret|access.?token|refresh.?token|id.?token|service.?role|private.?key|api.?key|akahu.*token)/i;

export function cloneWithoutSensitiveData(value) {
  if (Array.isArray(value)) return value.map(cloneWithoutSensitiveData);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'ui' || SENSITIVE_KEY.test(key)) continue;
    output[key] = cloneWithoutSensitiveData(child);
  }
  return output;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export async function sha256(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error('Secure hashing is not available in this browser.');
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : stableStringify(value));
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function getOrCreateDeviceId(storage = globalThis.localStorage, randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  const key = 'ff.onedrive.deviceId.v1';
  let id = storage?.getItem?.(key) || '';
  if (!id) {
    id = randomUUID ? randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    storage?.setItem?.(key, id);
  }
  return id;
}

export async function createOneDriveEnvelope(state, { deviceId, baseHash = '', now = new Date().toISOString(), cryptoImpl } = {}) {
  const data = cloneWithoutSensitiveData(state);
  const dataHash = await sha256(data, cryptoImpl);
  return {
    schemaVersion: ONEDRIVE_BACKUP_SCHEMA_VERSION,
    appId: ONEDRIVE_APP_ID,
    updatedAt: String(data.updatedAt || now),
    deviceId: String(deviceId || ''),
    baseHash: String(baseHash || ''),
    dataHash,
    data
  };
}

function requireArray(data, key) {
  if (!Array.isArray(data[key])) throw new Error(`The OneDrive backup has an invalid ${key} collection.`);
}

export async function validateOneDriveEnvelope(input, { cryptoImpl } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The OneDrive backup is not a valid JSON object.');
  if (Number(input.schemaVersion) !== ONEDRIVE_BACKUP_SCHEMA_VERSION) throw new Error('The OneDrive backup schema is not supported.');
  if (input.appId !== ONEDRIVE_APP_ID) throw new Error('The OneDrive file belongs to a different application.');
  if (!input.deviceId || typeof input.deviceId !== 'string') throw new Error('The OneDrive backup does not contain a valid device identifier.');
  if (!input.updatedAt || Number.isNaN(new Date(input.updatedAt).getTime())) throw new Error('The OneDrive backup does not contain a valid update time.');
  if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) throw new Error('The OneDrive backup does not contain usable finance data.');

  const financeSchema = Number(input.data.schemaVersion);
  if (!Number.isInteger(financeSchema) || financeSchema < 1 || financeSchema > CURRENT_FINANCE_SCHEMA_VERSION) {
    throw new Error('The finance data schema is newer than this app or is invalid.');
  }
  if (!input.data.settings || typeof input.data.settings !== 'object') throw new Error('The OneDrive backup is missing finance settings.');
  for (const key of ['accounts', 'bills', 'incomes', 'budgets', 'sinkingFunds', 'debts', 'transactions', 'rules', 'audit']) requireArray(input.data, key);

  const computedHash = await sha256(cloneWithoutSensitiveData(input.data), cryptoImpl);
  if (!input.dataHash || input.dataHash !== computedHash) throw new Error('The OneDrive backup failed its integrity check.');

  return {
    schemaVersion: ONEDRIVE_BACKUP_SCHEMA_VERSION,
    appId: ONEDRIVE_APP_ID,
    updatedAt: new Date(input.updatedAt).toISOString(),
    deviceId: input.deviceId,
    baseHash: typeof input.baseHash === 'string' ? input.baseHash : '',
    dataHash: input.dataHash,
    data: cloneWithoutSensitiveData(input.data)
  };
}


export function hasMeaningfulFinanceData(data = {}) {
  const nonEmpty = key => Array.isArray(data[key]) && data[key].length > 0;
  if (['bills', 'incomes', 'debts', 'transactions', 'rules'].some(nonEmpty)) return true;
  if (Array.isArray(data.rates?.invoices) && data.rates.invoices.length) return true;
  if (Array.isArray(data.budgets) && data.budgets.some(item => Number(item?.amount || 0) !== 0)) return true;
  if (Array.isArray(data.sinkingFunds) && data.sinkingFunds.some(item => [item?.target, item?.balance, item?.contribution].some(value => Number(value || 0) !== 0))) return true;
  if (Array.isArray(data.accounts) && data.accounts.some(item => !['Main account', 'Bills account', 'Savings', 'Credit card'].includes(String(item?.name || '')))) return true;
  if (String(data.settings?.householdName || 'Household') !== 'Household') return true;
  if (Number(data.settings?.openingBalance || 0) !== 0) return true;
  return false;
}

export function compareOneDriveCopies(localEnvelope, remoteEnvelope, baseHash = '') {
  if (!remoteEnvelope) return { kind: 'missing-remote', local: localEnvelope, remote: null };
  if (localEnvelope.dataHash === remoteEnvelope.dataHash) return { kind: 'identical', local: localEnvelope, remote: remoteEnvelope };

  if (baseHash) {
    const localChanged = localEnvelope.dataHash !== baseHash;
    const remoteChanged = remoteEnvelope.dataHash !== baseHash;
    if (localChanged && !remoteChanged) return { kind: 'local-only-change', local: localEnvelope, remote: remoteEnvelope };
    if (!localChanged && remoteChanged) return { kind: 'remote-only-change', local: localEnvelope, remote: remoteEnvelope };
    if (localChanged && remoteChanged) return { kind: 'conflict', local: localEnvelope, remote: remoteEnvelope };
  }

  const localMeaningful = hasMeaningfulFinanceData(localEnvelope.data);
  const remoteMeaningful = hasMeaningfulFinanceData(remoteEnvelope.data);
  if (!localMeaningful && remoteMeaningful) return { kind: 'remote-newer-unbased', local: localEnvelope, remote: remoteEnvelope, reason: 'remote-has-data' };
  if (localMeaningful && !remoteMeaningful) return { kind: 'local-newer-unbased', local: localEnvelope, remote: remoteEnvelope, reason: 'local-has-data' };

  const localTime = new Date(localEnvelope.updatedAt).getTime();
  const remoteTime = new Date(remoteEnvelope.updatedAt).getTime();
  if (localTime > remoteTime) return { kind: 'local-newer-unbased', local: localEnvelope, remote: remoteEnvelope };
  if (remoteTime > localTime) return { kind: 'remote-newer-unbased', local: localEnvelope, remote: remoteEnvelope };
  return { kind: 'conflict', local: localEnvelope, remote: remoteEnvelope };
}

export function validateMicrosoftConfig(config, location = globalThis.location) {
  const candidate = {
    clientId: String(config?.clientId || '').trim(),
    authority: String(config?.authority || 'https://login.microsoftonline.com/common').trim().replace(/\/$/, ''),
    redirectUri: String(config?.redirectUri || '').trim()
  };
  const errors = [];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.clientId)) errors.push('Enter a valid Microsoft Application (client) ID.');
  try {
    const authority = new URL(candidate.authority);
    if (authority.protocol !== 'https:' || authority.hostname.toLowerCase() !== 'login.microsoftonline.com') errors.push('Authority must use https://login.microsoftonline.com/.');
    if (!authority.pathname || authority.pathname === '/') errors.push('Authority must include common, organisations, consumers or a tenant ID.');
  } catch { errors.push('Authority is not a valid URL.'); }
  try {
    const redirect = new URL(candidate.redirectUri, location?.href);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if (redirect.protocol !== 'https:' && !(local && redirect.protocol === 'http:')) errors.push('Redirect URI must use HTTPS, except for localhost development.');
    if (redirect.hash || redirect.search) errors.push('Redirect URI must not contain a query string or fragment.');
    candidate.redirectUri = redirect.href;
  } catch { errors.push('Redirect URI is not a valid URL.'); }
  return { valid: errors.length === 0, errors, config: candidate };
}
