// db.js — доступ к IndexedDB TutorFlow.
// Здесь только открытие базы, схема, миграции и операции с хранилищами.
// Логика интерфейса живёт в app.js, расчёт дат — в recurrence.js.

import {
  todayISO,
  addDays,
  startOfWeek,
  timeToMinutes,
} from "./recurrence.js";

export const DB_NAME = "tutorflow-db";
export const DB_VERSION = 2;

export const STORE_STUDENTS = "students";
export const STORE_LESSONS = "lessons";
export const STORE_SERIES = "series";
export const STORE_NOTES = "notes";
export const STORE_SETTINGS = "settings";
export const STORE_ACTIVITY = "activity";

export const ACTIVITY_LIMIT = 5000;

export const STATUSES = ["planned", "done", "cancelled", "noShow"];

export const STATUS_LABELS = {
  planned: "Запланировано",
  done: "Проведено",
  cancelled: "Отменено",
  noShow: "Не пришёл",
};

export const STATUS_TONES = {
  planned: "neutral",
  done: "mint",
  cancelled: "coral",
  noShow: "amber",
};

export const SUBJECT_COLORS = [
  "indigo", "mint", "amber", "coral", "sky", "violet", "teal", "rose",
];

export const DEFAULT_SETTINGS = {
  workHours: {
    start: "08:00",
    end: "22:00",
    step: 30,
    workdays: [1, 2, 3, 4, 5, 6],
    showWeekends: true,
  },
  defaults: {
    duration: 60,
    rate: 1500,
  },
  view: {
    firstDay: 1,
    mode: "week",
  },
};

export const DEMO_SUBJECTS = [
  "Математика",
  "Русский язык",
  "Английский язык",
  "Физика",
  "Химия",
  "Информатика",
  "История",
  "Обществознание",
  "Биология",
  "Литература",
];

/** Ошибка проверки данных: поле + понятный текст. */
export class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

let databasePromise = null;

/* ---------- Открытие и миграции ---------- */

export function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      migrate(request.result, event.oldVersion, request.transaction);
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () => {
      databasePromise = null;
      reject(request.error || new Error("Не удалось открыть базу данных"));
    };

    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("База занята другой вкладкой. Закройте лишние вкладки и повторите."));
    };
  });

  return databasePromise;
}

// Ключ — версия, С КОТОРОЙ обновляемся. Прошлые шаги не переписываем.
const migrations = {
  0: (db) => {
    const students = db.createObjectStore(STORE_STUDENTS, { keyPath: "id" });
    students.createIndex("archived", "archived", { unique: false });
    students.createIndex("subject", "subject", { unique: false });
    students.createIndex("name", "name", { unique: false });

    const lessons = db.createObjectStore(STORE_LESSONS, { keyPath: "id" });
    lessons.createIndex("date", "date", { unique: false });
    lessons.createIndex("studentId", "studentId", { unique: false });
    lessons.createIndex("seriesId", "seriesId", { unique: false });
    lessons.createIndex("status", "status", { unique: false });
    lessons.createIndex("slot", "slot", { unique: false });
    // Уникальность только для занятий серии: у разовых поля occurrenceKey нет.
    lessons.createIndex("occurrenceKey", "occurrenceKey", { unique: true });

    const series = db.createObjectStore(STORE_SERIES, { keyPath: "id" });
    series.createIndex("studentId", "studentId", { unique: false });
    series.createIndex("active", "active", { unique: false });

    const notes = db.createObjectStore(STORE_NOTES, { keyPath: "id" });
    notes.createIndex("lessonId", "lessonId", { unique: true });
    notes.createIndex("studentId", "studentId", { unique: false });
    notes.createIndex("updatedAt", "updatedAt", { unique: false });

    db.createObjectStore(STORE_SETTINGS, { keyPath: "key" });

    const activity = db.createObjectStore(STORE_ACTIVITY, { keyPath: "id" });
    activity.createIndex("at", "at", { unique: false });
  },

  // Версия 2: имя и фамилия стали отдельными полями.
  // Существующие записи разбираем из старого поля name прямо в миграции.
  1: (db, transaction) => {
    const store = transaction.objectStore(STORE_STUDENTS);
    const cursorRequest = store.openCursor();

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;

      const student = cursor.value;
      if (!student.firstName) {
        const { firstName, lastName } = parseFullName(student.name);
        cursor.update({
          ...student,
          firstName,
          lastName,
          name: fullName({ firstName, lastName }),
        });
      }
      cursor.continue();
    };
  },
};

