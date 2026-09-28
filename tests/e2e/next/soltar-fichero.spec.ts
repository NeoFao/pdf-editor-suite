import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PDF_FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');
const IMG_FIXTURE = path.resolve(AQUI, '../../fixtures/generados/rojo.png');

/** Construye un `DataTransfer` (con un único fichero) dentro de la página, como en un arrastre real. */
async function dataTransferConFichero(page: Page, filePath: string, fileName: string, mime: string) {
  const bytes = Array.from(fs.readFileSync(filePath));
  return page.evaluateHandle(({ bytes, fileName, mime }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], fileName, { type: mime }));
    return dt;
  }, { bytes, fileName, mime });
}

test('soltar un PDF sobre la ventana lo abre (con indicación visual durante el arrastre)', async ({ page }) => {
  await page.goto('/index.next.html');
  const dt = await dataTransferConFichero(page, PDF_FIXTURE, 'nativo.pdf', 'application/pdf');

  await page.dispatchEvent('#app', 'dragover', { dataTransfer: dt });
  await expect(page.locator('#app')).toHaveClass(/drop-activo/);

  await page.dispatchEvent('#app', 'drop', { dataTransfer: dt });
  await expect(page.locator('#app')).not.toHaveClass(/drop-activo/);

  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('#page-indicator')).toHaveText('1 / 2'); // nativo.pdf tiene 2 páginas
});

test('soltar una imagen la abre como PDF de una página', async ({ page }) => {
  await page.goto('/index.next.html');
  const dt = await dataTransferConFichero(page, IMG_FIXTURE, 'rojo.png', 'image/png');

  await page.dispatchEvent('#app', 'drop', { dataTransfer: dt });

  await expect(page.locator('.page')).toHaveCount(1);
  await expect(page.locator('#status')).toHaveText('Imagen abierta como PDF.');
});

test('soltar un tipo de archivo no admitido avisa en #status sin romper nada', async ({ page }) => {
  await page.goto('/index.next.html');
  const dt = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1, 2, 3])], 'notas.txt', { type: 'text/plain' }));
    return dt;
  });

  await page.dispatchEvent('#app', 'drop', { dataTransfer: dt });

  await expect(page.locator('#status')).toContainText('no admitido');
  await expect(page.locator('.page')).toHaveCount(0);
});
