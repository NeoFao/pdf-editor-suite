import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

// T16 (WCAG 2.1.1): lo que antes exigía ratón se puede hacer con el teclado.
//  - Selección de texto: con una línea enfocada (roving tabindex), Mayús+→/← amplía o reduce un carácter
//    y Mayús+↓/↑ una línea; Resaltar/Subrayar/Tachar y Ctrl+C usan esa selección; Escape la descarta;
//    el lector la anuncia en la región aria-live (#status).
//  - Anotaciones: Alt+↓/↑ recorre las de la página en orden de lectura (la actual queda seleccionada como
//    con el clic de T14 y se anuncia); Supr la borra (con deshacer) y Escape la suelta.
// NINGÚN gesto de este fichero usa el ratón (lo vigila tests/unit/teclado-sin-raton.test.ts).
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

const L1_INICIO = 'Informe Tecnico';
const L2 = 'La segunda linea sirve para probar la edicion in-place.';
const L3 = 'Tercera linea con numeros: 1234567890 y simbolos.';
const L4 = 'Cuarta linea para verificar el agrupamiento por renglones.';

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(NATIVO);
  await expect(page.locator('.run').first()).toBeVisible();
}

/** Activa una pestaña de la barra con el teclado (foco + Enter), como lo haría quien no usa ratón. */
async function pestana(page: Page, id: string): Promise<void> {
  await page.locator(id).focus();
  await page.keyboard.press('Enter');
}

/** Enfoca una línea por teclado: Tab desde el visor llega al tabstop de la capa y las flechas recorren las líneas. */
async function enfocarPorTeclado(page: Page, texto: string): Promise<void> {
  await page.locator('#viewer').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.run:focus')).toHaveCount(1);
  for (let i = 0; i < 20; i++) {
    if ((await page.locator('.run:focus').textContent())?.includes(texto)) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`No se llegó a la línea «${texto}» con las flechas`);
}

/** Pulsa un botón de la barra sin ratón: foco + Enter. */
async function pulsar(page: Page, id: string): Promise<void> {
  await page.locator(id).focus();
  await page.keyboard.press('Enter');
}

async function copiarPorTeclado(page: Page): Promise<string> {
  await page.keyboard.press('Control+c');
  return page.evaluate(() => navigator.clipboard.readText());
}

test('Tab + flechas enfocan la línea 2; Mayús+→ ×5 selecciona 5 caracteres, se anuncia y Ctrl+C los copia', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await abrir(page);
  await enfocarPorTeclado(page, L2);
  await expect(page.locator('.sel-rect')).toHaveCount(0); // en reposo no hay nada pintado

  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('.sel-rect')).toHaveCount(1);
  await expect(page.locator('#status')).toHaveText('Seleccionado: «La se»');
  await expect(page.locator('#status')).toHaveAttribute('aria-live', 'polite');
  expect(await copiarPorTeclado(page)).toBe('La se');

  // El foco no se movió: sigue en la línea 2, y Mayús+← reduce de uno en uno.
  await expect(page.locator('.run:focus')).toContainText(L2);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.locator('#status')).toHaveText('Seleccionado: «La s»');
  expect(await copiarPorTeclado(page)).toBe('La s');
});

test('Mayús+← hasta el ancla vacía la selección; Escape descarta una selección vigente', async ({ page }) => {
  await abrir(page);
  await enfocarPorTeclado(page, L2);
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('.sel-rect')).toHaveCount(1);
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.locator('.sel-rect')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveText('Selección vacía.');

  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('.sel-rect')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sel-rect')).toHaveCount(0);
});

test('Mayús+↓ amplía la selección a la línea siguiente y Mayús+↑ la reduce', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await abrir(page);
  await enfocarPorTeclado(page, L2);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('.sel-rect')).toHaveCount(2); // la línea 2 entera y la cabeza de la 3

  const copiado = await copiarPorTeclado(page);
  const trozos = copiado.split('\n');
  expect(trozos).toHaveLength(2);
  expect(trozos[0]).toBe(L2);
  expect(trozos[1]!.length).toBeGreaterThan(0);
  expect(trozos[1]!.length).toBeLessThan(L3.length);
  expect(L3.startsWith(trozos[1]!)).toBe(true);

  await page.keyboard.press('Shift+ArrowUp');
  await expect(page.locator('.sel-rect')).toHaveCount(1);
});

