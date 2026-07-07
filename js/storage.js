const DB_NAME = 'fortnight-finance-db';
const DB_VERSION = 1;
let dbPromise;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('app')) db.createObjectStore('app');
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
    };
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

async function withStore(name, mode, action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    const req = action(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const storage = {
  async getState() { return withStore('app', 'readonly', s => s.get('state')); },
  async setState(state) { return withStore('app', 'readwrite', s => s.put(state, 'state')); },
  async getMeta() { return withStore('app', 'readonly', s => s.get('meta')); },
  async setMeta(meta) { return withStore('app', 'readwrite', s => s.put(meta, 'meta')); },
  async saveHandle(name, handle) { return withStore('handles', 'readwrite', s => s.put(handle, name)); },
  async getHandle(name) { return withStore('handles', 'readonly', s => s.get(name)); },
  async removeHandle(name) { return withStore('handles', 'readwrite', s => s.delete(name)); },
  async addSnapshot(state, reason = 'change') {
    const item = { id: `${Date.now()}_${Math.random().toString(16).slice(2)}`, createdAt: new Date().toISOString(), reason, state };
    await withStore('snapshots', 'readwrite', s => s.put(item));
    const all = await this.listSnapshots();
    const excess = all.slice(30);
    for (const snap of excess) await withStore('snapshots', 'readwrite', s => s.delete(snap.id));
    return item;
  },
  async listSnapshots() {
    const all = await withStore('snapshots', 'readonly', s => s.getAll());
    return (all || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async getSnapshot(id) { return withStore('snapshots', 'readonly', s => s.get(id)); },
  async clearAll() {
    const db = await openDB();
    await Promise.all(['app', 'snapshots', 'handles'].map(name => new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite');
      const req = tx.objectStore(name).clear();
      req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
    })));
  }
};
