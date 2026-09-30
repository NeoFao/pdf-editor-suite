#!/usr/bin/env node
/**
 * Construye `dist-deploy/`: la app nueva como página principal + una copia
 * completa de la app vieja servida temporalmente en `dist-deploy/legacy/`.
 *
 * Autorización del dueño (2026-09-29, pasos 2+4 del cutover de despliegue):
 * "vercel.json: compilar con Vite la app nueva y servirla como página
 * principal" + "app vieja servida temporalmente en /legacy (no borrarla
 * todavía)". Van juntos para que en producción nunca haya un momento sin la
 * app vieja disponible.
 *
 * No toca `vite.config.ts`: build:next / dist-next (que usan los tests de
 * tests/e2e/next/) siguen intactos. Este script reutiliza esa MISMA config y
 * solo sobreescribe `outDir` para esta salida — ver `construir()` abajo.
 *
 * Falla ruidosamente (exit != 0) si falta algo esperado: un `dist-deploy`
 * roto en silencio es peor que un build que no compila.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SALIDA = path.join(RAIZ, 'dist-deploy');
export const LEGACY = path.join(SALIDA, 'legacy');

/**
 * Aviso "Estás usando la versión anterior" — SOLO se inyecta en la copia de
 * `dist-deploy/legacy/index.html`, nunca en el `index.html` original del
 * repo. Construye el nodo con `createElement`/`textContent` en tiempo de
 * ejecución del navegador (AGENTS.md §2.2): esta cadena es marcado nuestro
 * fijo, nunca datos del documento del usuario, y en ningún punto se usa
 * innerHTML con datos interpolados.
 */
const AVISO_SCRIPT = `    <script>
      (function () {
        var aviso = document.createElement('div');
        aviso.id = 'aviso-version-anterior';
        aviso.setAttribute('role', 'note');
        aviso.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
          'background:#312e81;color:#e0e7ff;font:12px/1.4 sans-serif;' +
          'padding:6px 12px;text-align:center;';
        var texto = document.createElement('span');
        texto.textContent = 'Estás usando la versión anterior del editor.';
        var enlace = document.createElement('a');
        enlace.href = '/';
        enlace.textContent = 'Ir a la nueva';
        enlace.style.cssText = 'color:#a5b4fc;margin-left:6px;font-weight:600;';
        aviso.appendChild(texto);
        aviso.appendChild(enlace);
        document.body.prepend(aviso);
      })();
    </script>`;

function falla(mensaje) {
  console.error(`\nFALLO  construir-despliegue: ${mensaje}\n`);
  process.exit(1);
}

/**
 * Extrae los recursos LOCALES (no http(s)/data:) que `index.html` (app
 * vieja) referencia: los atributos `src=`/`href=` de sus `<link>`/`<script>`
 * Y el `workerSrc` de pdf.js, que se asigna en un `<script>` inline
 * (`js/pdf.worker.min.js`) — no es un atributo HTML, así que un patrón que
 * solo mirara `src=`/`href=` lo pasaría por alto y la copia se quedaría sin
 * el worker de pdf.js (fallo silencioso: pdf.js simplemente no arranca).
 *
 * Lee el fichero real en vez de adivinar la lista — si algún día se añade o
 * quita un recurso, esta función lo sigue sin tocar el script.
 */
