import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

// E-053: en páginas con /Rotate 90/270 las capas (texto, inserción, notas...) se
// descolocaban porque `PageGeometry` recibía el tamaño VISUAL del motor y no el
// de usuario (sin girar). `rotada.pdf` tiene 3 páginas A4 con /Rotate 90, 270 y
// 180 y el texto "ESQUINA-SUP-IZQ" en la esquina superior-izquierda visual.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/rotada.pdf');
const W_USUARIO_PT = 595.28; // ancho SIN girar (MediaBox), pt PDF
const H_USUARIO_PT = 841.89; // alto SIN girar (MediaBox), pt PDF

const CASOS = [
  { pagina: 0, rot: 90 },
  { pagina: 1, rot: 270 },
  { pagina: 2, rot: 180 }
] as const;

/** Punto visual (pt, origen arriba-izq, Y abajo) -> punto de usuario (pt PDF), derivado a mano por rotación. */
function visualAUsuarioPt(rot: number, vx: number, vy: number): { x: number; y: number } {
  if (rot === 90) return { x: vy, y: vx };
  if (rot === 270) return { x: W_USUARIO_PT - vy, y: H_USUARIO_PT - vx };
  return { x: W_USUARIO_PT - vx, y: vy }; // 180
}

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();
}

for (const { pagina, rot } of CASOS) {
  test(`rotación ${rot}: el .run de ESQUINA-SUP-IZQ queda sobre los píxeles del texto`, async ({ page }) => {
    await abrir(page);
    const wrapper = page.locator('.page').nth(pagina);
    await wrapper.scrollIntoViewIfNeeded();
    const run = wrapper.locator('.run', { hasText: 'ESQUINA-SUP-IZQ' });
    await expect(run).toBeVisible();
    // Esperar a que el canvas esté pintado (algún píxel oscuro).
    const r = await wrapper.evaluate(async (w) => {
      const canvas = w.querySelector('canvas') as HTMLCanvasElement;
      const run = Array.from(w.querySelectorAll('.run')).find((e) => e.textContent?.includes('ESQUINA-SUP-IZQ')) as HTMLElement;
      const ctx = canvas.getContext('2d')!;
      const cw = canvas.getBoundingClientRect(), wr = w.getBoundingClientRect(), rr = run.getBoundingClientRect();
      const k = canvas.width / cw.width; // px de canvas por px CSS
      // Esquina superior-izq visual: región de 400x400 px CSS del origen de la página.
      const lim = Math.min(400, cw.width, cw.height);
      const data = ctx.getImageData(0, 0, Math.round(lim * k), Math.round(lim * k));
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < data.height; y++) for (let x = 0; x < data.width; x++) {
        const i = (y * data.width + x) * 4;
        if (data.data[i]! + data.data[i + 1]! + data.data[i + 2]! < 384 && data.data[i + 3]! > 0) {
          if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
        }
      }
      return {
        pixeles: x1 < 0 ? null : { left: x0 / k, top: y0 / k, right: (x1 + 1) / k, bottom: (y1 + 1) / k },
        run: { left: rr.left - wr.left, top: rr.top - wr.top, right: rr.right - wr.left, bottom: rr.bottom - wr.top }
      };
    });
    expect(r.pixeles, 'no hay píxeles oscuros del texto en la esquina visual').not.toBeNull();
    const p = r.pixeles!, b = r.run;
    const tol = 8; // px CSS
    const msg = `run=${JSON.stringify(b)} pixeles=${JSON.stringify(p)}`;
    // El centro del run debe caer dentro de la caja de píxeles y los bordes coincidir con tolerancia.
    expect(Math.abs(b.left - p.left), msg).toBeLessThan(tol);
    expect(Math.abs(b.top - p.top), msg).toBeLessThan(tol * 2);
    expect(Math.abs(b.right - p.right), msg).toBeLessThan(tol * 2);
    expect(Math.abs(b.bottom - p.bottom), msg).toBeLessThan(tol * 2);
  });

  test(`rotación ${rot}: insertar texto con un clic lo coloca en el punto visual del clic`, async ({ page }) => {
    await abrir(page);
    const wrapper = page.locator('.page').nth(pagina);
    await wrapper.scrollIntoViewIfNeeded();
    await page.locator('#btn-insert').click();
    const caja = (await wrapper.boundingBox())!;
    const vx = 300 / 595.28, vy = 500 / 841.89; // fracciones visuales (zona sin texto)
    await wrapper.click({ position: { x: caja.width * vx, y: caja.height * vy } });
    await expect(page.locator('#status')).toContainText('insertado');

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
    const destino = path.join(test.info().outputDir, `rot${rot}.pdf`);
    await download.saveAs(destino);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
    const nuevo = eng.getPageText(doc, pagina).find((t) => t.text.includes('Texto nuevo'));
    eng.close(doc);
    expect(nuevo, 'el texto insertado no está en el PDF').toBeDefined();
    // Dimensiones visuales de la página (pt): intercambiadas en 90/270.
    const visW = rot === 180 ? W_USUARIO_PT : H_USUARIO_PT;
    const visH = rot === 180 ? H_USUARIO_PT : W_USUARIO_PT;
    const esperado = visualAUsuarioPt(rot, visW * (caja.width ? vx : 0), visH * vy);
    const o = nuevo!.originPt;
    const msg = `origen=${JSON.stringify(o)} esperado=${JSON.stringify(esperado)}`;
    expect(Math.abs(o.xPt - esperado.x), msg).toBeLessThan(30); // pt PDF
    expect(Math.abs(o.yPt - esperado.y), msg).toBeLessThan(30);
  });

  test(`rotación ${rot}: la nota cae en el punto visual del clic`, async ({ page }) => {
    await abrir(page);
    const wrapper = page.locator('.page').nth(pagina);
    await wrapper.scrollIntoViewIfNeeded();
    await abrirPestana(page, 'comentar');
    page.once('dialog', (d) => d.accept('Nota rotada'));
    await page.locator('#btn-note').click();
    const caja = (await wrapper.boundingBox())!;
    const cx = caja.width * 0.5, cy = caja.height * 0.6; // px CSS de página
    await wrapper.click({ position: { x: cx, y: cy } });
    await expect(page.locator('#status')).toHaveText('Nota añadida.');
    const marcador = wrapper.locator('.note-marker');
    await expect(marcador).toHaveCount(1);
    const m = (await marcador.boundingBox())!;
    const mx = m.x + m.width / 2 - caja.x, my = m.y + m.height / 2 - caja.y;
    const msg = `marcador=(${mx.toFixed(1)},${my.toFixed(1)}) clic=(${cx.toFixed(1)},${cy.toFixed(1)})`;
    const tol = 40; // px CSS: el icono de nota no está centrado exactamente en el clic
    expect(Math.abs(mx - cx), msg).toBeLessThan(tol);
    expect(Math.abs(my - cy), msg).toBeLessThan(tol);

    // Lo que se guarda en el PDF (pt de usuario, sin girar) debe corresponder al punto visual del clic.
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
    const destino = path.join(test.info().outputDir, `nota${rot}.pdf`);
    await download.saveAs(destino);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
    const notas = eng.getNotes(doc, pagina);
    eng.close(doc);
    expect(notas).toHaveLength(1);
    const visW = rot === 180 ? W_USUARIO_PT : H_USUARIO_PT; // ancho visual, pt
    const visH = rot === 180 ? H_USUARIO_PT : W_USUARIO_PT; // alto visual, pt
    const esperado = visualAUsuarioPt(rot, visW * 0.5, visH * 0.6);
    const n = notas[0]!.rectPt;
    const msg2 = `nota=${JSON.stringify(n)} esperado=${JSON.stringify(esperado)}`;
    expect(Math.abs(n.xPt + n.wPt / 2 - esperado.x), msg2).toBeLessThan(40); // pt PDF
    expect(Math.abs(n.yPt + n.hPt / 2 - esperado.y), msg2).toBeLessThan(40);
  });
}
