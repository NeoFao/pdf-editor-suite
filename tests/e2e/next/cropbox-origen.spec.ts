import { test, expect, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana, escribirNota } from './_ayudas';

/**
 * E-084: con una caja visible (CropBox, o MediaBox sin CropBox) cuyo origen NO es (0,0), como las plantillas de Acrobat
 * Distiller, las coordenadas del motor (espacio de usuario) y el render/tamaño de página (caja visible) no coinciden
 * salvo restando el origen de la caja. `cropbox-desplazado.pdf` (ver `generar-fixtures.mjs`) tiene tres páginas:
 *   0: CropBox [36 36 436 336], 1: MediaBox [-50 -80 350 220], 2: CropBox [36 36 336 436] con /Rotate 90.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.resolve(AQUI, '../../fixtures/generados');
const FIXTURE = path.join(GEN, 'cropbox-desplazado.pdf');
const ROJO = path.join(GEN, 'rojo.png');

/** Caja visible de cada página (pt de usuario, sin girar: origen abajo-izq) y su /Rotate. `visW`/`visH`: tamaño visual (pt). */
const CASOS = [
  { pagina: 0, ox: 36, oy: 36, cw: 400, ch: 300, rot: 0, visW: 400, visH: 300 },
  { pagina: 1, ox: -50, oy: -80, cw: 400, ch: 300, rot: 0, visW: 400, visH: 300 },
  { pagina: 2, ox: 36, oy: 36, cw: 300, ch: 400, rot: 90, visW: 400, visH: 300 }
] as const;
type Caso = (typeof CASOS)[number];

