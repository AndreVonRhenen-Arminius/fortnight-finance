import { storage } from './storage.js';
import { bytesToBase64, base64ToBytes, downloadBlob, isoDate } from './utils.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let folderHandle = null;
let sessionBackupPassword = '';

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function createBackupPackage(state, password = '') {
  const payload = { format: 'fortnight-finance', version: 1, createdAt: new Date().toISOString(), data: state };
  if (!password) return JSON.stringify(payload, null, 2);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)));
  return JSON.stringify({
    format: 'fortnight-finance-encrypted', version: 1, createdAt: payload.createdAt,
    kdf: { name: 'PBKDF2', iterations: 250000, hash: 'SHA-256', salt: bytesToBase64(salt) },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) }
  }, null, 2);
}

export async function readBackupPackage(text, password = '') {
  const parsed = JSON.parse(text);
  if (parsed.format === 'fortnight-finance' && parsed.data) return parsed;
  if (parsed.format !== 'fortnight-finance-encrypted') throw new Error('This is not a recognised Fortnight Finance backup.');
  if (!password) throw new Error('This backup is encrypted and requires its backup password.');
  const salt = base64ToBytes(parsed.kdf.salt);
  const iv = base64ToBytes(parsed.cipher.iv);
  const key = await deriveKey(password, salt);
  try {
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(parsed.cipher.data));
    const payload = JSON.parse(decoder.decode(decrypted));
    if (payload.format !== 'fortnight-finance' || !payload.data) throw new Error('Invalid backup payload.');
    return payload;
  } catch {
    throw new Error('The backup password is incorrect, or the backup file is damaged.');
  }
}

export async function exportBackup(state, password = '') {
  const text = await createBackupPackage(state, password);
  const extension = password ? 'afbackup' : 'json';
  downloadBlob(new Blob([text], { type: 'application/json' }), `fortnight-finance-${isoDate(new Date())}.${extension}`);
}

export async function chooseBackupFolder() {
  if (!window.showDirectoryPicker) throw new Error('Automatic folder backup requires Microsoft Edge or Google Chrome on desktop.');
  folderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await storage.saveHandle('backupFolder', folderHandle);
  return folderHandle.name;
}

export async function restoreFolderHandle() {
  folderHandle = await storage.getHandle('backupFolder');
  return folderHandle;
}

async function ensurePermission(handle) {
  if (!handle) return false;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

async function writeFile(directory, name, contents) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}

export function setSessionBackupPassword(password) { sessionBackupPassword = password || ''; }
export function hasSessionBackupPassword() { return Boolean(sessionBackupPassword); }
export function hasFolderHandle() { return Boolean(folderHandle); }

export async function automaticFolderBackup(state) {
  if (!folderHandle || !sessionBackupPassword) return { skipped: true };
  if (!(await ensurePermission(folderHandle))) throw new Error('Backup folder permission was not granted.');
  const contents = await createBackupPackage(state, sessionBackupPassword);
  await writeFile(folderHandle, 'fortnight-finance-latest.afbackup', contents);
  const daily = await folderHandle.getDirectoryHandle('Daily', { create: true });
  await writeFile(daily, `fortnight-finance-${isoDate(new Date())}.afbackup`, contents);
  return { skipped: false, folder: folderHandle.name };
}

export async function disconnectFolder() {
  folderHandle = null; sessionBackupPassword = '';
  await storage.removeHandle('backupFolder');
}