export function descubrirRecursosLocales(html) {
  const vistos = new Set();
  const patron = /\b(?:src|href|workerSrc)\s*=\s*['"]([^'"]+)['"]/g;
  for (const m of html.matchAll(patron)) {
    let ruta = m[1];
    if (/^([a-z]+:)?\/\//i.test(ruta) || ruta.startsWith('data:')) continue; // externo (CDN, data URI)
    ruta = ruta.split('#')[0].split('?')[0]; // quita hash y cache-busting (?v=)
    if (ruta.startsWith('/')) ruta = ruta.slice(1); // absoluta-desde-raíz -> relativa para resolver en disco
    // La comprobación de vacío va DESPUÉS de quitar la barra inicial: un
    // enlace a la raíz del sitio (href="/", como el del propio aviso
    // "versión anterior" que este script inyecta) no es un recurso que
    // copiar. Si el chequeo fuera antes, "/" pasaba el filtro y, tras
    // quitarle la barra, quedaba como cadena vacía que `path.join` resuelve
    // al propio directorio — un recurso fantasma que nunca existe como
    // fichero (visto de verdad: el test unitario de este script lo detectó
    // al re-analizar su propia copia de legacy/index.html, que ya incluye
    // el aviso).
    if (!ruta) continue;
    vistos.add(ruta);
  }
  return [...vistos];
}

/**
 * Reescribe cualquier ruta ABSOLUTA (`/js/...`) a `/legacy/js/...` — SOLO en
 * el texto que se escribe en la copia, nunca en el fichero original. Hoy
 * ninguna ruta de `index.html` es absoluta (lo comprueba el test unitario de
 * este script), pero deja el cutover listo si apareciera una: sin este
 * arreglo, una ruta absoluta cargaría desde la raíz del dominio (la app
 * nueva) en vez de desde `/legacy/`.
 */
export function fijarRutasAbsolutas(html) {
  return html.replace(
    /\b(src|href|workerSrc)(\s*=\s*)(['"])\/(?!\/)([^'"]*)\3/g,
    (coincide, atributo, igual, comilla, resto) => {
      if (resto.startsWith('legacy/')) return coincide; // ya corregida
      return `${atributo}${igual}${comilla}/legacy/${resto}${comilla}`;
    }
  );
}

/** Construye la app nueva (Vite) directamente en `dist-deploy/`. */
async function construirAppNueva() {
  // Reutiliza vite.config.ts sin modificarlo: solo se sobreescribe `outDir`
  // para esta salida. `build:next` sigue apuntando a `dist-next/` como
  // siempre — mergeConfig de Vite combina esto con el resto del fichero
  // (rollupOptions.input: 'index.next.html', assetsInclude wasm...) sin
  // pisarlo.
  await build({
    configFile: path.join(RAIZ, 'vite.config.ts'),
    build: { outDir: 'dist-deploy', emptyOutDir: true }
  });

  const salidaVite = path.join(SALIDA, 'index.next.html');
  const indexFinal = path.join(SALIDA, 'index.html');
  if (!fs.existsSync(salidaVite)) {
    falla(
      `Vite no generó ${path.relative(RAIZ, salidaVite)} tras el build — ` +
      '¿cambió el nombre del HTML de entrada en vite.config.ts sin actualizar este script?'
    );
  }

  // Vite nombra el HTML de salida igual que el de entrada (index.next.html).
  // Sus assets se referencian con rutas ABSOLUTAS desde la raíz
  // (`/assets/...`, confirmado leyendo la salida de `vite build`), así que
  // renombrar el HTML no rompe ninguna referencia: se verifica en el test
  // unitario de este script y en el smoke E2E (tests/e2e/deploy/).
  fs.renameSync(salidaVite, indexFinal);
}

/** Copia la app vieja completa (index.html + todo lo que carga) a `dist-deploy/legacy/`. */
function copiarAppVieja() {
  fs.rmSync(LEGACY, { recursive: true, force: true });
  fs.mkdirSync(LEGACY, { recursive: true });

  const indexViejoRuta = path.join(RAIZ, 'index.html');
  if (!fs.existsSync(indexViejoRuta)) falla('no existe index.html (app vieja) en la raíz del repo');
  let indexViejo = fs.readFileSync(indexViejoRuta, 'utf8');

  const locales = descubrirRecursosLocales(indexViejo);
  if (locales.length === 0) {
    falla('no se encontró ningún recurso local en index.html — ¿cambió el marcado de la app vieja?');
  }

  for (const rel of locales) {
    const origen = path.join(RAIZ, rel);
    if (!fs.existsSync(origen) || !fs.statSync(origen).isFile()) {
      falla(`index.html (app vieja) referencia "${rel}" pero el fichero no existe en el repo`);
    }
    const destino = path.join(LEGACY, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(origen, destino);
  }

  indexViejo = fijarRutasAbsolutas(indexViejo);

  if (!indexViejo.includes('</body>')) falla('index.html (app vieja) no tiene </body> — no se puede insertar el aviso');
  indexViejo = indexViejo.replace('</body>', `${AVISO_SCRIPT}\n  </body>`);

  fs.writeFileSync(path.join(LEGACY, 'index.html'), indexViejo, 'utf8');
}

async function main() {
  await construirAppNueva();
  copiarAppVieja();
  console.log('dist-deploy/ construido: app nueva en index.html, app vieja completa en legacy/.');
}

// Solo ejecuta si se invoca directamente (`node scripts/construir-despliegue.mjs`),
// no cuando el test unitario importa sus funciones puras.
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
