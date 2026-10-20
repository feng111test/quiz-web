const DB_NAME = "exam-workspace";
const STORE_NAME = "question-banks";
const DB_VERSION = 1;

let dbPromise = null;

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `bank-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持 IndexedDB"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开题库数据库"));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

function runTransaction(mode, action) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let request;
        try {
          request = action(store);
        } catch (error) {
          reject(error);
          return;
        }
        transaction.oncomplete = () => resolve(request ? request.result : undefined);
        transaction.onerror = () => reject(transaction.error || new Error("题库操作失败"));
        transaction.onabort = () => reject(transaction.error || new Error("题库操作已中止"));
      }),
  );
}

export async function listBanks() {
  try {
    const banks = await runTransaction("readonly", (store) => store.getAll());
    return (banks || [])
      .filter((bank) => bank && Array.isArray(bank.questions))
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  } catch (error) {
    console.error("[题库] 读取失败", error);
    return [];
  }
}

export async function saveBank(bank) {
  const id = bank.id || newId();
  const record = {
    ...bank,
    id,
    createdAt: bank.createdAt || Date.now(),
    updatedAt: Date.now(),
    questionCount: bank.questions?.length || 0,
  };
  await runTransaction("readwrite", (store) =>
    store.keyPath === null ? store.put(record, id) : store.put(record),
  );
  return record;
}

export async function getBank(id) {
  try {
    return await runTransaction("readonly", (store) => store.get(id));
  } catch (error) {
    console.error("[题库] 读取单条失败", error);
    return undefined;
  }
}

export async function deleteBank(id) {
  try {
    await runTransaction("readwrite", (store) => store.delete(id));
    return true;
  } catch (error) {
    console.error("[题库] 删除失败", error);
    return false;
  }
}

export async function ensurePersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (error) {
    console.warn("[题库] 申请持久化存储失败", error);
    return false;
  }
}

export function formatSavedAt(timestamp) {
  const value = Number(timestamp);
  if (!value) return "未知时间";
  const diff = Date.now() - value;
  if (diff < 60 * 1000) return "刚刚";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
