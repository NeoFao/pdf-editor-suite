import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

test('subrayar y tachar: las anotaciones llegan al PDF descargado sin borrar el texto', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(run).toBeVisible();

  await abrirPestana(page, 'comentar');
  await run.click(); // selecciona
  await page.locator('#btn-underline').click();
  await expect(page.locator('#status')).toHaveText('Subrayado.');

  await run.click(); // vuelve a seleccionar
  await page.locator('#btn-strike').click();
  await expect(page.locator('#status')).toHaveText('Tachado.');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'subrayado-tachado.pdf');
  await download.saveAs(destino);

  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const texto = eng.getPageText(doc, 0).map((r) => r.text).join(' ');
  expect(texto).toContain('ORIGINAL-TIMES');
  eng.close(doc);
});
