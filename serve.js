// serve.js — минимальный статический сервер без зависимостей.
// Запуск: node serve.js  →  http://localhost:5173

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || "127.0.0.1";

// Сервер отдаёт файлы только из этой папки.
// Всё остальное — документация, исходники сервера, .git, резервные копии
// с персональными данными — недоступно по HTTP.
const PUBLIC_DIR = resolve(join(ROOT, "app"));

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

/**
 * Заголовки безопасности для всех ответов.
 * CSP разрешает только файлы этого же сервера: внешние скрипты и запросы
 * наружу заблокированы. nosniff запрещает браузеру угадывать тип файла,
 * frame-ancestors и X-Frame-Options запрещают встраивание в чужой iframe.
 */
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; "
    + "script-src 'self'; "
    + "style-src 'self'; "
    + "img-src 'self' data: blob:; "
    + "font-src 'self'; "
    + "connect-src 'self'; "
    + "object-src 'none'; "
    + "base-uri 'none'; "
    + "form-action 'none'; "
    + "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
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
  if (clean === "/app") return { redirect: "/app/" };
  if (clean === "/app/") return { file: join(PUBLIC_DIR, "index.html") };

  // Запросы вне /app/ отсекаются до работы с файловой системой.
  if (!clean.startsWith("/app/")) return { forbidden: true };

  const relative = clean.slice("/app/".length);
  const target = normalize(join(PUBLIC_DIR, relative));

  // '\0' и подобные трюки, а также выход через ../ за пределы папки app.
  if (target.includes("\0")) return { forbidden: true };
  if (!target.startsWith(PUBLIC_DIR + sep)) return { forbidden: true };

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
    response.writeHead(400, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    response.end("Некорректный адрес");
    return;
  }

  if (target.redirect) {
    response.writeHead(302, { ...SECURITY_HEADERS, Location: target.redirect });
    response.end();
    return;
  }

  if (target.forbidden) {
    response.writeHead(403, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    response.end("Доступ запрещён");
    return;
  }

  const filePath = target.file;

  try {
    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": type,
      // Файлы приложения меняются во время разработки: браузер не должен
      // отдавать старую версию из кэша.
      "Cache-Control": "no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><meta charset="utf-8"><title>404</title>
       <p>Файл не найден. Откройте <a href="/app/">главную страницу</a>.</p>`
    );
  }
});

server.listen(PORT, HOST, () => {
  console.log(`TutorFlow: http://localhost:${PORT}/app/`);
  console.log("Открыт только каталог app, остальные файлы проекта недоступны по HTTP");
  console.log(`Слушает: ${HOST}`);
  console.log("Остановить: Ctrl+C");
});
