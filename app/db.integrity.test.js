// db.integrity.test.js — проверка целостности и безопасности данных.
// Покрывает то, что раньше не было под тестами: пересечения занятий,
// валидацию резервной копии, правила серий, лимиты длины и настройки.
// Запуск: node --test app/db.integrity.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  findConflicts,
  validateBackup,
  sanitizeWorkHours,
  sanitizeDefaults,
  sanitizeView,
  sanitizeSettingsRecords,
  createSeriesRecord,
  createStudent,
  createNote,
  createLesson,
  ValidationError,
  DEFAULT_SETTINGS,
  LIMITS,
  DB_VERSION,
} from "./db.js";

/* ---------- Пересечения занятий ---------- */

const lesson = (over = {}) => ({
  id: "l1",
  studentId: "s1",
  date: "2026-11-05",
  startTime: "10:00",
  duration: 60,
  status: "planned",
  ...over,
});

test("пересечение по времени находится", () => {
  const existing = [lesson()];
  const found = findConflicts(existing, { date: "2026-11-05", startTime: "10:30", duration: 60 });
  assert.equal(found.length, 1);
});

test("стык занятий не считается пересечением", () => {
  const existing = [lesson()];
  // 10:00–11:00 и 11:00–12:00 — границы соприкасаются, но не пересекаются
  const found = findConflicts(existing, { date: "2026-11-05", startTime: "11:00", duration: 60 });
  assert.equal(found.length, 0);
});

test("другой день не даёт пересечения", () => {
  const existing = [lesson()];
  const found = findConflicts(existing, { date: "2026-11-06", startTime: "10:00", duration: 60 });
  assert.equal(found.length, 0);
});

test("отменённое занятие не блокирует время", () => {
  const existing = [lesson({ status: "cancelled" })];
  const found = findConflicts(existing, { date: "2026-11-05", startTime: "10:00", duration: 60 });
  assert.equal(found.length, 0);
});

test("собственное занятие исключается по ignoreId", () => {
  const existing = [lesson()];
  const found = findConflicts(
    existing,
    { date: "2026-11-05", startTime: "10:00", duration: 60 },
    { ignoreId: "l1" }
  );
  assert.equal(found.length, 0);
});

test("короткое занятие внутри длинного тоже пересекается", () => {
  const existing = [lesson({ duration: 120 })]; // 10:00–12:00
  const found = findConflicts(existing, { date: "2026-11-05", startTime: "10:15", duration: 15 });
  assert.equal(found.length, 1);
});

/* ---------- Валидация резервной копии ---------- */

test("копия без версии схемы отклоняется", () => {
  assert.throws(
    () => validateBackup({ app: "TutorFlow", students: [], lessons: [] }),
    /версия схемы/
  );
});

test("копия с версией из будущего отклоняется", () => {
  assert.throws(
    () => validateBackup({ app: "TutorFlow", schemaVersion: DB_VERSION + 1, students: [], lessons: [] }),
    /более новой версии/
  );
});

test("копия другого приложения отклоняется", () => {
  assert.throws(
    () => validateBackup({ app: "Other", schemaVersion: 1, students: [], lessons: [] }),
    /другого приложения/
  );
});

test("копия без списков отклоняется", () => {
  assert.throws(
    () => validateBackup({ app: "TutorFlow", schemaVersion: 1, students: [] }),
    /нет списка/
  );
});

test("не-объект отклоняется", () => {
  assert.throws(() => validateBackup(null), /не похож/);
  assert.throws(() => validateBackup([]), /не похож/);
});

test("корректная копия принимается, отсутствующие разделы становятся пустыми", () => {
  const result = validateBackup({ app: "TutorFlow", schemaVersion: 1, students: [], lessons: [] });
  assert.deepEqual(result.series, []);
  assert.deepEqual(result.notes, []);
  assert.deepEqual(result.settings, []);
});

test("результат validateBackup проходит проверку повторно", () => {
  // Интерфейс проверяет файл, а затем передаёт результат в importData,
  // который проверяет его ещё раз. Если версия схемы теряется,
  // импорт отменяется всегда — этот тест ловит такую регрессию.
  const once = validateBackup({ app: "TutorFlow", schemaVersion: 2, students: [], lessons: [] });
  const twice = validateBackup(once);
  assert.equal(twice.schemaVersion, DB_VERSION);
  assert.equal(twice.app, "TutorFlow");
});

/* ---------- Настройки ---------- */

test("мусор в рабочих часах заменяется значениями по умолчанию", () => {
  const result = sanitizeWorkHours({ start: "abc", end: "xyz", step: 7, workdays: [0, 9] });
  assert.equal(result.start, DEFAULT_SETTINGS.workHours.start);
  assert.equal(result.end, DEFAULT_SETTINGS.workHours.end);
  assert.equal(result.step, DEFAULT_SETTINGS.workHours.step);
  assert.deepEqual(result.workdays, DEFAULT_SETTINGS.workHours.workdays);
});

