import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const DIR_FIXTURES = path.resolve(AQUI, '../fixtures/generados');

export function rutaFixture(nombre) {
  const ruta = path.join(DIR_FIXTURES, nombre);
  if (!fs.existsSync(ruta)) {
    throw new Error(`Falta el fixture ${nombre}. Ejecuta: npm run test:fixtures`);
  }
  return ruta;
}

/**
 * Abre un documento por el camino real del usuario: el <input type="file">.
 * Nunca llamando a loadPDFBuffer() a mano — un test que salta la UI deja de
 * cubrir el cableado, que es justo donde aparecieron varios defectos.
 */
export async function abrirDocumento(page, nombreFixture) {
  await page.goto('/');
  await page.locator('#main-file-input').setInputFiles(rutaFixture(nombreFixture));
  await expect(page.locator('#pdf-zoom-sizer')).toBeVisible();
  await expect(page.locator('.acrobat-page-wrapper').first()).toBeVisible();
  // La capa de Texto Vivo se construye tras el render de cada página.
  await expect(page.locator('.acrobat-text-block').first()).toBeAttached();
  await page.waitForFunction(() => document.getElementById('global-loading-overlay').classList.contains('hidden'));
  await esperarZoomEstable(page);
}

/**
 * Espera a que termine la transición CSS del zoom (0.12 s).
 *
 * Medir a mitad de la animación devuelve un ancho intermedio y produce fallos
 * que parecen del producto y son del test. Se comprueba estabilidad en dos
 * fotogramas consecutivos en vez de dormir un tiempo fijo.
 */
export async function esperarZoomEstable(page) {
  // Se compara el ancho pintado contra el que impone el zoom actual. Comparar
  // dos fotogramas consecutivos no vale: antes de que la transición arranque,
  // dos lecturas seguidas son idénticas y el test da por bueno el estado viejo.
  await page.waitForFunction(() => {
    const pg = document.querySelector('.acrobat-page-wrapper');
    if (!pg || !window.docState) return true;
    const esperado = (parseFloat(pg.style.width) || 0) * (window.docState.zoom || 1);
    if (!esperado) return true;
    return Math.abs(pg.getBoundingClientRect().width - esperado) < 1;
  }, null, { polling: 'raf', timeout: 5000 });
}

/** Devuelve los textos de los bloques de Texto Vivo de una página, en orden. */
export async function textosDeBloques(page, pagina = 1) {
  return page.$$eval(
    `#acrobat-page-${pagina} .acrobat-text-block .text-block-content`,
    (els) => els.map((e) => e.textContent)
  );
}

/**
 * Localiza el bloque de Texto Vivo cuyo contenido empieza por `prefijo` y
 * devuelve un localizador anclado a su `id`.
 *
 * El anclaje es imprescindible: un localizador que filtra por texto deja de
 * casar en cuanto el test edita ese texto, que es justo lo que hacen casi
 * todos los tests de este archivo.
 */
export async function bloquePorTexto(page, prefijo, pagina = 1) {
  const id = await page
    .locator(`#acrobat-page-${pagina} .acrobat-text-block`)
    .filter({ has: page.locator('.text-block-content', { hasText: prefijo }) })
    .first()
    .getAttribute('id');

  if (!id) throw new Error(`No hay ningún bloque que empiece por "${prefijo}" en la página ${pagina}`);
  return page.locator(`#${id}`);
}

/** ¿Existe algún bloque con ese texto? (para asertar ausencia sin lanzar) */
export function contarBloquesConTexto(page, prefijo, pagina = 1) {
  return page
    .locator(`#acrobat-page-${pagina} .acrobat-text-block`)
    .filter({ has: page.locator('.text-block-content', { hasText: prefijo }) })
    .count();
}

/**
 * Edita una línea como lo haría una persona: clic sobre el texto, seleccionar
 * todo, escribir, y clic fuera para confirmar.
 */
export async function editarLinea(page, prefijo, textoNuevo, pagina = 1) {
  const bloque = await bloquePorTexto(page, prefijo, pagina);
  await bloque.locator('.text-block-content').click();
  await expect(bloque).toHaveClass(/editing/);

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(textoNuevo);

  // Confirmar saliendo del bloque (blur real, no un evento sintético).
  await page.locator('header').click({ position: { x: 5, y: 5 } });
  await expect(bloque).not.toHaveClass(/editing/);
  return bloque;
}

/** Dispara "Descargar PDF" y devuelve los bytes del archivo generado. */
export async function exportarPDF(page) {
  const descarga = await Promise.race([
    page.waitForEvent('download', { timeout: 45_000 }),
    page.locator('#btn-save-pdf').click().then(() => page.waitForEvent('download', { timeout: 45_000 }))
  ]);
  const ruta = await descarga.path();
  return fs.readFileSync(ruta);
}

/**
 * Extrae el texto seleccionable de un PDF usando la misma pdf.js que carga la
 * app. Es la aserción central de las regresiones de exportación: una línea que
 * el usuario no tocó tiene que seguir estando; la que borró, no.
 */
export async function textoExtraidoDelPDF(page, bytes) {
  return page.evaluate(async (arr) => {
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
    const paginas = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const tc = await p.getTextContent();
      paginas.push(tc.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim());
    }
    await doc.destroy();
    return paginas;
  }, Array.from(bytes));
}

/** Carga bytes de PDF en el visor (para inspeccionar un export ya generado). */
export async function cargarBytesEnVisor(page, bytes, nombre = 'exportado.pdf') {
  await page.evaluate(
    async ([arr, n]) => {
      const buf = new Uint8Array(arr).buffer;
      await window.unifiedApp.loadPDFBuffer(buf, n, buf.byteLength);
    },
    [Array.from(bytes), nombre]
  );
  await page.waitForFunction(() => document.getElementById('global-loading-overlay').classList.contains('hidden'));
}

/**
 * Cuenta píxeles oscuros por franja horizontal del canvas de una página.
 *
 * Es la forma fiable de comprobar "una edición solo puede alterar lo que el
 * usuario tocó": las franjas que el usuario no tocó tienen que salir con el
 * MISMO perfil antes y después. Extraer el texto no sirve para esto — el
 * parche blanco se pinta encima y los objetos de texto originales siguen en el
 * flujo de contenido debajo (ver E-024).
 */
export async function perfilDeFilas(page, pagina = 1, altoFranja = 8) {
  return page.evaluate(
    ([pg, franja]) => {
      const obj = window.unifiedApp.renderedPages.get(pg);
      const canvas = obj.pdfCanvas;
      const ctx = canvas.getContext('2d');
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const perfil = [];
      for (let y0 = 0; y0 < height; y0 += franja) {
        let oscuros = 0;
        for (let y = y0; y < Math.min(y0 + franja, height); y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            // Luminancia por debajo de 200 = tinta, no papel.
            if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 200) oscuros++;
          }
        }
        perfil.push(oscuros);
      }
      return { perfil, franja, alto: height };
    },
    [pagina, altoFranja]
  );
}

/**
 * Índices de franja que cambiaron entre dos perfiles.
 * `tolerancia` absorbe el ruido de antialiasing entre renders.
 */
export function franjasCambiadas(antes, despues, tolerancia = 40) {
  const cambiadas = [];
  const n = Math.min(antes.length, despues.length);
  for (let i = 0; i < n; i++) {
    if (Math.abs(antes[i] - despues[i]) > tolerancia) cambiadas.push(i);
  }
  return cambiadas;
}
