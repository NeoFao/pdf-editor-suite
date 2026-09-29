import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf'); // 2 páginas

test('extraer: descarga la página actual como un PDF de una sola página', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await abrirPestana(page, 'organizar');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-extract').click()]);
  const destino = path.join(test.info().outputDir, 'extraida.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  expect(eng.pageCount(doc)).toBe(1);
  expect(eng.getPageText(doc, 0).map((r) => r.text).join(' ')).toContain('Informe');
  eng.close(doc);
});
