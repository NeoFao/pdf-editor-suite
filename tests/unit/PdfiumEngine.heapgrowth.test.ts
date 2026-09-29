import { test, expect, beforeAll, afterAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { chromium, type Browser } from '@playwright/test';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

/**
 * E-035 (docs/ERRORES-CONOCIDOS.md): `Mem.HEAPU8` capturado como valor en
 * `makeMem()` en vez de como getter se desconectaba ("detached") en cuanto
 * el heap WASM crecía a mitad de una operación — casi todas las operaciones
 * del motor tocan pocos KB, así que el heap rara vez necesita crecer y el
 * defecto llevaba invisible desde que `mem.ts` existe; una imagen de varios
 * megapíxeles (RGBA sin comprimir) sí lo dispara con facilidad. Necesita un
 * JPEG REAL (`replaceImageJpeg` lo decodifica de verdad), generado con un
 * `<canvas>` en Chromium vía Playwright — igual razón que en
 * `PdfiumEngine.imagepixels.test.ts`.
 */
let browser: Browser;
let JPEG: Uint8Array;

beforeAll(async () => {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 4;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgb(10,10,10)';
    ctx.fillRect(0, 0, 4, 4);
    return c.toDataURL('image/jpeg', 0.5);
  });
  await page.close();
  JPEG = new Uint8Array(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
}, 30000);

afterAll(async () => { await browser.close(); });

test('E-035: replaceImageJpeg con una imagen grande (2000×2000) no falla por buffer WASM desconectado', async () => {
  const d = await PDFDocument.create();
  d.addPage([72, 72]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());

  // 2000×2000×4 bytes RGBA (16 MB) sin comprimir: suficiente para forzar un
  // crecimiento del heap WASM más allá de su reserva inicial.
  const w = 2000, h = 2000;
  const rgba = new Uint8Array(w * h * 4).fill(128);
  eng.insertImage(doc, 0, { rgba, imgWidth: w, imgHeight: h, xPt: 0, yPt: 0, wPt: 72, hPt: 72 });

  const img = eng.listImageObjects(doc, 0)[0]!;
  const ok = eng.replaceImageJpeg(doc, 0, img.objIndex, JPEG);
  expect(ok).toBe(true);

  const pix = eng.getImagePixels(doc, 0, img.objIndex)!;
  expect(pix.width).toBe(4);
  expect(pix.height).toBe(4);

  eng.close(doc);
});
