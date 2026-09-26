import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

test('edicion-fiel: editar una linea llega al PDF descargado conservando su tipografia', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);

  // Aparece la capa de texto con la línea Times original.
  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(run).toBeVisible();

  // Editar en sitio: seleccionar todo y reescribir.
  await run.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('TEXTO NUEVO');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Editado.');

  // Guardar y capturar la descarga.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-save').click()
  ]);
  const destino = path.join(test.info().outputDir, 'descargado.pdf');
  await download.saveAs(destino);
  const bytes = new Uint8Array(fs.readFileSync(destino));

  // Verificar el PDF resultante con el motor (en Node).
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(bytes);
  const runs = eng.getPageText(doc, 0);
  const textos = runs.map((r) => r.text);

  // (a) el texto editado está y es extraíble; (b) el original ya no está;
  // (c) la otra línea intacta.
  expect(textos.some((t) => t.includes('TEXTO NUEVO'))).toBe(true);
  expect(textos.some((t) => t.includes('ORIGINAL-TIMES'))).toBe(false);
  expect(textos.some((t) => t.includes('helvetica'))).toBe(true);

  // (d) fidelidad: la línea editada sigue en Times, 18pt y color rojo.
  const editado = runs.find((r) => r.text.includes('TEXTO NUEVO'))!;
  expect(editado.fontName).toContain('Times');
  expect(Math.round(editado.sizePt)).toBe(18);
  expect(editado.color[0]).toBeGreaterThan(200);
  expect(editado.color[1]).toBeLessThan(100);
  eng.close(doc);
});
