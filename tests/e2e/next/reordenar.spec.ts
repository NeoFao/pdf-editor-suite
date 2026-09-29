import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf'); // pág1 "Informe…", pág2 "…Anexos"

test('reordenar: bajar la página 1 la coloca después en el PDF descargado', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await abrirPestana(page, 'organizar');
  await page.locator('#btn-page-down').click(); // mueve la página actual (0) a la posición 1
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'reordenada.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  // Ahora la primera página es la antigua página 2 ("Anexos").
  expect(eng.getPageText(doc, 0).map((r) => r.text).join(' ')).toContain('Anexos');
  eng.close(doc);
});
