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

type ModoVista = 'ancho' | 'zoom-manual';

/** `ancho`: el visor abre ajustado al ancho. `zoom-manual`: además se aleja una vez (la escala ya no es la del ajuste). */
async function abrir(page: Page, modo: ModoVista = 'ancho', fixture = FIXTURE): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(fixture);
  await expect(page.locator('.run').first()).toBeVisible();
  if (modo === 'zoom-manual') {
    await page.locator('#btn-zoom-out').click();
    await page.waitForTimeout(300);
  }
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


for (const modo of ['ancho', 'zoom-manual'] as const) for (const c of CASOS) {
  const sufijo = modo === 'ancho' ? '' : ' (zoom manual)';
  const eje = c.rot === 90 ? 'x' : 'y';

  test(`E-098 página ${c.pagina}${sufijo}: con UserUnit 2 las cajas .run caen sobre los píxeles de su texto`, async ({ page }) => {
    await abrir(page, modo);
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

  test(`E-098 página ${c.pagina}${sufijo}: un clic sobre el texto visible edita ESA línea`, async ({ page }) => {
    await abrir(page, modo);
    const w = await envolver(page, c.pagina);
    const m = await medirPixeles(w, eje);
    const p = centro(lineaA(c, m));
    await w.click({ position: p });
    const editando = w.locator('.run.editing');
    await expect(editando, `clic en (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) px CSS sobre «USERUNIT-${c.pagina + 1}-A»: no entró en edición`).toHaveCount(1);
    await expect(editando).toContainText(`USERUNIT-${c.pagina + 1}-A`);
  });

  test(`E-098 página ${c.pagina}${sufijo}: insertar texto y nota caen donde se hace clic`, async ({ page }) => {
    await abrir(page, modo);
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

  test(`E-098 página ${c.pagina}${sufijo}: el tamaño visible en pantalla es el de la caja sin escalar (1 pt = 1 px a zoom 1)`, async ({ page }) => {
    await abrir(page, modo);
    const w = await envolver(page, c.pagina);
    const caja = (await w.boundingBox())!;
    const visW = c.rot === 90 ? c.ch : c.cw, visH = c.rot === 90 ? c.cw : c.ch;
    expect(caja.width / caja.height, `página ${caja.width}x${caja.height}`).toBeCloseTo(visW / visH, 1);
  });
}

// ---- E-099: la vista aplica /UserUnit (tamaño físico) sin tocar las coordenadas del motor ----
const FIXTURE_MIXTO = path.resolve(AQUI, '../../fixtures/generados/userunit-mixto.pdf');

async function cajaPagina(page: Page, i: number): Promise<{ width: number; height: number }> {
  const w = page.locator('.page').nth(i);
  const b = await w.evaluate((e) => { const r = e.getBoundingClientRect(); return { width: r.width, height: r.height }; });
  return b;
}

test('E-099 vista: con UserUnit 2 la página mide el doble en CSS que una igual con UserUnit 1; UserUnit inválido cuenta como 1', async ({ page }) => {
  await abrir(page, 'zoom-manual', FIXTURE_MIXTO);
  const [p1, p2, p3, p4] = [await cajaPagina(page, 0), await cajaPagina(page, 1), await cajaPagina(page, 2), await cajaPagina(page, 3)];
  const msg = JSON.stringify({ p1, p2, p3, p4 });
  expect(p2.width / p1.width, msg).toBeCloseTo(2, 2);
  expect(p2.height / p1.height, msg).toBeCloseTo(2, 2);
  expect(p3.width / p1.width, msg).toBeCloseTo(1, 2); // /UserUnit 0: inválido, se ve como 1
  // /UserUnit 2 con /Rotate 90: el ancho visual es el alto sin girar (200 pt) × 2.
  expect(p4.width / p1.height, msg).toBeCloseTo(2, 2);
  expect(p4.height / p1.width, msg).toBeCloseTo(2, 2);
});

test('E-099 vista: el tamaño sigue la escala mostrada (ancho CSS = ancho × UserUnit × zoom %)', async ({ page }) => {
  await abrir(page, 'zoom-manual', FIXTURE_MIXTO);
  const pct = Number((await page.locator('#zoom-pct').textContent())!.replace('%', '')) / 100;
  const uu = [1, 2, 1, 2];
  const ancho = [300, 300, 300, 200];
  for (let i = 0; i < 4; i++) {
    const b = await cajaPagina(page, i);
    expect(Math.abs(b.width - ancho[i]! * uu[i]! * pct), `página ${i + 1}: ${b.width} vs ${ancho[i]! * uu[i]! * pct}`).toBeLessThan(0.01 * b.width + 1);
  }
});

test('E-099 vista: el modo "ancho" ajusta una página UserUnit 2 al ancho del panel (zoom % menor que con UserUnit 1)', async ({ page }) => {
  await abrir(page, 'ancho'); // userunit.pdf: página 1 de 300x200 pt con UserUnit 2 = 600x400 pt físicos
  const disponible = await page.locator('#viewer').evaluate((e) => {
    const cs = getComputedStyle(e);
    return e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  });
  const b = await cajaPagina(page, 0);
  expect(Math.abs(b.width - disponible), `página ${b.width} panel ${disponible}`).toBeLessThanOrEqual(1);
  expect(await page.locator('#zoom-pct').textContent()).toBe(`${Math.round((disponible / 600) * 100)}%`);
});

test('E-099 guardar no muta el documento: los bytes no dependen de la escala de la vista y /UserUnit se conserva', async ({ page }) => {
  await abrir(page, 'ancho');
  const base = await descargar(page, 'uu-base.pdf');
  await abrir(page, 'zoom-manual');
  const conZoom = await descargar(page, 'uu-a.pdf');
  await page.locator('#btn-zoom-in').click();
  const otraVez = await descargar(page, 'uu-b.pdf');
  expect(Buffer.from(conZoom).equals(Buffer.from(base)), 'guardar con otra escala de vista da otros bytes').toBe(true);
  expect(Buffer.from(otraVez).equals(Buffer.from(base)), 'guardar dos veces da bytes distintos').toBe(true);
  const eng = await PdfiumEngine.create();
  const re = await eng.open(base);
  expect([0, 1, 2].map((i) => eng.userUnit(re, i))).toEqual([2, 2, 2]);
  eng.close(re);
});

test('E-099 pdf-lib solo se descarga si el PDF declara /UserUnit (también dentro de un /ObjStm)', async ({ page }) => {
  const pedidos: string[] = [];
  page.on('request', (r) => { if (/\/assets\/index-[\w-]+\.js$/.test(new URL(r.url()).pathname)) pedidos.push(r.url()); });
  await abrir(page, 'ancho', path.resolve(AQUI, '../../fixtures/generados/nativo.pdf'));
  await page.waitForTimeout(500);
  expect(pedidos, 'un PDF con /ObjStm pero sin /UserUnit no debe cargar el chunk de pdf-lib').toEqual([]);
  await abrir(page, 'ancho'); // userunit.pdf: /UserUnit solo dentro de un /ObjStm comprimido
  await expect.poll(() => pedidos.length, 'un PDF con /UserUnit en un /ObjStm debe cargar pdf-lib').toBeGreaterThan(0);
});
