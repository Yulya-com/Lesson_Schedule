// serve.test.js — проверка сервера как чёрного ящика.
// Запускает настоящий serve.js на свободном порту и проверяет то, что
// закрывали находки аудита №2 (падение от битого URL), №3 (доступ вне app/)
// и №16 (заголовки безопасности). Внутренности сервера не импортируются,
// поэтому тест не мешает его устройству и не требует рефакторинга.
//
// Запуск: node --test serve.test.js

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = fileURLToPath(new URL(".", import.meta.url));

let server;
let port;

/** Просит у ОС свободный порт, чтобы тест не конфликтовал с рабочим сервером. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
}

/** GET без нормализации пути: fetch схлопнул бы «../» до отправки. */
function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET" },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/** Ждёт, пока сервер начнёт принимать соединения. */
async function waitUntilReady(attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    const alive = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1");
      socket.on("connect", () => { socket.destroy(); resolve(true); });
      socket.on("error", () => resolve(false));
      socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
    });
    if (alive) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Сервер не запустился за отведённое время");
}

before(async () => {
  port = await findFreePort();
  server = spawn(process.execPath, ["serve.js"], {
    cwd: PROJECT_DIR,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitUntilReady();
});

after(() => {
  if (server && !server.killed) server.kill();
});

/* ---------- Доступное ---------- */

test("главная страница приложения открывается", async () => {
  const response = await request("/app/");
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.match(response.body, /TutorFlow/);
});

test("файлы приложения отдаются с правильным типом", async () => {
  const script = await request("/app/app.js");
  assert.equal(script.status, 200);
  assert.match(script.headers["content-type"], /javascript/);

  const styles = await request("/app/styles.css");
  assert.equal(styles.status, 200);
  assert.match(styles.headers["content-type"], /text\/css/);
});

test("корень перенаправляет на приложение", async () => {
  const response = await request("/");
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/app/");
});

/* ---------- Заголовки безопасности (находка №16) ---------- */

test("ответы содержат заголовки безопасности", async () => {
  const { headers } = await request("/app/");

  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["referrer-policy"], "no-referrer");

  const csp = headers["content-security-policy"];
  assert.ok(csp, "CSP отсутствует");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
});

test("заголовки есть и у отказов", async () => {
  const response = await request("/AGENTS.md");
  assert.equal(response.status, 403);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.ok(response.headers["content-security-policy"]);
});

/* ---------- Закрытое (находка №3) ---------- */

test("документация и служебные файлы недоступны", async () => {
  for (const path of [
    "/AGENTS.md",
    "/README.md",
    "/serve.js",
    "/docs/PROJECT-BRIEF.md",
    "/docs/AUDIT-RELEASE-CANDIDATE.md",
    "/.gitignore",
    "/.git/config",
    "/.git/HEAD",
    "/.env",
    "/package.json",
  ]) {
    const response = await request(path);
    assert.equal(response.status, 403, `путь ${path} должен быть закрыт`);
  }
});

test("выход за пределы каталога app закрыт", async () => {
  for (const path of [
    "/app/../AGENTS.md",
    "/app/../serve.js",
    "/app/../../.env",
    "/app/..%2fAGENTS.md",
    "/app/%2e%2e/AGENTS.md",
    "/app/%00.js",
  ]) {
    const response = await request(path);
    assert.equal(response.status, 403, `обход ${path} должен быть закрыт`);
  }
});

test("несуществующий файл даёт 404, а не список каталога", async () => {
  const response = await request("/app/no-such-file.js");
  assert.equal(response.status, 404);
  assert.doesNotMatch(response.body, /Index of/);
});

/* ---------- Устойчивость (находка №2) ---------- */

test("битый URL даёт 400 и не роняет сервер", async () => {
  const broken = await request("/app/%E0%A4%A");
  assert.equal(broken.status, 400);

  // Ключевая проверка: после ошибки сервер продолжает обслуживать запросы.
  const after = await request("/app/");
  assert.equal(after.status, 200);
  assert.equal(server.exitCode, null, "процесс сервера завершился");
});