test("корректные рабочие часы сохраняются", () => {
  const result = sanitizeWorkHours({ start: "09:00", end: "20:00", step: 60, workdays: [1, 3, 5] });
  assert.equal(result.start, "09:00");
  assert.equal(result.end, "20:00");
  assert.equal(result.step, 60);
  assert.deepEqual(result.workdays, [1, 3, 5]);
});

test("конец дня раньше начала не допускается", () => {
  const result = sanitizeWorkHours({ start: "18:00", end: "09:00" });
  assert.ok(result.end > result.start);
});

test("отрицательная ставка заменяется значением по умолчанию", () => {
  const result = sanitizeDefaults({ duration: 999, rate: -5 });
  assert.equal(result.duration, DEFAULT_SETTINGS.defaults.duration);
  assert.equal(result.rate, DEFAULT_SETTINGS.defaults.rate);
});

test("режим вида проверяется по списку", () => {
  assert.equal(sanitizeView({ mode: "week" }).mode, "week");
  assert.equal(sanitizeView({ mode: "month" }).mode, "month");
  assert.equal(sanitizeView({ mode: "list" }).mode, "list");
  assert.equal(sanitizeView({ mode: "hack" }).mode, DEFAULT_SETTINGS.view.mode);
});

test("настройки собираются из записей и чистятся", () => {
  const result = sanitizeSettingsRecords([
    { key: "workHours", value: { start: "08:00", end: "22:00", step: 30 } },
    { key: "defaults", value: null },
    { key: "view", value: { mode: "list" } },
    { key: null, value: "мусор" },
  ]);
  assert.equal(result.view.mode, "list");
  assert.equal(result.defaults.duration, DEFAULT_SETTINGS.defaults.duration);
});

/* ---------- Серии ---------- */

test("серия без дней недели отклоняется", () => {
  assert.throws(
    () => createSeriesRecord({ studentId: "s1", weekdays: [], startDate: "2026-11-01", endDate: "2026-12-01" }),
    (error) => error instanceof ValidationError && error.field === "weekdays"
  );
});

test("серия с концом раньше начала отклоняется", () => {
  assert.throws(
    () => createSeriesRecord({
      studentId: "s1", weekdays: [1], startDate: "2026-12-01", endDate: "2026-11-01",
    }),
    (error) => error instanceof ValidationError && error.field === "endDate"
  );
});

test("серия без ученика отклоняется", () => {
  assert.throws(
    () => createSeriesRecord({ weekdays: [1], startDate: "2026-11-01", endDate: "2026-12-01" }),
    (error) => error instanceof ValidationError && error.field === "studentId"
  );
});

test("корректная серия нормализует дни и интервал", () => {
  const series = createSeriesRecord({
    studentId: "s1",
    weekdays: [5, 1, 1, 9],
    intervalWeeks: 0,
    startDate: "2026-11-01",
    endDate: "2026-12-01",
  });
  assert.deepEqual(series.weekdays, [1, 5]);
  assert.equal(series.intervalWeeks, 1);
});

/* ---------- Лимиты длины ---------- */

test("слишком длинная заметка отклоняется", () => {
  const text = "а".repeat(LIMITS.noteText + 1);
  assert.throws(
    () => createNote({ lessonId: "l1", text }),
    (error) => error instanceof ValidationError && error.field === "text"
  );
});

test("заметка в пределах лимита принимается", () => {
  const text = "а".repeat(LIMITS.noteText);
  assert.equal(createNote({ lessonId: "l1", text }).text.length, LIMITS.noteText);
});

test("слишком длинный предмет и комментарий отклоняются", () => {
  assert.throws(
    () => createStudent({
      firstName: "Анна", lastName: "Ковалёва", subject: "я".repeat(LIMITS.subject + 1), rate: 1000,
    }),
    (error) => error instanceof ValidationError && error.field === "subject"
  );

  assert.throws(
    () => createStudent({
      firstName: "Анна", lastName: "Ковалёва", subject: "Математика", rate: 1000,
      comment: "я".repeat(LIMITS.comment + 1),
    }),
    (error) => error instanceof ValidationError && error.field === "comment"
  );
});

test("комментарий в пределах лимита сохраняется", () => {
  const comment = "я".repeat(LIMITS.comment);
  const student = createStudent({
    firstName: "Анна", lastName: "Ковалёва", subject: "Математика", rate: 1000, comment,
  });
  assert.equal(student.comment.length, LIMITS.comment);
});

/* ---------- Ссылочная целостность (на уровне модели) ---------- */

test("занятие с пустым studentId отклоняется до записи", () => {
  assert.throws(
    () => createLesson({ studentId: "", date: "2026-11-05", startTime: "10:00", duration: 60 }),
    (error) => error instanceof ValidationError && error.field === "studentId"
  );
});

test("заметка без lessonId отклоняется", () => {
  assert.throws(
    () => createNote({ lessonId: "", text: "текст" }),
    (error) => error instanceof ValidationError && error.field === "lessonId"
  );
});
