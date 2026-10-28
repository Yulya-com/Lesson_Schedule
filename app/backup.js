// backup.js — автоматическая резервная копия в выбранную папку.
//
// Работает через File System Access API: пользователь один раз выбирает папку,
// браузер выдаёт «дескриптор» каталога, и приложение само пишет туда JSON.
// Разрешение сохраняется между запусками, поэтому выбор нужен однократно.
//
// Дескриптор хранится в отдельной маленькой базе tutorflow-files, а не в
// основной tutorflow-db: это инфраструктура браузера, а не данные репетитора,
// и её не нужно тащить через миграции схемы и резервные копии.
//
// Поддержка: Chrome, Edge, Яндекс.Браузер и другие браузеры на Chromium.
// Firefox и Safari этот API не дают — там остаётся ручной экспорт.

const FILES_DB_NAME = "tutorflow-files";
const FILES_DB_VERSION = 1;
const STORE_HANDLES = "handles";
const STORE_META = "meta";
const FOLDER_KEY = "backupFolder";
const LAST_SAVE_KEY = "lastSave";

/** Есть ли в браузере нужный API. */
export function isSupported() {
  return typeof window !== "undefined"
    && typeof window.showDirectoryPicker === "function"
    && typeof indexedDB !== "undefined";
}

/* ---------- Служебная база ---------- */

let filesDbPromise = null;

function openFilesDb() {
  if (filesDbPromise) return filesDbPromise;

  filesDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(FILES_DB_NAME, FILES_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_HANDLES)) {
        database.createObjectStore(STORE_HANDLES, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(STORE_META)) {
        database.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      filesDbPromise = null;
      reject(request.error || new Error("Не удалось открыть хранилище настроек копирования"));
    };
    // Без этого открытие может ждать вечно, например пока другая вкладка
    // держит старую версию служебной базы.
    request.onblocked = () => {
      filesDbPromise = null;
      reject(new Error("Хранилище настроек копирования занято другой вкладкой"));
    };
  });

  return filesDbPromise;
}

function runTransaction(storeName, mode, action) {
  return openFilesDb().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error("Ошибка хранилища"));
    transaction.onabort = () => reject(transaction.error || new Error("Операция отменена"));

    const request = action(store);
    if (request) request.onsuccess = () => { result = request.result; };
  }));
}

/* ---------- Папка ---------- */

/**
 * Спрашивает у пользователя папку и запоминает её.
 * Вызывать только из обработчика клика: браузер требует жест пользователя.
 */
export async function chooseFolder() {
  if (!isSupported()) {
    throw new Error("Браузер не поддерживает выбор папки. Делайте копию кнопкой «Экспорт JSON».");
  }

  const handle = await window.showDirectoryPicker({
    id: "tutorflow-backup",
    mode: "readwrite",
    startIn: "documents",
  });

  const permission = await requestPermission(handle);
  if (permission !== "granted") {
    throw new Error("Доступ к папке не выдан. Копия не будет создаваться.");
  }

  // Запоминание папки — необязательный шаг: если браузер не смог сохранить
  // дескриптор, копирование всё равно работает до перезагрузки страницы.
  try {
    await runTransaction(STORE_HANDLES, "readwrite", (store) => store.put({ key: FOLDER_KEY, handle }));
  } catch {
    // Намеренно молча: пользователю важнее копия, а не запись настройки.
  }

  return handle;
}

/** Забывает выбранную папку. Файлы на диске не удаляются. */
export async function forgetFolder() {
  // Ошибки служебного хранилища не должны мешать выключению копирования.
  try {
    await runTransaction(STORE_HANDLES, "readwrite", (store) => store.delete(FOLDER_KEY));
  } catch {
    // папка просто останется запомненной до следующего успешного вызова
  }
  try {
    await runTransaction(STORE_META, "readwrite", (store) => store.delete(LAST_SAVE_KEY));
  } catch {
    // сведения о последней записи не критичны
  }
}

/** Возвращает сохранённый дескриптор папки или null. */
export async function loadFolder() {
  if (!isSupported()) return null;
  try {
    const record = await runTransaction(STORE_HANDLES, "readonly", (store) => store.get(FOLDER_KEY));
    return record?.handle || null;
  } catch {
    return null;
  }
}

/* ---------- Разрешения ---------- */

/** Текущее состояние разрешения: "granted", "prompt" или "denied". */
export async function queryPermission(handle) {
  if (!handle || typeof handle.queryPermission !== "function") return "denied";
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch {
    return "denied";
  }
}

/** Просит разрешение. Без жеста пользователя браузер вернёт "prompt". */
export async function requestPermission(handle) {
  if (!handle || typeof handle.requestPermission !== "function") return "denied";
  try {
    return await handle.requestPermission({ mode: "readwrite" });
  } catch {
    return "denied";
  }
}

/* ---------- Запись копии ---------- */

/** Имя файла копии за день: одна копия в сутки, перезаписывается при изменениях. */
export function fileNameFor(dateISO) {
  return `tutorflow-копия-${dateISO}.json`;
}

/**
 * Записывает данные в папку. Возвращает имя файла и размер.
 * Ошибка пробрасывается: вызывающий код решает, что показать пользователю.
 */
export async function writeBackup(handle, data, dateISO) {
  const fileName = fileNameFor(dateISO);
  const text = JSON.stringify(data, null, 2);

  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }

  const info = { fileName, bytes: new Blob([text]).size, at: new Date().toISOString() };
  await runTransaction(STORE_META, "readwrite", (store) => store.put({ key: LAST_SAVE_KEY, ...info }));
  return info;
}

/** Сведения о последней удачной записи или null. */
export async function getLastSave() {
  try {
    const record = await runTransaction(STORE_META, "readonly", (store) => store.get(LAST_SAVE_KEY));
    if (!record) return null;
    return { fileName: record.fileName, bytes: record.bytes, at: record.at };
  } catch {
    return null;
  }
}
