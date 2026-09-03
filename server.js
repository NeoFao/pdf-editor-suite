/**
 * PDF Editor - Servidor Local Seguro (Zero-Dependency)
 * Utiliza el módulo nativo HTTP de Node.js con blindaje contra Path Traversal,
 * restricción de métodos HTTP y cabeceras estrictas de seguridad.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon'
};

const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com blob:",
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "font-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://raw.githubusercontent.com blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

const server = http.createServer((req, res) => {
  // Desactivar firmas del servidor
  res.removeHeader('X-Powered-By');

  // 1. Restricción estricta de Métodos HTTP permitidos (Solo GET y HEAD)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Allow': 'GET, HEAD'
    });
    res.end('405 Method Not Allowed');
    return;
  }

  // 2. Inyección de Cabeceras de Seguridad Avanzadas
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CSP_POLICY);

  // 3. Prevención Estricta de Path Traversal (Ataques de salto de directorio)
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/' || !urlPath) urlPath = '/index.html';

  // Decodificar URI para mitigar evasiones con porcentajes (ej. %2e%2e%2f)
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Solicitud incorrecta');
    return;
  }

  // Resolver y normalizar ruta absoluta de forma segura
  const resolvedPath = path.resolve(__dirname, '.' + path.sep + decodedPath);

  // Asegurar que la ruta resuelta permanezca estrictamente dentro de __dirname
  if (!resolvedPath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Acceso Denegado');
    return;
  }

  let finalPath = resolvedPath;

  fs.stat(finalPath, (err, stats) => {
    // Si la ruta solicitada no es un archivo válido o no existe, servir index.html (SPA routing)
    if (err || !stats.isFile()) {
      finalPath = path.join(__dirname, 'index.html');
    }

    const ext = path.extname(finalPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Para peticiones HEAD, solo enviar cabeceras
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end();
      return;
    }

    fs.readFile(finalPath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Error interno');
        return;
      }

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 PDF Editor corriendo en: http://localhost:${PORT}`);
  console.log(`🔒 Servidor seguro con CSP, Anti-Traversal y Zero-Data`);
  console.log(`====================================================`);
});
