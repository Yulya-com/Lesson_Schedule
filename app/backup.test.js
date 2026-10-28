// backup.test.js — проверка модуля автоматической копии.
// Полный цикл (выбор папки, запись файла) требует настоящего браузера с
// File System Access API, поэтому здесь покрыто то, что проверяется без него:
// имя файла, поддержка в текущем окружении и безопасное поведение без API.
// Запуск: node --test app/backup.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { isSupported, fileNameFor, loadFolder, queryPermission, getLastSave } from "./backup.js";

test("имя файла копии содержит дату", () => {
  assert.equal(fileNameFor("2026-10-28"), "tutorflow-копия-2026-10-28.json");
});

test("имя файла копии за разные дни различается", () => {
  assert.notEqual(fileNameFor("2026-10-28"), fileNameFor("2026-10-29"));
});

test("в Node без браузера функция не заявляет поддержку", () => {
  assert.equal(isSupported(), false);
});

test("без браузерного API папка не загружается", async () => {
  assert.equal(await loadFolder(), null);
});

test("без дескриптора разрешение считается запрещённым", async () => {
  assert.equal(await queryPermission(null), "denied");
  assert.equal(await queryPermission({}), "denied");
});

test("без браузерного API сведений о копии нет", async () => {
  assert.equal(await getLastSave(), null);
});