/** Punto visual en fracciones (fx a la derecha, fy hacia abajo) a punto de usuario esperado (pt de usuario), derivado a mano. */
function esperadoUsuario(c: Caso, fx: number, fy: number): { x: number; y: number } {
  if (c.rot === 90) return { x: c.ox + fy * c.visH, y: c.oy + fx * c.visW }; // 90: visual x = yu-oy, visual y = xu-ox
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
  await page.waitForTimeout(300); // render asentado
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

/** Caja de píxeles de un color (predicado) en el render del motor a escala 1 (1 px = 1 pt visual). */
function cajaDeColor(
  r: { data: Uint8Array | Uint8ClampedArray; width: number; height: number },
  es: (r: number, g: number, b: number) => boolean
): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
    const i = (y * r.width + x) * 4;
    if (es(r.data[i]!, r.data[i + 1]!, r.data[i + 2]!)) {
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

for (const c of CASOS) {
  const eje = c.rot === 90 ? 'x' : 'y';

  test(`E-084 página ${c.pagina}: las cajas .run caen sobre los píxeles de su texto`, async ({ page }) => {
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
    const tol = 8; // px CSS
    expect(Math.abs(r.left - m.total.left), msg).toBeLessThan(tol * 2);
    expect(Math.abs(r.top - m.total.top), msg).toBeLessThan(tol * 2);
    expect(Math.abs(r.right - m.total.right), msg).toBeLessThan(tol * 2);
    expect(Math.abs(r.bottom - m.total.bottom), msg).toBeLessThan(tol * 2);
  });

  test(`E-084 página ${c.pagina}: un clic sobre el texto visible edita ESA línea y al guardar queda en su sitio`, async ({ page }) => {
    await abrir(page);
    const w = await envolver(page, c.pagina);
    const m = await medirPixeles(w, eje);
    const p = centro(lineaA(c, m));
    await w.click({ position: p });
    const editando = w.locator('.run.editing');
    await expect(editando, `clic en (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) px CSS sobre «CROPBOX-${c.pagina + 1}-A»: no entró en edición`).toHaveCount(1);
    await expect(editando).toContainText(`CROPBOX-${c.pagina + 1}-A`);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(`CAMBIADA-${c.pagina + 1}-A`);
    await page.keyboard.press('Enter');
    await expect(page.locator('#status')).toHaveText('Editado.');

    const bytes = await descargar(page, `editada${c.pagina}.pdf`);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(bytes);
    const textos = eng.getPageText(doc, c.pagina);
    const nueva = textos.find((t) => t.text.includes(`CAMBIADA-${c.pagina + 1}-A`));
    const b = textos.find((t) => t.text.includes(`CROPBOX-${c.pagina + 1}-B`));
    eng.close(doc);
    expect(nueva, 'la línea editada no está en el PDF guardado').toBeDefined();
    expect(b, 'la otra línea se perdió').toBeDefined();
    // La línea A original estaba en (60, 290 | -20, 170 | 60, 400) pt de usuario según la página (ver el fixture).
    const orig = c.pagina === 0 ? { x: 60, y: 290 } : c.pagina === 1 ? { x: -20, y: 170 } : { x: 60, y: 400 };
    const msg = `origen tras guardar=${JSON.stringify(nueva!.originPt)} original=${JSON.stringify(orig)}`;
    expect(Math.abs(nueva!.originPt.xPt - orig.x), msg).toBeLessThan(1.5); // pt de usuario
    expect(Math.abs(nueva!.originPt.yPt - orig.y), msg).toBeLessThan(1.5);
  });

  test(`E-084 página ${c.pagina}: insertar texto cae donde se hace clic`, async ({ page }) => {
    await abrir(page);
    const w = await envolver(page, c.pagina);
    await page.locator('#btn-insert').click();
    const caja = (await w.boundingBox())!;
    const fx = 0.3, fy = 0.8;
    await w.click({ position: { x: caja.width * fx, y: caja.height * fy } });
    await expect(page.locator('#status')).toContainText('insertado');
    const bytes = await descargar(page, `insertado${c.pagina}.pdf`);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(bytes);
    const nuevo = eng.getPageText(doc, c.pagina).find((t) => t.text.includes('Texto nuevo'));
    eng.close(doc);
    expect(nuevo, 'el texto insertado no está en el PDF').toBeDefined();
    const e = esperadoUsuario(c, fx, fy);
    const msg = `origen=${JSON.stringify(nuevo!.originPt)} esperado≈${JSON.stringify(e)}`;
    expect(Math.abs(nuevo!.originPt.xPt - e.x), msg).toBeLessThan(25); // pt de usuario
    expect(Math.abs(nuevo!.originPt.yPt - e.y), msg).toBeLessThan(25);
  });

  test(`E-084 página ${c.pagina}: la nota cae donde se hace clic`, async ({ page }) => {
    await abrir(page);
    const w = await envolver(page, c.pagina);
    await abrirPestana(page, 'comentar');
    await page.locator('#btn-note').click();
    const caja = (await w.boundingBox())!;
    const fx = 0.3, fy = 0.8;
    await w.click({ position: { x: caja.width * fx, y: caja.height * fy } });
    await escribirNota(page, 'Nota cropbox');
    await expect(page.locator('#status')).toHaveText('Nota añadida.');
    const bytes = await descargar(page, `nota${c.pagina}.pdf`);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(bytes);
    const notas = eng.getNotes(doc, c.pagina);
    eng.close(doc);
    expect(notas).toHaveLength(1);
    const e = esperadoUsuario(c, fx, fy);
    const n = notas[0]!.rectPt;
    const msg = `nota=${JSON.stringify(n)} esperado≈${JSON.stringify(e)}`;
    expect(Math.abs(n.xPt + n.wPt / 2 - e.x), msg).toBeLessThan(30); // pt de usuario
    expect(Math.abs(n.yPt + n.hPt / 2 - e.y), msg).toBeLessThan(30);
  });

  test(`E-084 página ${c.pagina}: el resaltado cubre la línea elegida`, async ({ page }) => {
    await abrir(page);
    const w = await envolver(page, c.pagina);
    const m = await medirPixeles(w, eje);
    const p = centro(lineaA(c, m));
    await w.click({ position: p });
    await expect(w.locator('.run.editing'), `el clic en (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) no seleccionó la línea`).toHaveCount(1);
    await abrirPestana(page, 'comentar');
    await page.locator('#btn-highlight').click();
    await expect(page.locator('#status')).toHaveText('Resaltado.');
    const bytes = await descargar(page, `resaltado${c.pagina}.pdf`);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(bytes);
    const r = eng.renderPage(doc, c.pagina, 1); // bitmap de la caja visible: 1 px = 1 pt visual
    eng.close(doc);
    const a = cajaDeColor(r, (rr, g, bb) => rr > 200 && g > 180 && bb < 120);
    expect(a.x1, 'no hay resaltado amarillo en la página').toBeGreaterThanOrEqual(0);
    const k = (await w.boundingBox())!.width / r.width; // px CSS por pt visual
    const cx = p.x / k, cy = p.y / k; // clic en pt visuales
    const msg = `amarillo=[${a.x0},${a.y0}]-[${a.x1},${a.y1}] clic(pt visuales)=(${cx.toFixed(1)},${cy.toFixed(1)})`;
    expect(cx, msg).toBeGreaterThanOrEqual(a.x0 - 3);
    expect(cx, msg).toBeLessThanOrEqual(a.x1 + 3);
    expect(cy, msg).toBeGreaterThanOrEqual(a.y0 - 3);
    expect(cy, msg).toBeLessThanOrEqual(a.y1 + 3);
  });

  test(`E-084 página ${c.pagina}: insertar imagen queda centrada en la página visible`, async ({ page }) => {
    await abrir(page);
    await envolver(page, c.pagina);
    await page.locator('#btn-insert-image').setInputFiles(ROJO);
    await expect(page.locator('#status')).toHaveText('Imagen insertada.');
    const bytes = await descargar(page, `imagen${c.pagina}.pdf`);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(bytes);
    const r = eng.renderPage(doc, c.pagina, 1);
    eng.close(doc);
    const a = cajaDeColor(r, (rr, g, bb) => rr > 180 && g < 90 && bb < 90);
    expect(a.x1, 'la imagen no cae dentro de la caja visible').toBeGreaterThanOrEqual(0);
    const cxPt = (a.x0 + a.x1) / 2, cyPt = (a.y0 + a.y1) / 2; // pt visuales
    const msg = `centro imagen=(${cxPt.toFixed(1)},${cyPt.toFixed(1)}) página=${r.width}x${r.height}`;
    expect(Math.abs(cxPt - r.width / 2), msg).toBeLessThan(8);
    expect(Math.abs(cyPt - r.height / 2), msg).toBeLessThan(8);
    expect(a.x0, msg).toBeGreaterThan(0); expect(a.y0, msg).toBeGreaterThan(0);
    expect(a.x1, msg).toBeLessThan(r.width - 1); expect(a.y1, msg).toBeLessThan(r.height - 1);
  });
}