function migrate(db, oldVersion, transaction) {
  for (let version = oldVersion; version < DB_VERSION; version += 1) {
    const step = migrations[version];
    if (step) step(db, transaction);
  }
}

/* ---------- Вспомогательное ---------- */

export function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Операция отменена"));
  });
}

function getAll(db, storeName) {
  const transaction = db.transaction(storeName, "readonly");
  const request = transaction.objectStore(storeName).getAll();
  return requestToPromise(request);
}

export function slotKey(date, startTime) {
  return `${date}|${startTime}`;
}

function normalizeDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number / 15) * 15;
  if (rounded < 15 || rounded > 240) return null;
  return rounded;
}

/* ---------- Настройки ---------- */

export async function getSettings(db) {
  const records = await getAll(db, STORE_SETTINGS);
  const map = new Map(records.map((record) => [record.key, record.value]));

  return {
    workHours: { ...DEFAULT_SETTINGS.workHours, ...(map.get("workHours") || {}) },
    defaults: { ...DEFAULT_SETTINGS.defaults, ...(map.get("defaults") || {}) },
    view: { ...DEFAULT_SETTINGS.view, ...(map.get("view") || {}) },
  };
}

export async function saveSettings(db, patch = {}) {
  const current = await getSettings(db);
  const next = {
    workHours: { ...current.workHours, ...(patch.workHours || {}) },
    defaults: { ...current.defaults, ...(patch.defaults || {}) },
    view: { ...current.view, ...(patch.view || {}) },
  };

  const transaction = db.transaction(STORE_SETTINGS, "readwrite");
  const store = transaction.objectStore(STORE_SETTINGS);
  store.put({ key: "workHours", value: next.workHours });
  store.put({ key: "defaults", value: next.defaults });
  store.put({ key: "view", value: next.view });
  await transactionToPromise(transaction);
  return next;
}

/* ---------- Ученики ---------- */

/**
 * Разбирает строку «Фамилия Имя» на части, если раздельных полей нет.
 * Нужно для старых записей и старых файлов резервной копии.
 */
export function parseFullName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Отображаемое имя: сначала фамилия, затем имя. */
export function fullName(student) {
  const last = String(student?.lastName || "").trim();
  const first = String(student?.firstName || "").trim();
  if (last && first) return `${last} ${first}`;
  return first || last || "Ученик не найден";
}

