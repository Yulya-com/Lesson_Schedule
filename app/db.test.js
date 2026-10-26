// db.test.js — проверка моделей ученика и занятия без браузера.
// Здесь только чистые функции: IndexedDB не нужен.
// Запуск: node --test app/db.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseFullName,
  fullName,
  createStudent,
  createLesson,
  ValidationError,
  DB_VERSION,
} from "./db.js";

/* ---------- Имя и фамилия ---------- */

test("старое поле name разбирается на фамилию и имя", () => {
  assert.deepEqual(parseFullName("Анна Ковалёва"), { firstName: "Анна", lastName: "Ковалёва" });
  assert.deepEqual(parseFullName("Анна Мария Ковалёва"), { firstName: "Анна", lastName: "Мария Ковалёва" });
  assert.deepEqual(parseFullName("  Анна   Ковалёва  "), { firstName: "Анна", lastName: "Ковалёва" });
});

test("одно слово и пустая строка не ломают разбор", () => {
  assert.deepEqual(parseFullName("Анна"), { firstName: "Анна", lastName: "" });
  assert.deepEqual(parseFullName(""), { firstName: "", lastName: "" });
  assert.deepEqual(parseFullName(null), { firstName: "", lastName: "" });
});

test("в расписании сначала фамилия, потом имя", () => {
  assert.equal(fullName({ firstName: "Анна", lastName: "Ковалёва" }), "Ковалёва Анна");
  assert.equal(fullName({ firstName: "Анна", lastName: "" }), "Анна");
  assert.equal(fullName({ firstName: "", lastName: "Ковалёва" }), "Ковалёва");
});

test("ученик создаётся из имени и фамилии, поле name собирается само", () => {
  const student = createStudent({
    firstName: "Анна",
    lastName: "Ковалёва",
    subject: "Математика",
    rate: 2200,
  });

  assert.equal(student.firstName, "Анна");
  assert.equal(student.lastName, "Ковалёва");
  assert.equal(student.name, "Ковалёва Анна");
  assert.equal(student.rate, 2200);
});

test("без фамилии ученик не создаётся", () => {
  assert.throws(
    () => createStudent({ firstName: "Анна", lastName: "", subject: "Математика", rate: 1000 }),
    (error) => error instanceof ValidationError && error.field === "lastName"
  );
});

test("без имени ученик не создаётся", () => {
  assert.throws(
    () => createStudent({ firstName: "", lastName: "Ковалёва", subject: "Математика", rate: 1000 }),
    (error) => error instanceof ValidationError && error.field === "firstName"
  );
});

test("старый формат записи с одним полем name принимается", () => {
  const student = createStudent({
    name: "Марк Лебедев",
    subject: "Физика",
    rate: 2000,
  });

  assert.equal(student.firstName, "Марк");
  assert.equal(student.lastName, "Лебедев");
  assert.equal(student.name, "Лебедев Марк");
});

test("схема хранилища обновлена до версии 2", () => {
  assert.equal(DB_VERSION, 2);
});

/* ---------- Занятие ---------- */

const base = {
  studentId: "student-1",
  date: "2026-11-05",
  startTime: "15:30",
  duration: 60,
  price: 2500,
};

test("занятие без ученика создать нельзя", () => {
  const { studentId, ...withoutStudent } = base;
  assert.throws(
    () => createLesson(withoutStudent),
    (error) => error instanceof ValidationError && error.field === "studentId"
  );
});

test("пустой studentId тоже не проходит", () => {
  assert.throws(
    () => createLesson({ ...base, studentId: "   " }),
    (error) => error instanceof ValidationError && error.field === "studentId"
  );
});

test("занятие без даты и без времени создать нельзя", () => {
  assert.throws(
    () => createLesson({ ...base, date: "" }),
    (error) => error instanceof ValidationError && error.field === "date"
  );
  assert.throws(
    () => createLesson({ ...base, startTime: "" }),
    (error) => error instanceof ValidationError && error.field === "startTime"
  );
});

test("длительность вне 15–240 минут отклоняется", () => {
  assert.throws(() => createLesson({ ...base, duration: 7 }), ValidationError);
  assert.throws(() => createLesson({ ...base, duration: 300 }), ValidationError);
  assert.equal(createLesson({ ...base, duration: 90 }).duration, 90);
});

test("корректное занятие получает ключ слота", () => {
  const lesson = createLesson(base);
  assert.equal(lesson.slot, "2026-11-05|15:30");
  assert.equal(lesson.status, "planned");
  assert.equal(lesson.paid, false);
  // У разового занятия нет occurrenceKey, иначе уникальный индекс мешал бы им.
  assert.equal("occurrenceKey" in lesson, false);
});

test("занятие серии получает occurrenceKey", () => {
  const lesson = createLesson({ ...base, seriesId: "series-1" });
  assert.equal(lesson.occurrenceKey, "series-1|2026-11-05");
});
