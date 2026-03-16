const DB_NAME    = "linkdrop_v1";
const STORE_NAME = "received";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "roomId" });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function saveSession(roomId, { text, files }) {
  try {
    const db    = await openDB();
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({
      roomId,
      text:    text || null,
      files:   (files || []).map(f => ({ name: f.name, size: f.size, blob: f.blob })),
      savedAt: Date.now(),
    });
    return new Promise((res, rej) => {
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror    = () => { db.close(); rej(); };
    });
  } catch (e) { console.warn("IDB save failed", e); }
}

export async function loadSession(roomId) {
  try {
    const db    = await openDB();
    const tx    = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    return new Promise((res) => {
      const req     = store.get(roomId);
      req.onsuccess = e => { db.close(); res(e.target.result || null); };
      req.onerror   = ()  => { db.close(); res(null); };
    });
  } catch { return null; }
}

export async function deleteSession(roomId) {
  try {
    const db    = await openDB();
    const tx    = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(roomId);
    return new Promise((res) => {
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror    = () => { db.close(); res(); };
    });
  } catch {}
}