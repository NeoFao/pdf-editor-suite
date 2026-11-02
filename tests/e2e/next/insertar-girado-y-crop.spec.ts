import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { PageGeometry } from '../../../src/coords/PageGeometry';

/**
 * E-123 (D2): insertar texto en una página con `/Rotate` lo dejaba vertical (90/270) o boca abajo (180): se escribía con la
 * matriz identidad en el espacio de usuario. Debe verse horizontal y de izquierda a derecha EN PANTALLA (como Acrobat y como el
 * OCR, E-089), con el origen en el clic.
 * E-123 (D4): el texto fuera de la CropBox no se ofrece como línea editable (capa de texto) pero sigue en el PDF guardado.
 */
async function abrirBytes(page: Page, bytes: Uint8Array, nombre: string): Promise<void> {
  const ruta = path.join(test.info().outputDir, nombre);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, bytes);
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(ruta);
  await expect(page.locator('.page').first()).toBeVisible();
}

async function guardar(page: Page): Promise<Uint8Array> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'salida.pdf');
  await dl.saveAs(destino);
  return new Uint8Array(fs.readFileSync(destino));
}

for (const rot of [0, 90, 180, 270] as const) {
  test(`E-123 insertar texto en /Rotate ${rot}: horizontal y derecho en pantalla, en el clic`, async ({ page }) => {
    const d = await PDFDocument.create();
    const p = d.addPage([400, 600]);
    p.setRotation(degrees(rot));
    await abrirBytes(page, await d.save(), `rot${rot}.pdf`);
    await page.locator('#btn-insert').click();
    const pagina = page.locator('.page').first();
    const caja = (await pagina.boundingBox())!;
    const fx = 0.3, fy = 0.4;
    await pagina.click({ position: { x: caja.width * fx, y: caja.height * fy } });
    await expect(page.locator('#status')).toContainText('insertado');

    const bytes = await guardar(page);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(bytes);
    try {
      const vis = eng.pageSize(doc, 0);
      const geo = PageGeometry.desdePagina(
        { sizePt: vis, rotation: eng.pageRotation(doc, 0), origenPt: eng.pageBox(doc, 0).origenPt }, 1
      ); // 1 px CSS = 1 pt visual
      const hit = eng.findText(doc, 0, 'Texto nuevo');
      expect(hit).toHaveLength(1);
      const r = geo.rectPtToCss(hit[0]!);
      expect(r.width, 'más ancho que alto en pantalla').toBeGreaterThan(r.height * 2);
      // Caracteres de izquierda a derecha en pantalla (no boca abajo ni de abajo arriba).
      const cs = eng.getCharBoxes(doc, 0).filter((c) => c.ch.trim() !== '' && c.boxPt.wPt > 0);
      const xs = cs.map((c) => geo.rectPtToCss(c.boxPt).left);
      expect(xs.length).toBeGreaterThanOrEqual(9);
      for (let i = 1; i < xs.length; i++) expect(xs[i]!, `carácter ${i}`).toBeGreaterThan(xs[i - 1]!);
      // Posición: el origen está en el clic (px CSS de la página = pt visuales a escala 1).
      expect(Math.abs(r.left - fx * vis.widthPt)).toBeLessThan(6);
      expect(Math.abs(r.top + r.height - fy * vis.heightPt)).toBeLessThan(20);
    } finally {
      eng.close(doc);
    }
  });
}

/** PDF de 400x600 con «DENTRO» visible y «FUERA»/«IZQUIERDA» fuera de la CropBox (300x300 en `origen`). */
async function pdfConRecorte(origen: { x: number; y: number }, rot: 0 | 90): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([400, 600]);
  p.setRotation(degrees(rot));
  p.setCropBox(origen.x, origen.y, 300, 300);
  p.drawText('DENTRO', { x: origen.x + 40, y: origen.y + 200, size: 18, font: f });
  p.drawText('FUERA', { x: origen.x + 40, y: origen.y + 400, size: 18, font: f });
  p.drawText('IZQUIERDA', { x: origen.x - 120, y: origen.y + 100, size: 18, font: f });
  return d.save();
}

for (const c of [{ x: 0, y: 0, rot: 0 }, { x: 50, y: 80, rot: 0 }, { x: 50, y: 80, rot: 90 }] as const) {
  test(`E-123 CropBox (${c.x},${c.y}) /Rotate ${c.rot}: el texto recortado no se ofrece pero sigue en el PDF`, async ({ page }) => {
    await abrirBytes(page, await pdfConRecorte({ x: c.x, y: c.y }, c.rot), 'crop.pdf');
    await expect(page.locator('.run', { hasText: 'DENTRO' })).toBeVisible();
    const wrap = page.locator('.page').first();
    const runs = await wrap.evaluate((w) => {
      const wr = w.getBoundingClientRect();
      return Array.from(w.querySelectorAll('.run')).map((e) => {
        const b = e.getBoundingClientRect();
        return { t: e.textContent ?? '', l: b.left - wr.left, t0: b.top - wr.top, r: b.right - wr.left, b: b.bottom - wr.top, W: wr.width, H: wr.height };
      });
    });
    expect(runs.length).toBeGreaterThan(0);
    for (const e of runs) {
      expect(e.t, 'no debe ofrecerse texto recortado').not.toMatch(/FUERA|IZQUIERDA/);
      expect(e.l).toBeGreaterThanOrEqual(-1);
      expect(e.t0).toBeGreaterThanOrEqual(-1);
      expect(e.r).toBeLessThanOrEqual(e.W + 1);
      expect(e.b).toBeLessThanOrEqual(e.H + 1);
    }
    // El PDF guardado conserva el texto que el usuario no tocó (§2.3).
    await page.locator('#btn-insert').click();
    const box = (await wrap.boundingBox())!;
    await wrap.click({ position: { x: box.width * 0.5, y: box.height * 0.9 } });
    await expect(page.locator('#status')).toContainText('insertado');
    const bytes = await guardar(page);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(bytes);
    try {
      const textos = eng.getPageText(doc, 0).map((r) => r.text).join('|');
      expect(textos).toContain('DENTRO');
      expect(textos).toContain('FUERA');
      expect(textos).toContain('IZQUIERDA');
    } finally {
      eng.close(doc);
    }
  });
}