test('Resaltar con el teclado crea la anotación del tramo seleccionado (no de la línea entera)', async ({ page }) => {
  await abrir(page);
  await pestana(page, '#tab-comentar');
  await enfocarPorTeclado(page, L2);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  const caja = (await page.locator('.run', { hasText: L2 }).boundingBox())!;
  const sel = (await page.locator('.sel-rect').boundingBox())!;
  expect(sel.width).toBeGreaterThan(5);
  expect(sel.width).toBeLessThan(caja.width / 4);

  await pulsar(page, '#btn-highlight');
  await expect(page.locator('#status')).toHaveText('Resaltado.');
  await expect(page.locator('.sel-rect')).toHaveCount(0);

  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const destino = path.join(test.info().outputDir, 'resaltado-teclado.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const marcas = eng.getComments(doc, 0).filter((c) => c.kind === 'highlight');
  expect(marcas).toHaveLength(1);
  const quads = eng.getMarkupQuads(doc, 0, marcas[0]!.index);
  expect(quads).toHaveLength(1);
  const anchoPt = quads[0]![2] - quads[0]![0];
  // 5 caracteres de ~12 pt: unos 30 pt; la línea entera mediría unos 300 pt.
  expect(anchoPt).toBeGreaterThan(10);
  expect(anchoPt).toBeLessThan(80);
});

test('Alt+↓/↑ recorren las anotaciones en orden de lectura; la 2.ª queda seleccionada y se anuncia; Supr la borra; deshacer la devuelve; Escape la suelta', async ({ page }) => {
  await abrir(page);
  await pestana(page, '#tab-comentar');

  // Se crean en orden DISTINTO al de lectura (L4, L2, L3) para probar que se recorren de arriba abajo.
  for (const linea of [L4, L2, L3]) {
    await enfocarPorTeclado(page, linea);
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await pulsar(page, '#btn-highlight');
    await expect(page.locator('#status')).toHaveText('Resaltado.');
  }

  await enfocarPorTeclado(page, L1_INICIO);
  await expect(page.locator('.marcado-sel')).toHaveCount(0); // en reposo nada seleccionado ni pintado

  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('#status')).toContainText('Resaltado 1 de 3: «La»');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('#status')).toContainText('Resaltado 2 de 3: «Te»');
  const sel = page.locator('.marcado-sel');
  await expect(sel).toHaveCount(1);
  await expect(sel).toHaveAttribute('role', 'option');
  await expect(sel).toHaveAttribute('aria-selected', 'true');
  await expect(sel).toHaveAttribute('data-tipo', 'highlight');
  await expect(page.locator('.marcado-sel-quad').first()).toBeVisible();

  // Alt+↑ vuelve a la 1.ª; Alt+↓ dos veces llega a la 3.ª y da la vuelta a la 1.ª.
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.locator('#status')).toContainText('Resaltado 1 de 3: «La»');
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('#status')).toContainText('Resaltado 3 de 3: «Cu»');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('#status')).toContainText('Resaltado 1 de 3');

  // Escape la suelta.
  await page.keyboard.press('Escape');
  await expect(page.locator('.marcado-sel')).toHaveCount(0);

  // Supr borra la 2.ª; deshacer la devuelve.
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('#status')).toContainText('Resaltado 2 de 3: «Te»');
  await page.keyboard.press('Delete');
  await expect(page.locator('.marcado-sel')).toHaveCount(0);
  await expect(page.locator('#status')).toContainText('Resaltado borrado');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('#status')).toContainText('Resaltado 1 de 2');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+z');
  await expect(page.locator('#status')).not.toContainText('Resaltado borrado');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('#status')).toContainText('Resaltado 1 de 3');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('#status')).toContainText('Resaltado 2 de 3: «Te»');
});

test('Alt+↓ en una página sin anotaciones lo dice y no deja nada seleccionado', async ({ page }) => {
  await abrir(page);
  await enfocarPorTeclado(page, L2);
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('#status')).toHaveText('No hay anotaciones en esta página.');
  await expect(page.locator('.marcado-sel')).toHaveCount(0);
});

test('los atajos nuevos figuran en el panel de ayuda (?)', async ({ page }) => {
  await abrir(page);
  await page.locator('#viewer').focus();
  await page.keyboard.press('?');
  const tabla = page.locator('#shortcuts-table');
  await expect(tabla).toContainText('Mayús + →');
  await expect(tabla).toContainText('Mayús + ↓');
  await expect(tabla).toContainText('Alt + ↓');
});
