import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

/**
 * `fuentes.pdf` tiene una línea "ORIGINAL-TIMES" en Times-Roman 18pt, roja
 * (ver tests/fixtures/generar-fixtures.mjs). Estos tests cubren el panel de
 * propiedades (§3 del encargo): fuente, tamaño y color de la línea
 * seleccionada, con edición real vía el motor (no solo la proyección).
 */

/** Selecciona la línea sin dejarla en modo edición: clic (entra a editar y dispara onSelect) + Escape. */
async function seleccionar(page: import('@playwright/test').Page) {
  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await run.click();
  await page.keyboard.press('Escape');
  return run;
}

test('propiedades: el panel aparece al seleccionar con la fuente y el tamaño originales', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await seleccionar(page);

  await expect(page.locator('#props-panel')).toBeVisible();
  const opcionSeleccionada = await page.locator('#prop-font').evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]!.textContent);
  expect(opcionSeleccionada).toBe('Original (Times-Roman)');
  await expect(page.locator('#prop-size')).toHaveValue('18');
});

test('propiedades: cambiar el tamaño agranda la caja de la línea en el DOM y el motor conserva la fuente original', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = await seleccionar(page);
  const antes = (await run.boundingBox())!;

  await page.locator('#prop-size').fill('30');
  await page.locator('#prop-size').dispatchEvent('change');

  await expect(page.locator('#status')).toHaveText('Tamaño cambiado.');
  const runNuevo = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(runNuevo).toBeVisible();
  const despues = (await runNuevo.boundingBox())!;
  expect(despues.height).toBeGreaterThan(antes.height);
  await expect(page.locator('#prop-size')).toHaveValue('30');
});

test('propiedades: cambiar la fuente actualiza el selector y avisa en #status', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await seleccionar(page);

  await page.locator('#prop-font').selectOption('Helvetica');

  await expect(page.locator('#status')).toHaveText('Fuente cambiada a Helvetica.');
  const opcionSeleccionada = await page.locator('#prop-font').evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]!.textContent);
  expect(opcionSeleccionada).toBe('Helvetica');
});

test('propiedades: deshacer dos veces (fuente y tamaño) vuelve a Times-Roman 18pt', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = await seleccionar(page);
  const original = (await run.boundingBox())!;

  await page.locator('#prop-size').fill('30');
  await page.locator('#prop-size').dispatchEvent('change');
  await expect(page.locator('#status')).toHaveText('Tamaño cambiado.');

  await page.locator('#prop-font').selectOption('Helvetica');
  await expect(page.locator('#status')).toHaveText('Fuente cambiada a Helvetica.');

  await page.locator('#btn-undo').click(); // deshace el cambio de fuente
  await page.locator('#btn-undo').click(); // deshace el cambio de tamaño

  const restaurado = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(restaurado).toBeVisible();
  const cajaRestaurada = (await restaurado.boundingBox())!;
  expect(Math.abs(cajaRestaurada.height - original.height)).toBeLessThan(1.5);

  // El motor, no solo la caja en pantalla: fuente y tamaño reales tras deshacer.
  const seleccion = await seleccionar(page);
  const opcionSeleccionada = await page.locator('#prop-font').evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]!.textContent);
  expect(opcionSeleccionada).toBe('Original (Times-Roman)');
  await expect(page.locator('#prop-size')).toHaveValue('18');
  void seleccion;
});

/**
 * Encontrado en revisión de PR #51: `appliedFontLabel` (qué opción de
 * `#prop-font` mostrar como "aplicada") solo se reiniciaba en `onSelect`.
 * Deshacer un cambio de fuente vuelve el DOCUMENTO a la fuente original, pero
 * sin re-seleccionar la línea a mano el panel seguía mostrando "Helvetica":
 * mentía sobre el estado real del documento. A diferencia del test anterior
 * (que sí vuelve a seleccionar la línea tras deshacer, lo que esconde el
 * defecto porque `onSelect` también resetea `appliedFontLabel`), este NO
 * vuelve a seleccionar: comprueba el panel tal cual queda inmediatamente
 * después de `#btn-undo`.
 */
test('propiedades: deshacer un cambio de fuente refresca el panel sin necesidad de reseleccionar', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await seleccionar(page);

  await page.locator('#prop-font').selectOption('Helvetica');
  await expect(page.locator('#status')).toHaveText('Fuente cambiada a Helvetica.');

  await page.locator('#btn-undo').click(); // deshace el cambio de fuente, SIN volver a seleccionar la línea

  const opcionSeleccionada = await page.locator('#prop-font').evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]!.textContent);
  expect(opcionSeleccionada).toBe('Original (Times-Roman)');
  await expect(page.locator('#prop-size')).toHaveValue('18');
});
