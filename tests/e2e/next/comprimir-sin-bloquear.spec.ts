import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

// T9 (E-055): "Comprimir" cede el hilo entre imágenes, informa del avance y se puede cancelar
// sin dejar el documento a medias. Los asserts son sobre TRABAJO (frames, valores de la barra,
// bytes), nunca sobre milisegundos (E-040).

const PAGINAS = 10;
const LADO = 600; // px; en una página de 1 in = 600 dpi → siempre hay que reescalar a 150

/** PDF de PAGINAS páginas con una imagen ruidosa (incompresible) en cada una, creado con el motor real. */
async function crearPdfConImagenes(destino: string): Promise<void> {
  const d = await PDFDocument.create();
  for (let i = 0; i < PAGINAS; i++) d.addPage([72, 72]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(await d.save()));
  const rgba = new Uint8Array(LADO * LADO * 4);
  let semilla = 12345;
  for (let i = 0; i < LADO * LADO; i++) {
    semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0;
    const v = semilla >>> 24;
    rgba[i * 4] = v; rgba[i * 4 + 1] = (v * 7) & 255; rgba[i * 4 + 2] = (v * 13) & 255; rgba[i * 4 + 3] = 255;
  }
  for (let p = 0; p < PAGINAS; p++) {
    eng.insertImage(doc, p, { rgba, imgWidth: LADO, imgHeight: LADO, xPt: 0, yPt: 0, wPt: 72, hPt: 72 });
  }
  fs.writeFileSync(destino, await eng.saveCompact(doc));
  eng.close(doc);
}

async function descargar(page: Page, nombre: string): Promise<Uint8Array> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await download.saveAs(destino);
  return new Uint8Array(fs.readFileSync(destino));
}

/**
 * Retiene la codificación JPEG de la 3.ª imagen hasta `window.__soltarCompresion()`: así "a mitad"
 * es determinista (sin carreras contra el reloj): la compresión se queda parada en la imagen 3/10.
 * Desde T15 la codificación va al worker: se retiene el envío de la 3.ª petición 'jpeg' al worker.
 */
async function retenerEnLaTercera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __soltarCompresion: () => void };
    let llamadas = 0;
    let soltar!: () => void;
    const puerta = new Promise<void>((r) => { soltar = r; });
    w.__soltarCompresion = soltar;
    const orig = Worker.prototype.postMessage as (this: Worker, ...a: unknown[]) => void;
    Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
      const msg = args[0] as { tipo?: string } | undefined;
      if (msg?.tipo === 'jpeg' && ++llamadas === 3) void puerta.then(() => { try { orig.apply(this, args); } catch { /* worker ya cerrado por la cancelación */ } });
      else orig.apply(this, args);
    } as typeof Worker.prototype.postMessage;
  });
}

async function abrirYPrepararPanel(page: Page, pdf: string): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(pdf);
  await expect(page.locator('#status')).toHaveText(`${PAGINAS} página(s)`, { timeout: 60_000 });
  await abrirPestana(page, 'convertir');
  await page.locator('#btn-compress').click();
  await page.locator('#compress-dpi').selectOption('150');
}

test('comprimir cede el hilo: los frames avanzan durante la compresión y la barra de progreso sube', async ({ page }) => {
  test.setTimeout(180_000);
  const pdf = path.join(test.info().outputDir, 'imagenes.pdf');
  fs.mkdirSync(path.dirname(pdf), { recursive: true });
  await crearPdfConImagenes(pdf);
  await abrirYPrepararPanel(page, pdf);

  // Cuenta frames (requestAnimationFrame) y valores distintos de aria-valuenow desde ya.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __valores: Set<string>; __rol: string | null };
    w.__frames = 0; w.__valores = new Set(); w.__rol = null;
    const tick = (): void => { w.__frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    new MutationObserver(() => {
      const b = document.querySelector('#compress-progress');
      if (b) { w.__rol = b.getAttribute('role'); w.__valores.add(b.getAttribute('aria-valuenow') ?? ''); }
    }).observe(document.body, { subtree: true, attributes: true, childList: true });
  });

  const framesAntes = await page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  await page.locator('#btn-compress-run').click();
  await expect(page.locator('#status')).toContainText(/Comprimiendo… imagen \d+\/10 \(página \d+\/10\)/);
  await expect(page.locator('#status')).toContainText('Comprimido:', { timeout: 120_000 });

  const r = await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __valores: Set<string>; __rol: string | null };
    return { frames: w.__frames, valores: [...w.__valores], rol: w.__rol };
  });
  // Con 10 imágenes y una cesión por imagen, el navegador tuvo ocasión de pintar frames mientras comprimía.
  expect(r.frames - framesAntes).toBeGreaterThanOrEqual(3);
  expect(r.rol).toBe('progressbar');
  expect(new Set(r.valores).size).toBeGreaterThanOrEqual(3); // la barra avanzó de verdad
});

test('Cancelar a mitad deja el documento exactamente como estaba (comprobado con el motor sobre #btn-save)', async ({ page }) => {
  test.setTimeout(180_000);
  const eng = await PdfiumEngine.create();
  const pdf = path.join(test.info().outputDir, 'imagenes.pdf');
  fs.mkdirSync(path.dirname(pdf), { recursive: true });
  await crearPdfConImagenes(pdf);
  await retenerEnLaTercera(page);
  await abrirYPrepararPanel(page, pdf);
  // Referencia: lo que guarda la app SIN haber comprimido (se hace con el panel cerrado).
  await page.keyboard.press('Escape');
  await expect(page.locator('#compress-panel')).toHaveCount(0);
  const antes = await descargar(page, 'antes.pdf');
  await page.locator('#btn-compress').click();
  await page.locator('#compress-dpi').selectOption('150');

  await page.locator('#btn-compress-run').click();
  await expect(page.locator('#status')).toContainText('imagen 3/10');
  await expect(page.locator('#compress-progress')).toHaveAttribute('aria-valuenow', '20'); // 2 de 10 hechas
  await page.locator('#compress-cancel').click();
  await page.evaluate(() => (window as unknown as { __soltarCompresion: () => void }).__soltarCompresion());

  await expect(page.locator('#status')).toContainText('Compresión cancelada');
  await expect(page.locator('#compress-panel')).toHaveCount(0);

  const despues = await descargar(page, 'despues.pdf');
  expect(despues.length).toBe(antes.length);
  expect(Buffer.from(despues).equals(Buffer.from(antes))).toBe(true);
  const doc = await eng.open(despues);
  expect(eng.pageCount(doc)).toBe(PAGINAS);
  for (let p = 0; p < PAGINAS; p++) {
    const pix = eng.getImagePixels(doc, p, eng.listImageObjects(doc, p)[0]!.objIndex)!;
    expect(pix.width).toBe(LADO); // ninguna imagen quedó reescalada a medias
  }
  eng.close(doc);
});

test('Escape durante la compresión también cancela', async ({ page }) => {
  test.setTimeout(180_000);
  const pdf = path.join(test.info().outputDir, 'imagenes.pdf');
  fs.mkdirSync(path.dirname(pdf), { recursive: true });
  await crearPdfConImagenes(pdf);
  await retenerEnLaTercera(page);
  await abrirYPrepararPanel(page, pdf);
  await page.locator('#btn-compress-run').click();
  await expect(page.locator('#status')).toContainText('imagen 3/10');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as { __soltarCompresion: () => void }).__soltarCompresion());
  await expect(page.locator('#status')).toContainText('Compresión cancelada');
  await expect(page.locator('#compress-panel')).toHaveCount(0);
});
