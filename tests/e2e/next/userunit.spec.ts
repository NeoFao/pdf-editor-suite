import { test, expect, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana, escribirNota } from './_ayudas';

/**
 * E-098: `/UserUnit` (PDF 1.6+) en la página. PDFium NO lo aplica: tamaño de página, render y coordenadas del texto van
 * todos en unidades de usuario sin escalar, así que son coherentes entre sí (la página sale a 1/UserUnit de su tamaño
 * físico, no hay desfase de coordenadas). Este test fija esa coherencia: capa de texto, clic, inserción y notas caen
 * donde se ve el texto. Fixture `userunit.pdf` (UserUnit 2): 0 = MediaBox 300x200, 1 = igual con /Rotate 90,
 * 2 = CropBox [20 20 280 180]. Texto "USERUNIT-<p>-A" en (40,150) y "-B" en (40,60), pt de usuario.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/userunit.pdf');

const CASOS = [
  { pagina: 0, ox: 0, oy: 0, cw: 300, ch: 200, rot: 0 },
  { pagina: 1, ox: 0, oy: 0, cw: 300, ch: 200, rot: 90 },
  { pagina: 2, ox: 20, oy: 20, cw: 260, ch: 160, rot: 0 }
] as const;
type Caso = (typeof CASOS)[number];

/** Punto visual en fracciones (fx a la derecha, fy hacia abajo) a punto de usuario esperado (pt de usuario). */
function esperadoUsuario(c: Caso, fx: number, fy: number): { x: number; y: number } {
  if (c.rot === 90) return { x: c.ox + fy * c.cw, y: c.oy + fx * c.ch }; // visual: ancho = ch, alto = cw
  return { x: c.ox + fx * c.cw, y: c.oy + (1 - fy) * c.ch };
}

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();
}

async function envolver(page: Page, pagina: number): Promise<Locator> {
  const w = page.locator('.page').nth(pagina);
  await w.scrollIntoViewIfNeeded();
  await expect(w.locator('.run').first()).toBeVisible();
  await page.waitForTimeout(300);
  return w;
}

interface Caja { left: number; top: number; right: number; bottom: number }

/**
 * Píxeles oscuros del canvas de la página, en px CSS de la página: caja total y las dos cajas de línea (el texto son dos
 * líneas; se separan por el mayor hueco a lo largo del eje de apilado: Y en 0/180, X en 90/270).
 */
async function medirPixeles(w: Locator, eje: 'x' | 'y'): Promise<{ total: Caja; a: Caja; b: Caja }> {
  return w.evaluate((wrap, ejeApilado) => {
    const canvas = wrap.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const k = canvas.width / canvas.getBoundingClientRect().width; // px de canvas por px CSS
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const oscuro = (x: number, y: number): boolean => {
      const i = (y * d.width + x) * 4;
      return d.data[i]! + d.data[i + 1]! + d.data[i + 2]! < 384 && d.data[i + 3]! > 0;
    };
    const marca: boolean[] = new Array(ejeApilado === 'y' ? d.height : d.width).fill(false);
    for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) if (oscuro(x, y)) marca[ejeApilado === 'y' ? y : x] = true;
    // Mayor hueco entre marcas consecutivas.
    let ultimo = -1, mejor = 0, corte = -1;
    marca.forEach((m, idx) => { if (!m) return; if (ultimo >= 0 && idx - ultimo > mejor) { mejor = idx - ultimo; corte = idx; } ultimo = idx; });
    const sub = (desde: number, hasta: number): { left: number; top: number; right: number; bottom: number } => {
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
        const p = ejeApilado === 'y' ? y : x;
        if (p < desde || p >= hasta || !oscuro(x, y)) continue;
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
      return { left: x0 / k, top: y0 / k, right: (x1 + 1) / k, bottom: (y1 + 1) / k };
    };
    return { total: sub(0, 1e9), a: sub(0, corte), b: sub(corte, 1e9) };
  }, eje);
}

const centro = (c: Caja): { x: number; y: number } => ({ x: (c.left + c.right) / 2, y: (c.top + c.bottom) / 2 });

/** Línea de arriba en 0 (menor Y); en /Rotate 90 la línea "A" (mayor y de usuario) queda a la DERECHA (mayor X visual). */
function lineaA(c: Caso, m: { a: Caja; b: Caja }): Caja { return c.rot === 90 ? m.b : m.a; }

async function descargar(page: Page, nombre: string): Promise<Uint8Array> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await dl.saveAs(destino);
  return new Uint8Array(fs.readFileSync(destino));
}


