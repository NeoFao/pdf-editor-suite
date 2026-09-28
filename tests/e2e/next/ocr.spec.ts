import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

test('OCR: reconoce texto en la página y lo reporta en el estado', async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = page.locator('.run').first();
  await expect(run).toBeVisible();

  await page.locator('#btn-ocr').click();
  const status = page.locator('#status');
  await expect(status).toContainText('línea(s) reconocida(s)', { timeout: 170_000 });

  const texto = (await status.textContent()) ?? '';
  const n = parseInt(texto, 10);
  expect(n).toBeGreaterThan(0);
});
