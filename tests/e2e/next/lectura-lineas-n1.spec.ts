import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.resolve(AQUI, '../../fixtures/generados');

/**
 * N1 F1 (E-079, E-080, E-081): comportamiento en Chromium real sobre los fixtures deterministas de línea editable.
 * `por-glifo.pdf` imita a Chrome (CTM 0,75: Tf nominal 14,66 → 11 pt efectivos); `cid-subconjunto.pdf` es un subconjunto CID
 * con solo H O L A M U N D y el espacio.
 */

test('E-080: en un PDF con CTM 0,75 el editor y el panel usan el tamaño EFECTIVO (11 pt), no el nominal (14,66)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(path.join(GEN, 'por-glifo.pdf'));
  const pagina = page.locator('.page').first();
  await expect(pagina).toBeVisible();
  // Escala REAL de la app (px CSS por pt): ancho del `.page` ÷ ancho de la página en pt (595,28).
  const escala = (await pagina.boundingBox())!.width / 595.28;

  // «Columna izquierda uno»: una línea de objetos de un glifo en Helvetica, 11 pt efectivos (N1: una .run por línea).
  const run = page.locator('.run', { hasText: 'Columna izquierda uno' });
  await expect(run).toBeVisible();
  await run.click();
  await expect(run).toHaveClass(/editing/);
  const fontSizePx = await run.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(Math.abs(fontSizePx - 11 * escala)).toBeLessThan(0.5); // antes: 14,66 × escala (un 33 % más grande)

  await page.keyboard.press('Escape');
  await expect(page.locator('#props-panel')).toBeVisible();
  await expect(page.locator('#prop-size')).toHaveValue('11'); // antes: 14.5
});

test('N1: en una línea compuesta el panel de propiedades está activo y muestra los valores de la línea', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(path.join(GEN, 'por-glifo.pdf'));
  const run = page.locator('.run', { hasText: 'Columna izquierda uno' });
  await run.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#props-panel')).toBeVisible();
  await expect(page.locator('#prop-size')).toHaveValue('11');
  for (const id of ['#prop-size', '#prop-font', '#btn-color']) await expect(page.locator(id)).toBeEnabled();
});

test('E-079: editar un subconjunto CID con un carácter ausente sustituye la fuente y el texto sobrevive (no .notdef)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(path.join(GEN, 'cid-subconjunto.pdf'));
  const run = page.locator('.run').first();
  await expect(run).toHaveText('HOLA MUNDO');

  await run.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('HOLA €');
  await page.keyboard.press('Enter');

  // Antes: «Editado.» y el «€» se perdía (cuadro .notdef). Ahora entra la sustitución de fuente (E-047).
  await expect(page.locator('#status')).toHaveText('La fuente original no tiene algún carácter; la línea usa Helvetica.');
  await expect(page.locator('.run', { hasText: 'HOLA €' })).toBeVisible();

  // Deshacer vuelve exactamente al texto original.
  await page.locator('#btn-undo').click();
  await expect(page.locator('.run').first()).toHaveText('HOLA MUNDO');
});

test('E-079: editar el subconjunto CID solo con glifos presentes sigue siendo en sitio (sin cambio de fuente)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(path.join(GEN, 'cid-subconjunto.pdf'));
  const run = page.locator('.run').first();
  await run.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('MANO LUNA');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Editado.');
  await expect(page.locator('.run').first()).toHaveText('MANO LUNA');
});

test('E-081: dejar una línea vacía no rompe el motor: se repone el texto, se avisa y se puede seguir editando', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(path.join(GEN, 'nativo.pdf'));
  const run = page.locator('.run', { hasText: 'Quinta linea final' });
  await expect(run).toBeVisible();

  await run.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Una línea no puede quedar vacía; selecciónala y usa Borrar para quitarla.');
  await expect(run).toHaveText('Quinta linea final del parrafo de prueba.');

  // El motor sigue vivo: una edición normal posterior funciona.
  await run.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Sigo vivo');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Editado.');
  await expect(page.locator('.run', { hasText: 'Sigo vivo' })).toBeVisible();
});
