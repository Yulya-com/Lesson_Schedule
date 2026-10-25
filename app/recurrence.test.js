// recurrence.test.js — проверка правил повтора и арифметики дат.
// Запуск: node --test app/recurrence.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOccurrences,
  addDays,
  addMonths,
  diffDays,
  weekdayIndex,
  startOfWeek,
  monthGrid,
  timeToMinutes,
  minutesToTime,
  formatWeekRange,
  MAX_OCCURRENCES,
} from "./recurrence.js";

test("недельный повтор по понедельникам", () => {
  const { dates } = buildOccurrences({
    startDate: "2026-10-05",
    endDate: "2026-10-26",
    weekdays: [1],
  });
  assert.deepEqual(dates, ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
});

test("два дня в неделю", () => {
  const { dates } = buildOccurrences({
    startDate: "2026-10-05",
    endDate: "2026-10-18",
    weekdays: [1, 3],
  });
  assert.deepEqual(dates, [
    "2026-10-05", "2026-10-07",
    "2026-10-12", "2026-10-14",
  ]);
});

test("через неделю: берётся только каждая вторая неделя", () => {
  const { dates } = buildOccurrences({
    startDate: "2026-10-05",
    endDate: "2026-11-02",
    weekdays: [1],
    intervalWeeks: 2,
  });
  assert.deepEqual(dates, ["2026-10-05", "2026-10-19", "2026-11-02"]);
});

test("через неделю при двух днях недели", () => {
  const { dates } = buildOccurrences({
    startDate: "2026-10-05",
    endDate: "2026-10-26",
    weekdays: [1, 3],
    intervalWeeks: 2,
  });
  assert.deepEqual(dates, [
    "2026-10-05", "2026-10-07",
    "2026-10-19", "2026-10-21",
  ]);
});

test("дата старта не совпадает с днём правила — серия начинается позже", () => {
  const { dates } = buildOccurrences({
    startDate: "2026-10-06",
    endDate: "2026-10-20",
    weekdays: [1],
  });
  assert.deepEqual(dates, ["2026-10-12", "2026-10-19"]);
});

test("пустой список дней даёт пустую серию", () => {
  const result = buildOccurrences({ startDate: "2026-10-05", endDate: "2026-12-31", weekdays: [] });
  assert.deepEqual(result.dates, []);
  assert.equal(result.truncated, false);
});

test("некорректные дни недели отбрасываются", () => {
  const { dates } = buildOccurrences({
    startDate: "2026-10-05",
    endDate: "2026-10-12",
    weekdays: [0, 1, 9, 3],
  });
  assert.deepEqual(dates, ["2026-10-05", "2026-10-07", "2026-10-12"]);
});

test("лимит 400 занятий включает флаг обрезки", () => {
  const { dates, total, truncated } = buildOccurrences({
    startDate: "2026-01-05",
    endDate: "2029-12-31",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  assert.equal(dates.length, MAX_OCCURRENCES);
  assert.ok(total > MAX_OCCURRENCES);
  assert.equal(truncated, true);
});

test("без даты окончания серия ограничена предохранителем", () => {
  const { dates, truncated } = buildOccurrences({
    startDate: "2026-01-05",
    weekdays: [1],
    maxCount: 10,
  });
  assert.equal(dates.length, 10);
  assert.equal(truncated, true);
});

test("серия не выходит за дату окончания", () => {
  const { dates } = buildOccurrences({
    startDate: "2026-10-05",
    endDate: "2026-10-19",
    weekdays: [1],
  });
  assert.equal(dates.at(-1), "2026-10-19");
  assert.ok(!dates.includes("2026-10-26"));
});

test("день недели: воскресенье — это 7", () => {
  assert.equal(weekdayIndex("2026-10-25"), 7);
  assert.equal(weekdayIndex("2026-10-26"), 1);
});

test("начало недели — понедельник", () => {
  assert.equal(startOfWeek("2026-10-25", 1), "2026-10-19");
  assert.equal(startOfWeek("2026-10-25", 7), "2026-10-25");
});

test("арифметика дат переходит через месяц и год", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(diffDays("2026-10-01", "2026-10-31"), 30);
});

test("високосный год", () => {
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2028-02-29", 1), "2028-03-01");
});

test("сдвиг на месяц не выходит за границу месяца", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
});

test("сетка месяца начинается с понедельника и содержит все дни", () => {
  const days = monthGrid("2026-10-15", 1);
  assert.equal(days.length % 7, 0);
  assert.equal(weekdayIndex(days[0]), 1);
  assert.ok(days.includes("2026-10-01"));
  assert.ok(days.includes("2026-10-31"));
});

test("время: перевод минут в строку и обратно", () => {
  assert.equal(timeToMinutes("18:30"), 1110);
  assert.equal(minutesToTime(1110), "18:30");
  assert.equal(minutesToTime(0), "00:00");
  assert.equal(minutesToTime(1439), "23:59");
});

test("подпись диапазона недели", () => {
  assert.equal(formatWeekRange("2026-10-19", "2026-10-25"), "19–25 октября 2026");
  assert.equal(formatWeekRange("2026-10-26", "2026-11-01"), "26 октября – 1 ноября 2026");
});
