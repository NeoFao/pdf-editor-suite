import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTES = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

async function editar(page: import('@playwright/test').Page, texto: string): Promise<void> {
  await page.locator('.run', { hasText: 'ORIGINAL-TIMES' }).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(texto);
  await page.keyboard.press('Enter');
  await expect(page.locator('.run', { hasText: texto })).toBeVisible();
}

test('modal abierto: Ctrl+Z, Ctrl+Y y las teclas de herramienta no tocan el documento de detrás', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();
  await editar(page, 'TEXTO DETRAS');

  await page.locator('#btn-shortcuts').click();
  await expect(page.locator('#shortcuts-dialog[open]')).toBeVisible();
  const estado = await page.locator('#status').textContent();

  await page.keyboard.press('Control+Z');
  await page.keyboard.press('n');
  await page.keyboard.press('r');
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Y');

  // El documento sigue igual, el estado no cambió y el diálogo sigue ahí.
  await expect(page.locator('#status')).toHaveText(estado ?? '');
  await expect(page.locator('#shortcuts-dialog[open]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#shortcuts-dialog')).toHaveCount(0);
  await expect(page.locator('.run', { hasText: 'TEXTO DETRAS' })).toBeVisible();
  await expect(page.locator('.run', { hasText: 'ORIGINAL-TIMES' })).toHaveCount(0);

  // Sin modal, Ctrl+Z vuelve a funcionar.
  await page.keyboard.press('Control+Z');
  await expect(page.locator('.run', { hasText: 'ORIGINAL-TIMES' })).toBeVisible();
});
