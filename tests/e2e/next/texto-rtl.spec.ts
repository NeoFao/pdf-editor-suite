import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { agruparLineasEditables } from '../../../src/texto/lineasEditables';

/**
 * E-117: texto de derecha a izquierda en Chromium real. `tests/fixtures/rtl/*.pdf` los generó Chromium con fuentes del
 * sistema (`generar-fixtures-rtl.mjs`); se confirman ya generados, no se regeneran en CI.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RTL = path.resolve(AQUI, '../../fixtures/rtl');

async function abrir(page: Page, fichero: string): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(path.join(RTL, fichero));
  await expect(page.locator('.run').first()).toBeVisible();
}

test('editar una palabra hebrea: el PDF guardado trae el texto nuevo, en su sitio y el editor es RTL', async ({ page }) => {
  await abrir(page, 'rtl-hebreo.pdf');
  const run = page.locator('.run', { hasText: 'עולם' }).first();
  const antes = (await run.boundingBox())!;
  await expect(run).toHaveAttribute('dir', 'rtl');
  await run.click();
  await expect(run).toHaveClass(/editing/);
  expect(await run.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('שלום שלום זה טקסט בעברית');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Editado.');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'hebreo-editado.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const lineas = agruparLineasEditables(eng.getPageText(doc, 0), 0);
  eng.close(doc);
  expect(lineas.map((l) => l.text)).toEqual(['שלום שלום זה טקסט בעברית', 'הכל בסדר גמור היום', 'Linea latina de control']);
  // El borde derecho de la línea editada no se movió (más de 3 px CSS ya sería una línea desplazada).
  const despues = (await page.locator('.run', { hasText: 'שלום שלום' }).first().boundingBox())!;
  expect(Math.abs(despues.x + despues.width - (antes.x + antes.width))).toBeLessThan(3);
});

test('copiar una línea mixta da el texto exacto, en orden lógico', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await abrir(page, 'rtl-mixto.pdf');
  const run = page.locator('.run', { hasText: 'Hola' }).first();
  const b = (await run.boundingBox())!;
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(b.x + 20, y + 1, { steps: 3 });
  await page.mouse.move(b.x + b.width - 1, y, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.sel-rect').first()).toBeVisible();
  await page.keyboard.press('Control+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Hola שלום 123 fin');
});

test('la línea árabe no se reescribe: se selecciona, muestra el aviso aproximado y no se abre para editar', async ({ page }) => {
  await abrir(page, 'rtl-arabe.pdf');
  const run = page.locator('.run', { hasText: 'مرحبا' }).first();
  await expect(run).toHaveAttribute('data-aviso', 'aproximado');
  await run.click();
  await expect(run).not.toHaveClass(/editing/);
  await expect(run).toHaveClass(/selected/);
  await expect(page.locator('#status')).toContainText('árabe');
  expect(await run.evaluate((el) => (el as HTMLElement).isContentEditable)).toBe(false);
});
