/**
 * Tests de `scripts/servir-despliegue.mjs` (`node --test`, sin dependencias).
 *
 * Por qué existe este fichero: antes de este servidor, NINGÚN test ejercitaba
 * la app nueva (`dist-deploy/`) bajo la CSP real de `vercel.json` — el
 * proyecto `deploy` de Playwright usaba `vite preview`, que no manda esas
 * cabeceras (ver el comentario de cabecera de `servir-despliegue.mjs`). Estos
 * tests cubren tres capas: el conversor de patrones a RegExp, la resolución
 * de ficheros (cleanUrls + rewrites + anti path-traversal) sobre un árbol de
 * ficheros de mentira, y un servidor HTTP real de punta a punta.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import {
  compilarPatron,
  cargarConfiguracion,
  cabecerasPara,
  aplicarRewrites,
  resolverArchivo,
  crearServidor,
  RAIZ
} from './servir-despliegue.mjs';

describe('compilarPatron', () => {
  test('/(.*)  matchea cualquier ruta absoluta, ancla al completo', () => {
    const r = compilarPatron('/(.*)');
    assert.ok(r.test('/'));
    assert.ok(r.test('/legacy/index.html'));
    assert.ok(r.test('/assets/pdfium.wasm'));
  });

  test('/(.*)\\.(js|css)  solo matchea rutas que TERMINAN en esa extensión', () => {
    const r = compilarPatron('/(.*)\\.(js|css)');
    assert.ok(r.test('/assets/app.js'));
    assert.ok(r.test('/assets/app.css'));
    assert.ok(!r.test('/assets/app.js.txt'), 'el ancla final impide que .* se coma la extensión real');
    assert.ok(!r.test('/assets/app.wasm'));
  });

  test('/(.*)\\.(wasm|woff2)  matchea wasm y woff2, no otras extensiones', () => {
    const r = compilarPatron('/(.*)\\.(wasm|woff2)');
    assert.ok(r.test('/assets/pdfium.wasm'));
    assert.ok(r.test('/fonts/a.woff2'));
    assert.ok(!r.test('/assets/app.js'));
  });

  test('/assets/(.*)  exige el prefijo /assets/', () => {
    const r = compilarPatron('/assets/(.*)');
    assert.ok(r.test('/assets/index-abc123.js'));
    assert.ok(!r.test('/legacy/assets/x.js'));
  });

  test('/legacy (sin grupo) es coincidencia exacta', () => {
    const r = compilarPatron('/legacy');
    assert.ok(r.test('/legacy'));
    assert.ok(!r.test('/legacy/'));
    assert.ok(!r.test('/legacy/index.html'));
  });
});

describe('cargarConfiguracion + cabecerasPara sobre el vercel.json real del repo', () => {
  const config = cargarConfiguracion(path.join(RAIZ, 'vercel.json'));

  test('toda ruta lleva Content-Security-Policy', () => {
    const cab = cabecerasPara(config, '/index.html');
    assert.ok(cab.get('Content-Security-Policy'), 'falta CSP para /index.html');
    const cab2 = cabecerasPara(config, '/legacy/index.html');
    assert.ok(cab2.get('Content-Security-Policy'), 'falta CSP para /legacy/index.html');
  });

  test('un .js fuera de /assets/ recibe la CSP general Y la Cache-Control específica de .js', () => {
    // Fuera de /assets/ a propósito: dentro de /assets/ el patrón
    // "/assets/(.*)" (más específico, va DESPUÉS en vercel.json) también
    // matchea y gana la Cache-Control inmutable — ver el test siguiente.
    const cab = cabecerasPara(config, '/index-abc123.js');
    assert.ok(cab.get('Content-Security-Policy'));
    assert.equal(cab.get('Cache-Control'), 'public, max-age=0, must-revalidate');
  });

  test('un .js DENTRO de /assets/ recibe la Cache-Control inmutable de /assets/(.*) — coincide última, gana', () => {
    const cab = cabecerasPara(config, '/assets/index-abc123.js');
    assert.equal(cab.get('Cache-Control'), 'public, max-age=31536000, immutable');
  });

  test('un .wasm recibe Cache-Control inmutable de largo plazo', () => {
    const cab = cabecerasPara(config, '/assets/pdfium-abc123.wasm');
    assert.equal(cab.get('Cache-Control'), 'public, max-age=31536000, immutable');
  });

  test('cabeceras de seguridad fijas están presentes (HSTS, nosniff, frame-options)', () => {
    const cab = cabecerasPara(config, '/');
    assert.ok(cab.get('Strict-Transport-Security'));
    assert.equal(cab.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(cab.get('X-Frame-Options'), 'SAMEORIGIN');
  });
});

describe('cabecerasPara — orden de fusión (config sintética)', () => {
  const config = {
    cleanUrls: true,
    rewrites: [],
    headers: [
      { source: '/(.*)', headers: [{ key: 'X-Prueba', value: 'general' }] },
      { source: '/(.*)\\.(js)', headers: [{ key: 'X-Prueba', value: 'especifico-js' }] }
    ]
  };

  test('la entrada MÁS ESPECÍFICA (posterior en el array) gana si repite la misma clave', () => {
    assert.equal(cabecerasPara(config, '/app.js').get('X-Prueba'), 'especifico-js');
    assert.equal(cabecerasPara(config, '/app.css').get('X-Prueba'), 'general');
  });
});

describe('aplicarRewrites', () => {
  const config = { cleanUrls: true, rewrites: [{ source: '/legacy', destination: '/legacy/index.html' }], headers: [] };

  test('/legacy se reescribe a /legacy/index.html', () => {
    assert.equal(aplicarRewrites(config, '/legacy'), '/legacy/index.html');
  });

  test('/legacy/ (con barra) NO coincide con el rewrite exacto — se resuelve luego por índice de directorio', () => {
    assert.equal(aplicarRewrites(config, '/legacy/'), '/legacy/');
  });

  test('una ruta sin relación pasa intacta', () => {
    assert.equal(aplicarRewrites(config, '/assets/app.js'), '/assets/app.js');
  });
});

describe('resolverArchivo — cleanUrls y anti path-traversal sobre un árbol de mentira', () => {
  let dir;

  test.before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'servir-despliegue-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html>raiz</html>');
    fs.mkdirSync(path.join(dir, 'legacy'));
    fs.writeFileSync(path.join(dir, 'legacy', 'index.html'), '<html>legacy</html>');
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'app.wasm'), 'wasm');
    fs.writeFileSync(path.join(dir, 'pagina.html'), '<html>pagina</html>');
    // Fichero hermano FUERA del árbol servido, con un nombre que empieza
    // igual que `dir` — el caso que exige comprobar el separador final.
    fs.writeFileSync(`${dir}-secreto.txt`, 'fuera');
  });

  test.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(`${dir}-secreto.txt`, { force: true });
  });

  test('"/" resuelve a index.html de la raíz', () => {
    assert.equal(resolverArchivo(dir, '/'), path.join(dir, 'index.html'));
  });

  test('"/legacy/" (con barra) resuelve al índice del directorio', () => {
    assert.equal(resolverArchivo(dir, '/legacy/'), path.join(dir, 'legacy', 'index.html'));
  });

  test('"/pagina" (cleanUrls, sin extensión) resuelve a pagina.html', () => {
    assert.equal(resolverArchivo(dir, '/pagina'), path.join(dir, 'pagina.html'));
  });

  test('"/assets/app.wasm" resuelve directo por ruta exacta', () => {
    assert.equal(resolverArchivo(dir, '/assets/app.wasm'), path.join(dir, 'assets', 'app.wasm'));
  });

  test('un fichero que no existe da null', () => {
    assert.equal(resolverArchivo(dir, '/no-existe'), null);
  });

  test('".." en la ruta se rechaza (no escapa del directorio servido)', () => {
    assert.equal(resolverArchivo(dir, '/../secreto.txt'), null);
    assert.equal(resolverArchivo(dir, '/legacy/../../secreto.txt'), null);
  });

  test('un directorio hermano cuyo nombre empieza igual que el servido no es alcanzable', () => {
    // Sin el separador final en la comprobación de prefijo, "<dir>-secreto.txt"
    // pasaría el filtro por empezar con la cadena `dir`.
    assert.equal(resolverArchivo(dir, '/../' + path.basename(dir) + '-secreto.txt'), null);
  });
});

describe('crearServidor — extremo a extremo con HTTP real', () => {
  let dir;
  let servidor;
  let base;

  test.before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'servir-despliegue-http-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html>app nueva</html>');
    fs.mkdirSync(path.join(dir, 'legacy'));
    fs.writeFileSync(path.join(dir, 'legacy', 'index.html'), '<html>app vieja</html>');
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'app.wasm'), Buffer.from([0, 1, 2, 3]));

    const config = {
      cleanUrls: true,
      rewrites: [{ source: '/legacy', destination: '/legacy/index.html' }],
      headers: [
        { source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'" }] },
        { source: '/(.*)\\.(wasm)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }
      ]
    };

    servidor = crearServidor(dir, config);
    await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    const { port } = servidor.address();
    base = `http://127.0.0.1:${port}`;
  });

  test.after(async () => {
    await new Promise((resolve) => servidor.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function get(rutaRelativa) {
    return new Promise((resolve, reject) => {
      http.get(base + rutaRelativa, (res) => {
        const trozos = [];
        res.on('data', (t) => trozos.push(t));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, cuerpo: Buffer.concat(trozos) }));
      }).on('error', reject);
    });
  }

  test('GET / sirve la app nueva con Content-Security-Policy', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.ok(r.headers['content-security-policy']);
    assert.match(r.cuerpo.toString('utf8'), /app nueva/);
  });

  test('GET /legacy (rewrite) sirve legacy/index.html', async () => {
    const r = await get('/legacy');
    assert.equal(r.status, 200);
    assert.match(r.cuerpo.toString('utf8'), /app vieja/);
  });

  test('GET /legacy/ (índice de directorio) también sirve legacy/index.html', async () => {
    const r = await get('/legacy/');
    assert.equal(r.status, 200);
    assert.match(r.cuerpo.toString('utf8'), /app vieja/);
  });

  test('GET /assets/app.wasm sirve con Content-Type application/wasm (imprescindible para instantiateStreaming)', async () => {
    const r = await get('/assets/app.wasm');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'application/wasm');
    assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
  });

  test('GET /../fuera-del-arbol se rechaza (403), nunca sirve el fichero', async () => {
    const r = await get('/..%2ffuera.txt');
    assert.ok([403, 404].includes(r.status), `esperaba 403/404, dio ${r.status}`);
  });

  test('GET %2e%2e%2f (path traversal codificado) se rechaza', async () => {
    const r = await get('/%2e%2e%2f%2e%2e%2fetc%2fpasswd');
    assert.ok([403, 404].includes(r.status), `esperaba 403/404, dio ${r.status}`);
  });

  test('GET /no-existe da 404', async () => {
    const r = await get('/no-existe-de-verdad');
    assert.equal(r.status, 404);
  });

  test('POST se rechaza con 405', async () => {
    const respuesta = await new Promise((resolve, reject) => {
      const req = http.request(base + '/', { method: 'POST' }, (res) => resolve(res));
      req.on('error', reject);
      req.end();
    });
    assert.equal(respuesta.statusCode, 405);
  });
});
