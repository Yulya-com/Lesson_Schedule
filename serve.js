// serve.js — минимальный статический сервер без зависимостей.
// Запуск: node serve.js  →  http://localhost:5173

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

function safePath(urlPath) {
  // decodeURIComponent бросает URIError на некорректной последовательности
  // вроде "/%E0%A4%A". Без этого перехвата ошибка всплывала из асинхронного
  // обработчика и завершала процесс целиком.
  let clean;
  try {
    clean = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return { badRequest: true };
  }

  if (clean === "/" || clean === "") return { redirect: "/app/" };
  if (clean === "/app" || clean === "/app/") return { file: join(ROOT, "app", "index.html") };

  const target = normalize(join(ROOT, clean));
  if (!target.startsWith(ROOT + sep) && target !== ROOT) return { forbidden: true };
  return { file: target };
}

const server = http.createServer(async (request, response) => {
  let target;
  try {
    target = safePath(request.url || "/");
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Некорректный адрес");
    return;
  }

  if (target.badRequest) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Некорректный адрес");
    return;
  }

  if (target.redirect) {
    response.writeHead(302, { Location: target.redirect });
    response.end();
    return;
  }

  if (target.forbidden) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Доступ запрещён");
    return;
  }

  const filePath = target.file;

  try {
    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": type,
      // Файлы приложения меняются во время разработки: браузер не должен
      // отдавать старую версию из кэша.
      "Cache-Control": "no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><meta charset="utf-8"><title>404</title>
       <p style="font:16px system-ui;padding:24px">Файл не найден.
       Откройте <a href="/app/">главную страницу</a>.</p>`
    );
  }
});

server.listen(PORT, HOST, () => {
  console.log(`TutorFlow: http://localhost:${PORT}/app/`);
  console.log(`Корень: ${ROOT}`);
  console.log("Остановить: Ctrl+C");
});
