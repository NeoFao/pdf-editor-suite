#!/usr/bin/env node
/**
 * Servidor fiel de `dist-deploy/` (Node puro, sin dependencias).
 *
 * Por qué existe: `vite preview` sirve los ficheros de `dist-deploy/` pero
 * NO aplica ninguna de las cabeceras de `vercel.json` (CSP incluida). Antes
 * de este fichero, el proyecto `deploy` de Playwright probaba el EMPAQUETADO
 * (que los ficheros estén, que las rutas resuelvan) pero nunca la app NUEVA
 * bajo la CSP real de producción — solo la app vieja, servida por
 * `server.js`, se probaba con CSP. Si la CSP se endurece sin arreglar esto,
 * una rotura del WASM en producción (p. ej. quitar 'unsafe-eval' rompe algo
 * que de verdad lo necesitaba) pasaría el CI en verde.
 *
 * Este servidor LEE `vercel.json` en vez de duplicar sus reglas a mano:
 * aplica sus `headers` (con conversión de `source` a RegExp — ver
 * `compilarPatron`), sus `rewrites` y su `cleanUrls`, con los mismos tipos
 * MIME y la misma protección anti path-traversal que `server.js`.
 *
 * Uso:
 *   node scripts/servir-despliegue.mjs [--port 4174] [--dir dist-deploy] [--config vercel.json]
 *   PORT=4174 DIST_DIR=dist-deploy VERCEL_JSON=vercel.json node scripts/servir-despliegue.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  // Imprescindible: sin este tipo MIME exacto, WebAssembly.instantiateStreaming
  // rechaza la respuesta (exige "application/wasm") y el motor PDFium cae al
  // camino lento de instantiate() con ArrayBuffer, cuando no falla del todo.
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

/**
 * Convierte un `source` de `vercel.json` en una RegExp anclada.
 *
 * Los patrones que existen hoy en este repo (`/(.*)`, `/(.*)\.(js|css)`,
 * `/(.*)\.(wasm|woff2)`, `/assets/(.*)`, y el `rewrites` `/legacy`) YA son
 * sintaxis de regex válida tal cual están escritos en el JSON — Vercel
 * documenta `source` como "una ruta o una regex". Así que el conversor no
 * necesita traducir nada: basta anclar con `^...$` para exigir coincidencia
 * completa de la ruta (si no se ancla, `/(.*)\.(js|css)` como regex SIN
 * anclar también matchearía "/foo.js.txt" por el `.*` de después, que no es
 * lo que Vercel hace).
 *
 * Limitación conocida y aceptada: si algún día se añade un `source` con
 * sintaxis de "path-to-regexp" (p. ej. `/:slug*`, que Vercel también acepta),
 * este conversor simple no lo entiende. No hace falta hoy — los patrones
 * reales del repo están cubiertos por el test de este fichero.
 */
export function compilarPatron(source) {
  return new RegExp(`^${source}$`);
}

/** Lee y valida el `vercel.json` de la raíz del proyecto. */
export function cargarConfiguracion(rutaJson) {
  const bruto = fs.readFileSync(rutaJson, 'utf8');
  const config = JSON.parse(bruto);
  return {
    cleanUrls: Boolean(config.cleanUrls),
    rewrites: Array.isArray(config.rewrites) ? config.rewrites : [],
    headers: Array.isArray(config.headers) ? config.headers : []
  };
}

/**
 * Cabeceras a aplicar para una ruta dada, tal como las definiría Vercel:
 * TODAS las entradas de `headers` cuyo `source` matchee se aplican, en
 * orden; si dos entradas fijan la misma clave, gana la última (coincide con
 * el orden de `vercel.json`: la entrada general `/(.*)` primero, las
 * específicas de extensión después).
 */
export function cabecerasPara(config, pathname) {
  const resultado = new Map();
  for (const entrada of config.headers) {
    let regex;
    try {
      regex = compilarPatron(entrada.source);
    } catch {
      continue; // source inválido: no debería ocurrir con un vercel.json válido
    }
    if (!regex.test(pathname)) continue;
    for (const { key, value } of entrada.headers ?? []) {
      resultado.set(key, value);
    }
  }
  return resultado;
}

/** Aplica los `rewrites` de `vercel.json` a `pathname`. Devuelve la ruta reescrita. */
export function aplicarRewrites(config, pathname) {
  for (const { source, destination } of config.rewrites) {
    let regex;
    try {
      regex = compilarPatron(source);
    } catch {
      continue;
    }
    if (regex.test(pathname)) {
      return pathname.replace(regex, destination);
    }
  }
  return pathname;
}