export function createStudent(input = {}) {
  const hasParts = input.firstName !== undefined || input.lastName !== undefined;
  const parsed = hasParts
    ? {
        firstName: String(input.firstName || "").trim(),
        lastName: String(input.lastName || "").trim(),
      }
    : parseFullName(input.name);

  const { firstName, lastName } = parsed;

  if (firstName.length < 2) {
    throw new ValidationError("Имя — не короче 2 символов.", "firstName");
  }
  if (firstName.length > 40) {
    throw new ValidationError("Имя — не длиннее 40 символов.", "firstName");
  }
  if (lastName.length < 2) {
    throw new ValidationError("Фамилия — не короче 2 символов.", "lastName");
  }
  if (lastName.length > 40) {
    throw new ValidationError("Фамилия — не длиннее 40 символов.", "lastName");
  }

  const subject = String(input.subject || "").trim();
  if (!subject) throw new ValidationError("Укажите предмет занятий.", "subject");

  const contact = String(input.contact || "").trim();
  if (contact.length > 80) {
    throw new ValidationError("Контакт — не длиннее 80 символов.", "contact");
  }
  // Телефон может содержать пробелы и дефисы, ник и email — нет.
  if (contact && !/^[+\d(]/.test(contact) && /\s/.test(contact)) {
    throw new ValidationError("Ник или email пишутся без пробелов.", "contact");
  }

  const rate = Number(input.rate);
  if (!Number.isFinite(rate) || rate < 0) {
    throw new ValidationError("Ставка — число от 0 и выше.", "rate");
  }

  return {
    id: input.id || createId(),
    firstName,
    lastName,
    // Производное поле: по нему сортируем, ищем и показываем в расписании.
    name: fullName({ firstName, lastName }),
    subject,
    contact,
    rate: Math.round(rate),
    color: SUBJECT_COLORS.includes(input.color) ? input.color : SUBJECT_COLORS[0],
    comment: String(input.comment || "").trim(),
    archived: Boolean(input.archived),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function getAllStudents(db) {
  const students = await getAll(db, STORE_STUDENTS);
  return students.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export async function saveStudent(db, input) {
  const student = createStudent(input);
  const transaction = db.transaction(STORE_STUDENTS, "readwrite");
  transaction.objectStore(STORE_STUDENTS).put(student);
  await transactionToPromise(transaction);
  return student;
}

export async function setStudentArchived(db, id, archived) {
  const transaction = db.transaction(STORE_STUDENTS, "readwrite");
  const store = transaction.objectStore(STORE_STUDENTS);
  const student = await requestToPromise(store.get(id));
  if (!student) throw new Error("Ученик не найден.");
  student.archived = Boolean(archived);
  student.updatedAt = new Date().toISOString();
  store.put(student);
  await transactionToPromise(transaction);
  return student;
}

/* ---------- Занятия ---------- */

/**
 * Создаёт запись занятия и проверяет обязательные поля.
 * Без ученика занятие не создаётся ни при каких условиях.
 */
export function createLesson(input = {}) {
  const studentId = String(input.studentId || "").trim();
  if (!studentId) {
    throw new ValidationError("Выберите ученика — без него занятие создать нельзя.", "studentId");
  }

  const date = String(input.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ValidationError("Укажите дату занятия.", "date");
  }

  const startTime = String(input.startTime || "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
    throw new ValidationError("Укажите время начала занятия.", "startTime");
  }

  const duration = normalizeDuration(input.duration);
  if (duration === null) {
    throw new ValidationError("Длительность — от 15 до 240 минут, шаг 15.", "duration");
  }

  const status = STATUSES.includes(input.status) ? input.status : "planned";
  const price = Number.isFinite(Number(input.price))
    ? Math.max(0, Math.round(Number(input.price)))
    : 0;

  const seriesId = input.seriesId || null;
  const occurrenceDate = seriesId ? input.occurrenceDate || date : null;

  const lesson = {
    id: input.id || createId(),
    studentId,
    subject: String(input.subject || "").trim(),
    date,
    startTime,
    duration,
    status,
    price,
    paid: Boolean(input.paid),
    seriesId,
    occurrenceDate,
    detached: Boolean(input.detached),
    slot: slotKey(date, startTime),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Поле добавляем только занятиям серии: у разовых его нет,
  // иначе уникальный индекс начал бы их конфликтовать между собой.
  if (seriesId) lesson.occurrenceKey = `${seriesId}|${occurrenceDate}`;

  return lesson;
}

export async function getAllLessons(db) {
  const lessons = await getAll(db, STORE_LESSONS);
  return lessons.sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
}

export async function getLessonsInRange(db, from, to) {
  const transaction = db.transaction(STORE_LESSONS, "readonly");
  const index = transaction.objectStore(STORE_LESSONS).index("date");
  const records = await requestToPromise(index.getAll(IDBKeyRange.bound(from, to)));
  await transactionToPromise(transaction);
  return records;
}

export async function getLesson(db, id) {
  const transaction = db.transaction(STORE_LESSONS, "readonly");
  const lesson = await requestToPromise(transaction.objectStore(STORE_LESSONS).get(id));
  await transactionToPromise(transaction);
  return lesson || null;
}

export async function saveLesson(db, input) {
  const lesson = createLesson(input);
  const transaction = db.transaction(STORE_LESSONS, "readwrite");
  transaction.objectStore(STORE_LESSONS).put(lesson);
  await transactionToPromise(transaction);
  return lesson;
}

export async function deleteLesson(db, id) {
  const transaction = db.transaction([STORE_LESSONS, STORE_NOTES], "readwrite");
  transaction.objectStore(STORE_LESSONS).delete(id);
  const noteIndex = transaction.objectStore(STORE_NOTES).index("lessonId");
  const note = await requestToPromise(noteIndex.get(id));
  if (note) transaction.objectStore(STORE_NOTES).delete(note.id);
  await transactionToPromise(transaction);
}

/** Занятия, пересекающиеся с кандидатом по времени. */
export function findConflicts(lessons, candidate, { ignoreId = null } = {}) {
  const start = timeToMinutes(candidate.startTime);
  const end = start + (Number(candidate.duration) || 0);

  return lessons.filter((lesson) => {
    if (lesson.id === ignoreId) return false;
    if (lesson.date !== candidate.date) return false;
    if (lesson.status === "cancelled") return false;
    const otherStart = timeToMinutes(lesson.startTime);
    const otherEnd = otherStart + (Number(lesson.duration) || 0);
    return start < otherEnd && otherStart < end;
  });
}

/* ---------- Серии ---------- */

export function createSeriesRecord(input = {}) {
  const studentId = String(input.studentId || "").trim();
  if (!studentId) throw new ValidationError("У серии должен быть ученик.", "studentId");

  const weekdays = [...new Set((input.weekdays || []).map(Number))]
    .filter((day) => day >= 1 && day <= 7)
    .sort((a, b) => a - b);
  if (!weekdays.length) throw new ValidationError("Выберите хотя бы один день недели.", "weekdays");

  const startDate = String(input.startDate || "").trim();
  const endDate = String(input.endDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new ValidationError("Укажите дату начала серии.", "startDate");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
    throw new ValidationError("Дата окончания должна быть позже начала.", "endDate");
  }

  return {
    id: input.id || createId(),
    studentId,
    subject: String(input.subject || "").trim(),
    weekdays,
    startTime: input.startTime || "18:00",
    duration: normalizeDuration(input.duration) ?? 60,
    intervalWeeks: Math.max(1, Math.floor(Number(input.intervalWeeks) || 1)),
    startDate,
    endDate,
    active: input.active !== false,
    exceptions: Array.isArray(input.exceptions) ? [...new Set(input.exceptions)] : [],
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function getAllSeries(db) {
  return getAll(db, STORE_SERIES);
}

/** Создаёт серию и все её занятия одной транзакцией. */
export async function createSeries(db, seriesInput, lessonInputs = []) {
  const series = createSeriesRecord(seriesInput);
  const lessons = lessonInputs.map((input) =>
    createLesson({ ...input, seriesId: series.id, occurrenceDate: input.date })
  );

  const transaction = db.transaction([STORE_SERIES, STORE_LESSONS], "readwrite");
  transaction.objectStore(STORE_SERIES).add(series);
  const store = transaction.objectStore(STORE_LESSONS);
  for (const lesson of lessons) store.add(lesson);
  await transactionToPromise(transaction);

  return { series, lessons };
}

export async function updateSeries(db, input) {
  const series = createSeriesRecord(input);
  const transaction = db.transaction(STORE_SERIES, "readwrite");
  transaction.objectStore(STORE_SERIES).put(series);
  await transactionToPromise(transaction);
  return series;
}

export async function addSeriesException(db, seriesId, date) {
  const transaction = db.transaction(STORE_SERIES, "readwrite");
  const store = transaction.objectStore(STORE_SERIES);
  const series = await requestToPromise(store.get(seriesId));
  if (!series) {
    await transactionToPromise(transaction);
    return null;
  }
  const exceptions = new Set(series.exceptions || []);
  exceptions.add(date);
  series.exceptions = [...exceptions].sort();
  series.updatedAt = new Date().toISOString();
  store.put(series);
  await transactionToPromise(transaction);
  return series;
}

export async function setSeriesExceptions(db, seriesId, dates) {
  const transaction = db.transaction(STORE_SERIES, "readwrite");
  const store = transaction.objectStore(STORE_SERIES);
  const series = await requestToPromise(store.get(seriesId));
  if (!series) {
    await transactionToPromise(transaction);
    return null;
  }
  series.exceptions = [...new Set(dates || [])].sort();
  series.updatedAt = new Date().toISOString();
  store.put(series);
  await transactionToPromise(transaction);
  return series;
}

/** Заменяет занятия серии в диапазоне одной транзакцией. */
export async function replaceSeriesLessons(db, seriesId, removeIds, lessonInputs) {
  const transaction = db.transaction([STORE_LESSONS, STORE_NOTES], "readwrite");
  const lessonsStore = transaction.objectStore(STORE_LESSONS);
  const notesStore = transaction.objectStore(STORE_NOTES);

  for (const id of removeIds) {
    lessonsStore.delete(id);
    const note = await requestToPromise(notesStore.index("lessonId").get(id));
    if (note) notesStore.delete(note.id);
  }

  for (const input of lessonInputs) {
    lessonsStore.put(createLesson({
      ...input,
      seriesId,
      occurrenceDate: input.occurrenceDate || input.date,
    }));
  }

  await transactionToPromise(transaction);
  return lessonInputs.length;
}

/* ---------- Заметки ---------- */

export function createNote(input = {}) {
  const lessonId = String(input.lessonId || "").trim();
  if (!lessonId) throw new ValidationError("Заметка должна быть привязана к занятию.", "lessonId");

  return {
    id: input.id || createId(),
    lessonId,
    studentId: String(input.studentId || ""),
    text: String(input.text || "").trim(),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function getAllNotes(db) {
  return getAll(db, STORE_NOTES);
}

export async function getNoteForLesson(db, lessonId) {
  const transaction = db.transaction(STORE_NOTES, "readonly");
  const note = await requestToPromise(
    transaction.objectStore(STORE_NOTES).index("lessonId").get(lessonId)
  );
  await transactionToPromise(transaction);
  return note || null;
}

/** Пустой текст удаляет заметку. Возвращает запись или null. */
export async function saveNoteForLesson(db, { lessonId, studentId, text, id = null }) {
  const clean = String(text || "").trim();
  const transaction = db.transaction(STORE_NOTES, "readwrite");
  const store = transaction.objectStore(STORE_NOTES);
  const existing = await requestToPromise(store.index("lessonId").get(lessonId));

  if (!clean) {
    if (existing) store.delete(existing.id);
    await transactionToPromise(transaction);
    return null;
  }

  const note = createNote({
    id: existing?.id || id || undefined,
    lessonId,
    studentId,
    text: clean,
    createdAt: existing?.createdAt,
  });
  store.put(note);
  await transactionToPromise(transaction);
  return note;
}

export async function deleteNote(db, id) {
  const transaction = db.transaction(STORE_NOTES, "readwrite");
  transaction.objectStore(STORE_NOTES).delete(id);
  await transactionToPromise(transaction);
}

/* ---------- Журнал действий ---------- */

export async function addActivity(db, entry = {}) {
  const record = {
    id: createId(),
    type: entry.type || "info",
    message: String(entry.message || ""),
    at: new Date().toISOString(),
  };

  const transaction = db.transaction(STORE_ACTIVITY, "readwrite");
  const store = transaction.objectStore(STORE_ACTIVITY);
  store.add(record);
  const count = await requestToPromise(store.count());
  if (count > ACTIVITY_LIMIT) {
    const excess = count - ACTIVITY_LIMIT;
    let removed = 0;
    await new Promise((resolve) => {
      const cursorRequest = store.index("at").openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || removed >= excess) return resolve();
        cursor.delete();
        removed += 1;
        cursor.continue();
      };
      cursorRequest.onerror = () => resolve();
    });
  }
  await transactionToPromise(transaction);
  return record;
}

export async function getRecentActivity(db, limit = 20) {
  const transaction = db.transaction(STORE_ACTIVITY, "readonly");
  const store = transaction.objectStore(STORE_ACTIVITY);
  const result = [];
  await new Promise((resolve) => {
    const cursorRequest = store.index("at").openCursor(null, "prev");
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || result.length >= limit) return resolve();
      result.push(cursor.value);
      cursor.continue();
    };
    cursorRequest.onerror = () => resolve();
  });
  await transactionToPromise(transaction);
  return result;
}

/* ---------- Резервная копия ---------- */

export async function exportData(db) {
  const [students, lessons, series, notes, settings, activity] = await Promise.all([
    getAll(db, STORE_STUDENTS),
    getAll(db, STORE_LESSONS),
    getAll(db, STORE_SERIES),
    getAll(db, STORE_NOTES),
    getAll(db, STORE_SETTINGS),
    getAll(db, STORE_ACTIVITY),
  ]);

  return {
    app: "TutorFlow",
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      students: students.length,
      lessons: lessons.length,
      series: series.length,
      notes: notes.length,
    },
    students,
    lessons,
    series,
    notes,
    settings,
    activity,
  };
}

export function validateBackup(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Файл не похож на резервную копию TutorFlow.");
  }
  if (data.app && data.app !== "TutorFlow") {
    throw new Error("Это копия другого приложения.");
  }
  if (Number(data.schemaVersion) > DB_VERSION) {
    throw new Error("Копия сделана в более новой версии приложения.");
  }
  if (!Array.isArray(data.students) || !Array.isArray(data.lessons)) {
    throw new Error("В файле нет списка учеников или занятий.");
  }

  return {
    students: data.students,
    lessons: data.lessons,
    series: Array.isArray(data.series) ? data.series : [],
    notes: Array.isArray(data.notes) ? data.notes : [],
    settings: Array.isArray(data.settings) ? data.settings : [],
    activity: Array.isArray(data.activity) ? data.activity : [],
  };
}

/** Полная замена данных одной транзакцией. */
export async function importData(db, backup) {
  const data = validateBackup(backup);
  const stores = [
    STORE_STUDENTS, STORE_LESSONS, STORE_SERIES,
    STORE_NOTES, STORE_SETTINGS, STORE_ACTIVITY,
  ];

  const transaction = db.transaction(stores, "readwrite");
  stores.forEach((name) => transaction.objectStore(name).clear());

  const studentsStore = transaction.objectStore(STORE_STUDENTS);
  let students = 0;
  for (const raw of data.students) {
    try {
      studentsStore.put(createStudent(raw));
      students += 1;
    } catch {
      // повреждённая запись пропускается, остальное импортируется
    }
  }

  const studentIds = new Set(
    [...data.students].filter((item) => item && item.id).map((item) => item.id)
  );

  const lessonsStore = transaction.objectStore(STORE_LESSONS);
  let lessons = 0;
  for (const raw of data.lessons) {
    try {
      const lesson = createLesson(raw);
      if (!studentIds.has(lesson.studentId)) continue;
      lessonsStore.put(lesson);
      lessons += 1;
    } catch {
      // занятие без ученика или с битой датой не импортируется
    }
  }

  const seriesStore = transaction.objectStore(STORE_SERIES);
  let series = 0;
  for (const raw of data.series) {
    try {
      seriesStore.put(createSeriesRecord(raw));
      series += 1;
    } catch {
      // некорректное правило пропускается
    }
  }

  const notesStore = transaction.objectStore(STORE_NOTES);
  let notes = 0;
  for (const raw of data.notes) {
    try {
      notesStore.put(createNote(raw));
      notes += 1;
    } catch {
      // заметка без занятия пропускается
    }
  }

  const settingsStore = transaction.objectStore(STORE_SETTINGS);
  for (const raw of data.settings) {
    if (raw && raw.key) settingsStore.put({ key: raw.key, value: raw.value });
  }

  const activityStore = transaction.objectStore(STORE_ACTIVITY);
  for (const raw of data.activity.slice(-ACTIVITY_LIMIT)) {
    if (!raw || !raw.id) continue;
    activityStore.put({
      id: raw.id,
      type: raw.type || "info",
      message: String(raw.message || ""),
      at: raw.at || new Date().toISOString(),
    });
  }

  await transactionToPromise(transaction);
  return { students, lessons, series, notes };
}

export async function clearAll(db) {
  const stores = [
    STORE_STUDENTS, STORE_LESSONS, STORE_SERIES,
    STORE_NOTES, STORE_SETTINGS, STORE_ACTIVITY,
  ];
  const transaction = db.transaction(stores, "readwrite");
  stores.forEach((name) => transaction.objectStore(name).clear());
  await transactionToPromise(transaction);
}

/* ---------- Демонстрационные данные ---------- */

const DEMO_STUDENTS = [
  {
    firstName: "Анна",
    lastName: "Ковалёва",
    subject: "Математика",
    contact: "+7 916 240-18-32",
    rate: 2200,
    color: "indigo",
    comment: "Подготовка к ЕГЭ, профильный уровень. Сильная, но торопится в вычислениях.",
  },
  {
    firstName: "Марк",
    lastName: "Лебедев",
    subject: "Физика",
    contact: "@mark_lebedev",
    rate: 2000,
    color: "sky",
    comment: "10 класс, олимпиадные задачи. Любит разбираться в сути, не любит формулы без объяснения.",
  },
  {
    firstName: "Софья",
    lastName: "Ильина",
    subject: "Английский язык",
    contact: "sofia.ilina@mail.ru",
    rate: 1800,
    color: "mint",
    comment: "Готовится к IELTS, упор на speaking.",
  },
  {
    firstName: "Тимур",
    lastName: "Сафин",
    subject: "Информатика",
    contact: "+7 903 118-55-07",
    rate: 2400,
    color: "violet",
    comment: "ЕГЭ по информатике, программирование на Python. Иногда пропускает по тренировкам.",
  },
  {
    firstName: "Елизавета",
    lastName: "Громова",
    subject: "Русский язык",
    contact: "+7 925 771-04-16",
    rate: 1600,
    color: "amber",
    comment: "9 класс, сочинение и изложение.",
  },
  {
    firstName: "Никита",
    lastName: "Орлов",
    subject: "Химия",
    contact: "nikita.orlov@yandex.ru",
    rate: 1900,
    color: "coral",
    comment: "10 класс, подтягиваем органику.",
  },
];

// weekday: 1 — понедельник … 7 — воскресенье
const DEMO_PLAN = [
  { student: 0, weekday: 1, time: "16:00", duration: 60 },
  { student: 0, weekday: 3, time: "16:00", duration: 60 },
  { student: 1, weekday: 1, time: "18:00", duration: 90 },
  { student: 1, weekday: 4, time: "18:00", duration: 90 },
  { student: 2, weekday: 2, time: "15:00", duration: 60 },
  { student: 2, weekday: 5, time: "15:00", duration: 60 },
  { student: 3, weekday: 2, time: "17:30", duration: 60 },
  { student: 3, weekday: 6, time: "11:00", duration: 60 },
  { student: 4, weekday: 3, time: "19:00", duration: 45 },
  { student: 4, weekday: 6, time: "13:00", duration: 45 },
  { student: 5, weekday: 4, time: "16:00", duration: 60 },
  { student: 5, weekday: 7, time: "12:00", duration: 60 },
];

const DEMO_NOTES = [
  { student: 0, weekday: 1, offset: -1, text: "Разобрали параметр в задачах 18. Дома: № 18.3, 18.4, 18.7. Проверить оформление." },
  { student: 1, weekday: 4, offset: -1, text: "Не успели разобрать блок про магнитное поле. Перенести на следующее занятие." },
  { student: 2, weekday: 2, offset: -1, text: "Speaking part 2: говорила уверенно, но мало деталей. Дома — три монолога по 2 минуты." },
  { student: 3, weekday: 6, offset: -1, text: "Решали задачу 27. Ошибся в проверке условия выхода из цикла — повторить." },
];

/**
 * Заполняет базу демонстрационными данными.
 * Все записи вымышленные, реальные персональные данные не используются.
 */
export async function seedDemoData(db) {
  await clearAll(db);

  const today = todayISO();
  const weekStart = startOfWeek(today, 1);
  const now = new Date().toISOString();

  const students = DEMO_STUDENTS.map((item) => createStudent({ ...item, createdAt: now }));
  const lessons = [];
  const notes = [];

  // Марк занимается по повторяющемуся расписанию: Пн и Чт 18:00.
  // Так в демо видно, как выглядит серия, и её можно потрогать.
  const demoSeriesIndex = 1;
  const demoSeries = createSeriesRecord({
    studentId: students[demoSeriesIndex].id,
    subject: students[demoSeriesIndex].subject,
    weekdays: [1, 4],
    intervalWeeks: 1,
    startTime: "18:00",
    duration: 90,
    startDate: addDays(weekStart, -14),
    endDate: addDays(weekStart, 14),
    createdAt: now,
  });

  for (const offset of [-2, -1, 0, 1, 2]) {
    for (const plan of DEMO_PLAN) {
      const date = addDays(weekStart, (plan.weekday - 1) + offset * 7);
      const student = students[plan.student];
      const isPast = date < today;
      const inDemoSeries = plan.student === demoSeriesIndex;

      let status = "planned";
      let paid = false;
      if (isPast) {
        status = "done";
        paid = true;
      }

      // немного разнообразия: отмена и неявка
      if (isPast && plan.student === 3 && plan.weekday === 6 && offset === -1) {
        status = "cancelled";
        paid = false;
      }
      if (isPast && plan.student === 5 && plan.weekday === 7 && offset === -2) {
        status = "noShow";
        paid = false;
      }

      lessons.push(createLesson({
        studentId: student.id,
        subject: student.subject,
        date,
        startTime: plan.time,
        duration: plan.duration,
        status,
        price: Math.round((student.rate * plan.duration) / 60 / 10) * 10,
        paid,
        seriesId: inDemoSeries ? demoSeries.id : null,
        occurrenceDate: inDemoSeries ? date : null,
      }));
    }
  }

  for (const demo of DEMO_NOTES) {
    const date = addDays(weekStart, (demo.weekday - 1) + demo.offset * 7);
    const lesson = lessons.find(
      (item) => item.studentId === students[demo.student].id && item.date === date
    );
    if (!lesson) continue;
    notes.push(createNote({
      lessonId: lesson.id,
      studentId: lesson.studentId,
      text: demo.text,
    }));
  }

  const transaction = db.transaction(
    [STORE_STUDENTS, STORE_LESSONS, STORE_SERIES, STORE_NOTES, STORE_SETTINGS, STORE_ACTIVITY],
    "readwrite"
  );

  const studentsStore = transaction.objectStore(STORE_STUDENTS);
  students.forEach((student) => studentsStore.put(student));

  transaction.objectStore(STORE_SERIES).put(demoSeries);

  const lessonsStore = transaction.objectStore(STORE_LESSONS);
  lessons.forEach((lesson) => lessonsStore.put(lesson));

  const notesStore = transaction.objectStore(STORE_NOTES);
  notes.forEach((note) => notesStore.put(note));

  const settingsStore = transaction.objectStore(STORE_SETTINGS);
  settingsStore.put({ key: "workHours", value: DEFAULT_SETTINGS.workHours });
  settingsStore.put({ key: "defaults", value: DEFAULT_SETTINGS.defaults });
  settingsStore.put({ key: "view", value: DEFAULT_SETTINGS.view });

  transaction.objectStore(STORE_ACTIVITY).put({
    id: createId(),
    type: "demo",
    message: "Загружены демонстрационные данные",
    at: now,
  });

  await transactionToPromise(transaction);

  return { students: students.length, lessons: lessons.length, notes: notes.length };
}
