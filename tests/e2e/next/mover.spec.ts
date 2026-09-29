import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

test('mover: arrastrar una línea cambia su posición en el PDF descargado', async ({ page }) => {
  // Tamaño de página en pt, leído del propio PDF: con el ajuste al ancho al
  // abrir (#8) la escala inicial ya no es fija en 1, así que el desplazamiento
  // en px CSS que equivale a +40pt en X depende de la escala REAL aplicada.
  const engMedida = await PdfiumEngine.create();
  const docMedida = await engMedida.open(new Uint8Array(fs.readFileSync(FIXTURE)));
  const pageSize = engMedida.pageSize(docMedida, 0);
  engMedida.close(docMedida);

  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(run).toBeVisible();

  const cajaPagina = (await page.locator('.page').first().boundingBox())!;
  const escala = cajaPagina.width / pageSize.widthPt;
  const deltaCss = 40 * escala; // +40pt en X, en px CSS a la escala real

  // Arrastrar por el tirador +40pt (en px CSS reales) a la derecha.
  const handle = run.locator('.run-drag');
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + deltaCss, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'movido.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const run2 = eng.getPageText(doc, 0).find((r) => r.text.includes('ORIGINAL-TIMES'))!;
  // Original x=40 → tras +40 debe rondar 80; la Y (≈150) apenas cambia.
  expect(run2.boxPt.xPt).toBeGreaterThan(70);
  expect(Math.abs(run2.boxPt.yPt - 150)).toBeLessThan(12);
  eng.close(doc);
});

// E-034 (docs/ERRORES-CONOCIDOS.md): un pointercancel a mitad de arrastre
// (gesto táctil interrumpido, pérdida de la captura del puntero...) debe
// restaurar la posición de reposo del bloque y NO ejecutar MoveRunCmd.
test('E-034: pointercancel al arrastrar el tirador de una línea restaura su posición y deja de seguir el cursor', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(run).toBeVisible();

  const handle = run.locator('.run-drag');
  const b = (await handle.boundingBox())!;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const posAntes = (await run.boundingBox())!;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy, { steps: 6 });

  const posDurante = (await run.boundingBox())!;
  expect(posDurante.x - posAntes.x).toBeGreaterThan(30);

  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: true, pointerId: 1 })));

  const posTrasCancel = (await run.boundingBox())!;
  expect(Math.abs(posTrasCancel.x - posAntes.x)).toBeLessThan(2);

  // Un pointermove posterior ya no mueve el bloque: el listener se retiró con el cancel.
  await page.mouse.move(cx + 200, cy, { steps: 4 });
  const posFinal = (await run.boundingBox())!;
  expect(Math.abs(posFinal.x - posAntes.x)).toBeLessThan(2);

  await page.mouse.up();

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'cancel-no-mueve.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const run2 = eng.getPageText(doc, 0).find((r) => r.text.includes('ORIGINAL-TIMES'))!;
  // Igual que el original (x=40): ningún MoveRunCmd llegó a ejecutarse.
  expect(Math.abs(run2.boxPt.xPt - 40)).toBeLessThan(2);
  eng.close(doc);
});