/**
 * Sondea candidatos de fichero para `pathname` dentro de `dir`, replicando
 * el `cleanUrls: true` de Vercel: ruta exacta primero, luego `.html`
 * añadido, luego `index.html` de directorio. Devuelve la ruta ABSOLUTA del
 * primer candidato que exista y sea un fichero real, o `null`.
 *
 * Path traversal: cada candidato se resuelve con `path.resolve` y se exige
 * que quede estrictamente dentro de `dir` (con el separador final, igual
 * que `server.js`: sin él, un directorio hermano cuyo nombre empiece igual
 * pasaría el filtro). `decodeURIComponent` ya normalizó `%2e%2e` a `..`
 * antes de llegar aquí, así que esta comprobación también cubre esa vía.
 */
export function resolverArchivo(dir, pathname) {
  const candidatos = [];
  if (pathname === '/' || pathname === '') {
    candidatos.push('/index.html');
  } else if (pathname.endsWith('/')) {
    candidatos.push(`${pathname}index.html`);
  } else {
    candidatos.push(pathname);
    const ultimoSegmento = pathname.slice(pathname.lastIndexOf('/') + 1);
    if (!ultimoSegmento.includes('.')) {
      candidatos.push(`${pathname}.html`);
      candidatos.push(`${pathname}/index.html`);
    }
  }

  for (const candidato of candidatos) {
    // Defensa explícita adicional a la comprobación de resolución de abajo:
    // rechaza cualquier segmento ".." tras decodificar, sin esperar a que
    // path.resolve lo colapse.
    if (candidato.split('/').includes('..')) continue;

    const resuelto = path.resolve(dir, '.' + path.sep + candidato);
    if (resuelto !== dir && !resuelto.startsWith(dir + path.sep)) continue;

    if (fs.existsSync(resuelto) && fs.statSync(resuelto).isFile()) {
      return resuelto;
    }
  }
  return null;
}

function decodificarSeguro(urlPath) {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    return null;
  }
}

/** Crea (sin arrancar) el servidor HTTP. `dir` y `config` ya resueltos. */
export function crearServidor(dir, config) {
  return http.createServer((req, res) => {
    res.removeHeader('X-Powered-By');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
      res.end('405 Method Not Allowed');
      return;
    }

    const urlBruta = req.url.split('?')[0] || '/';

    // Ruta absoluta de disco (Windows: "C:\..." o "\\servidor\...") inyectada
    // en la URL: rechazo explícito antes de decodificar nada más.
    if (/^\/[a-zA-Z]:[\\/]/.test(urlBruta) || urlBruta.startsWith('//')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Acceso Denegado');
      return;
    }

    const decodificada = decodificarSeguro(urlBruta);
    if (decodificada === null) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 Solicitud incorrecta');
      return;
    }

    if (decodificada.split('/').includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Acceso Denegado');
      return;
    }

    // Las cabeceras de vercel.json se calculan sobre la ruta ORIGINAL de la
    // petición (antes de rewrites) — así es como Vercel las aplica: un
    // rewrite cambia qué fichero se sirve, no qué patrón de `headers`
    // matcheó la URL pedida.
    const cabeceras = cabecerasPara(config, decodificada);
    for (const [clave, valor] of cabeceras) res.setHeader(clave, valor);

    const pathnameFinal = aplicarRewrites(config, decodificada);
    const archivo = resolverArchivo(dir, pathnameFinal);

    if (!archivo) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 No encontrado');
      return;
    }

    const ext = path.extname(archivo).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end();
      return;
    }

    fs.readFile(archivo, (err, contenido) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Error interno');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(contenido);
    });
  });
}

function parsearArgv(argv) {
  const opciones = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') opciones.port = argv[++i];
    else if (argv[i] === '--dir') opciones.dir = argv[++i];
    else if (argv[i] === '--config') opciones.config = argv[++i];
  }
  return opciones;
}

function main() {
  const argv = parsearArgv(process.argv.slice(2));
  const PORT = Number(argv.port ?? process.env.PORT ?? 4174);
  const DIST_DIR = path.resolve(RAIZ, argv.dir ?? process.env.DIST_DIR ?? 'dist-deploy');
  const VERCEL_JSON = path.resolve(RAIZ, argv.config ?? process.env.VERCEL_JSON ?? 'vercel.json');

  if (!fs.existsSync(DIST_DIR)) {
    console.error(`\nFALLO  servir-despliegue: no existe "${DIST_DIR}" — ejecuta "npm run build:deploy" primero.\n`);
    process.exit(1);
  }

  const config = cargarConfiguracion(VERCEL_JSON);
  const servidor = crearServidor(DIST_DIR, config);
  servidor.listen(PORT, '127.0.0.1', () => {
    console.log(`servir-despliegue: http://127.0.0.1:${PORT} sirviendo ${path.relative(RAIZ, DIST_DIR)} con la CSP real de vercel.json`);
  });
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
  main();
}