for (const c of CASOS) {
  const eje = c.rot === 90 ? 'x' : 'y';

  test(`E-098 página ${c.pagina}: con UserUnit 2 las cajas .run caen sobre los píxeles de su texto`, async ({ page }) => {
    await abrir(page);
    const w = await envolver(page, c.pagina);
    const m = await medirPixeles(w, eje);
    const r = await w.evaluate((wrap) => {
      const wr = wrap.getBoundingClientRect();
      const cajas = Array.from(wrap.querySelectorAll('.run')).map((e) => e.getBoundingClientRect());
      return {
        left: Math.min(...cajas.map((b) => b.left)) - wr.left, top: Math.min(...cajas.map((b) => b.top)) - wr.top,
        right: Math.max(...cajas.map((b) => b.right)) - wr.left, bottom: Math.max(...cajas.map((b) => b.bottom)) - wr.top
      };
    });
    const msg = `unión de .run=${JSON.stringify(r)} píxeles=${JSON.stringify(m.total)}`;
    const tol = 16; // px CSS
    expect(Math.abs(r.left - m.total.left), msg).toBeLessThan(tol);
    expect(Math.abs(r.top - m.total.top), msg).toBeLessThan(tol);
    expect(Math.abs(r.right - m.total.right), msg).toBeLessThan(tol);
    expect(Math.abs(r.bottom - m.total.bottom), msg).toBeLessThan(tol);
  });

  test(`E-098 página ${c.pagina}: un clic sobre el texto visible edita ESA línea`, async ({ page }) => {
    await abrir(page);
    const w = await envolver(page, c.pagina);
    const m = await medirPixeles(w, eje);
    const p = centro(lineaA(c, m));
    await w.click({ position: p });
    const editando = w.locator('.run.editing');
    await expect(editando, `clic en (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) px CSS sobre «USERUNIT-${c.pagina + 1}-A»: no entró en edición`).toHaveCount(1);
    await expect(editando).toContainText(`USERUNIT-${c.pagina + 1}-A`);
  });

  test(`E-098 página ${c.pagina}: insertar texto y nota caen donde se hace clic`, async ({ page }) => {
    await abrir(page);
    const w = await envolver(page, c.pagina);
    const caja = (await w.boundingBox())!;
    const fx = 0.3, fy = 0.8;
    const e = esperadoUsuario(c, fx, fy);
    await page.locator('#btn-insert').click();
    await w.click({ position: { x: caja.width * fx, y: caja.height * fy } });
    await expect(page.locator('#status')).toContainText('insertado');
    await abrirPestana(page, 'comentar');
    await page.locator('#btn-note').click();
    await w.click({ position: { x: caja.width * fx, y: caja.height * fy } });
    await escribirNota(page, 'Nota userunit');
    await expect(page.locator('#status')).toHaveText('Nota añadida.');
    const bytes = await descargar(page, `userunit${c.pagina}.pdf`);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(bytes);
    const nuevo = eng.getPageText(doc, c.pagina).find((t) => t.text.includes('Texto nuevo'));
    const notas = eng.getNotes(doc, c.pagina);
    eng.close(doc);
    expect(nuevo, 'el texto insertado no está en el PDF').toBeDefined();
    const msg = `origen=${JSON.stringify(nuevo!.originPt)} esperado≈${JSON.stringify(e)}`;
    expect(Math.abs(nuevo!.originPt.xPt - e.x), msg).toBeLessThan(25); // pt de usuario
    expect(Math.abs(nuevo!.originPt.yPt - e.y), msg).toBeLessThan(25);
    expect(notas).toHaveLength(1);
    const n = notas[0]!.rectPt;
    const msgN = `nota=${JSON.stringify(n)} esperado≈${JSON.stringify(e)}`;
    expect(Math.abs(n.xPt + n.wPt / 2 - e.x), msgN).toBeLessThan(30);
    expect(Math.abs(n.yPt + n.hPt / 2 - e.y), msgN).toBeLessThan(30);
  });

  test(`E-098 página ${c.pagina}: el tamaño visible en pantalla es el de la caja sin escalar (1 pt = 1 px a zoom 1)`, async ({ page }) => {
    await abrir(page);
    const w = await envolver(page, c.pagina);
    const caja = (await w.boundingBox())!;
    const visW = c.rot === 90 ? c.ch : c.cw, visH = c.rot === 90 ? c.cw : c.ch;
    expect(caja.width / caja.height, `página ${caja.width}x${caja.height}`).toBeCloseTo(visW / visH, 1);
  });
}
