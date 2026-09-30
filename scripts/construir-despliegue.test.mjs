/**
 * Tests de `scripts/construir-despliegue.mjs` (`node --test`, sin dependencias).
 *
 * Dos niveles:
 * 1. Las funciones puras de descubrimiento/reescritura de rutas, sobre texto
 *    suelto (rápido, sin tocar disco).
 * 2. El build real de principio a fin: ejecuta el script como proceso aparte
 *    (igual que lo hará `npm run build:deploy`) y comprueba el `dist-deploy/`
 *    resultante — este es el test que de verdad habría fallado si `legacy/`
 *    se hubiese quedado sin `js/pdf.worker.min.js` (el caso real que motivó
 *    que `descubrirRecursosLocales` mire también `workerSrc`, no solo
 *    `src=`/`href=`).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { RAIZ, SALIDA, LEGACY, descubrirRecursosLocales, fijarRutasAbsolutas } from './construir-despliegue.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'construir-despliegue.mjs');

describe('descubrirRecursosLocales', () => {
  test('recoge src=/href= locales e ignora CDN y data:', () => {
    const html = `
      <link rel="stylesheet" href="css/styles.css?v=2.2.0">
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/x.css">
      <script src="js/app.js?v=2.2.0"></script>
      <link rel="icon" href="data:image/svg+xml,<svg></svg>">
    `;
    assert.deepEqual(descubrirRecursosLocales(html).sort(), ['css/styles.css', 'js/app.js']);
  });

  test('recoge el workerSrc asignado en un <script> inline (no es un atributo HTML)', () => {
    // Caso real: pdf.js apunta su worker así, no con src=/href=. Un
    // descubridor que solo mirase atributos HTML se quedaría sin este
    // fichero y la copia de /legacy/ fallaría en runtime sin que ningún
    // <link>/<script> roto lo delatase de forma obvia.
    const html = `<script>
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/pdf.worker.min.js';
    </script>`;
    assert.deepEqual(descubrirRecursosLocales(html), ['js/pdf.worker.min.js']);
  });

  test('una ruta absoluta (/js/...) se resuelve como relativa para localizar el fichero', () => {
    const html = `<script src="/js/app.js"></script>`;
    assert.deepEqual(descubrirRecursosLocales(html), ['js/app.js']);
  });
});

describe('fijarRutasAbsolutas', () => {
  test('reescribe una ruta absoluta a /legacy/...', () => {
    const html = `<script src="/js/app.js"></script>`;
    assert.equal(fijarRutasAbsolutas(html), `<script src="/legacy/js/app.js"></script>`);
  });

  test('no toca una ruta ya relativa', () => {
    const html = `<script src="js/app.js"></script>`;
    assert.equal(fijarRutasAbsolutas(html), html);
  });

  test('no duplica el prefijo si ya está corregida', () => {
    const html = `<script src="/legacy/js/app.js"></script>`;
    assert.equal(fijarRutasAbsolutas(html), html);
  });

  test('no toca una URL externa (protocolo-relativa //cdn/...)', () => {
    const html = `<script src="//cdn.example.com/x.js"></script>`;
    assert.equal(fijarRutasAbsolutas(html), html);
  });
});

/**
 * Extrae los mismos recursos locales que el script, pero de un HTML YA
 * copiado a legacy/ (rutas relativas a esa carpeta) — se reutiliza el mismo
 * descubridor: el formato de las referencias no cambia al copiar, solo su
 * base de resolución en disco.
 */
function recursosReferenciadosPorLegacy() {
  const html = fs.readFileSync(path.join(LEGACY, 'index.html'), 'utf8');
  return descubrirRecursosLocales(html);
}

describe('build real de dist-deploy/ (npm run build:deploy)', { timeout: 120_000 }, () => {
  test.before(() => {
    execFileSync(process.execPath, [SCRIPT], { cwd: RAIZ, stdio: 'pipe' });
  });

  test('dist-deploy/index.html es la app nueva (marcador #app, no el markup de la vieja)', () => {
    const ruta = path.join(SALIDA, 'index.html');
    assert.ok(fs.existsSync(ruta), `falta ${ruta}`);
    const html = fs.readFileSync(ruta, 'utf8');
    assert.match(html, /id="app"/, 'debe contener el nodo raíz de la app nueva (#app)');
    assert.doesNotMatch(html, /id="main-file-input"/, 'no debe contener markup de la app vieja');
  });

  test('dist-deploy/legacy/index.html es la app vieja completa', () => {
    const ruta = path.join(LEGACY, 'index.html');
    assert.ok(fs.existsSync(ruta), `falta ${ruta}`);
    const html = fs.readFileSync(ruta, 'utf8');
    assert.match(html, /id="main-file-input"/, 'debe contener markup de la app vieja');
    assert.doesNotMatch(html, /<div id="app">/, 'no debe contener el nodo raíz de la app nueva');
  });

  test('dist-deploy/legacy/index.html lleva el aviso "versión anterior" (solo la copia, con textContent)', () => {
    const html = fs.readFileSync(path.join(LEGACY, 'index.html'), 'utf8');
    assert.match(html, /aviso-version-anterior/);
    assert.match(html, /textContent/, 'el aviso se construye con textContent, no con innerHTML');
    // El original del repo nunca se toca.
    const original = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
    assert.doesNotMatch(original, /aviso-version-anterior/);
  });

  test('todos los recursos locales que legacy/index.html referencia existen dentro de legacy/', () => {
    const locales = recursosReferenciadosPorLegacy();
    assert.ok(locales.length > 0, 'la app vieja no referencia ningún recurso local — algo va mal en el descubrimiento');
    for (const rel of locales) {
      const ruta = path.join(LEGACY, rel);
      assert.ok(fs.existsSync(ruta) && fs.statSync(ruta).isFile(), `legacy/${rel} no existe en dist-deploy/legacy/`);
    }
  });

  test('el worker de pdf.js (referenciado vía workerSrc, no src=) está en legacy/', () => {
    assert.ok(fs.existsSync(path.join(LEGACY, 'js/pdf.worker.min.js')));
  });
});
