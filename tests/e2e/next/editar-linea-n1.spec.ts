import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { agruparLineasEditables, type LineaEditable } from '../../../src/texto/lineasEditables';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.resolve(AQUI, '../../fixtures/generados');
const POR_GLIFO = path.join(GEN, 'por-glifo.pdf');

/**
 * N1 F2 + F3: la capa de texto pinta UNA `.run` por línea editable (no por objeto) y editarla usa el diff mínimo del motor.
 * `por-glifo.pdf` imita a Chrome: un `Tj` por glifo (335 objetos en la página 1 → 20 líneas). Chromium real, píxeles reales.
 */

async function abrir(page: Page, fichero = POR_GLIFO): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(fichero);
  await expect(page.locator('.run').first()).toBeVisible();
}

/** Mide en Node, con el motor, la línea `texto` de la página 1 de por-glifo.pdf (pt) y el alto de la página. */
async function medir(texto: string, fichero = POR_GLIFO): Promise<{ linea: LineaEditable; anchoPt: number; altoPt: number; lineas: LineaEditable[] }> {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(fichero)));
  const lineas = agruparLineasEditables(eng.getPageText(doc, 0), 0);
  const { widthPt, heightPt } = eng.pageSize(doc, 0);
  eng.close(doc);
  const linea = lineas.find((l) => l.text === texto);
  if (!linea) throw new Error(`sin línea «${texto}»`);
  return { linea, anchoPt: widthPt, altoPt: heightPt, lineas };
}

/** Guarda el bitmap del canvas de la primera página en `window.__antes` (RGBA tal cual, px del bitmap). */
async function capturarAntes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.page canvas')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    (window as unknown as { __antes: ImageData }).__antes = d;
  });
}

/** Compara el canvas actual con `__antes`: píxeles distintos FUERA de la franja y, dentro, a la izquierda de `xMaxPt`. */
async function compararConAntes(
  page: Page,
  franja: { y0Pt: number; y1Pt: number },
  xMaxPt: number,
  anchoPt: number
): Promise<{ fuera: number; prefijo: number; total: number }> {
  return page.evaluate(({ f, xMax, ancho }) => {
    const antes = (window as unknown as { __antes: ImageData }).__antes;
    const c = document.querySelector<HTMLCanvasElement>('.page canvas')!;
    const ahora = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    if (ahora.width !== antes.width || ahora.height !== antes.height) return { fuera: -1, prefijo: -1, total: -1 };
    const k = c.width / ancho; // px de bitmap por pt
    const y0 = Math.floor(f.y0Pt * k) - 1, y1 = Math.ceil(f.y1Pt * k) + 1; // 1 px de margen
    const x1 = Math.floor(xMax * k) - 2;
    let fuera = 0, prefijo = 0, total = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const distinto = antes.data[i] !== ahora.data[i] || antes.data[i + 1] !== ahora.data[i + 1] || antes.data[i + 2] !== ahora.data[i + 2];
        if (!distinto) continue;
        total++;
        if (y < y0 || y >= y1) fuera++;
        else if (x < x1) prefijo++;
      }
    }
    return { fuera, prefijo, total };
  }, { f: franja, xMax: xMaxPt, ancho: anchoPt });
}

async function editarLinea(page: Page, textoActual: string, textoNuevo: string): Promise<void> {
  const run = page.locator('.run', { hasText: textoActual }).first();
  await run.click();
  await expect(run).toHaveClass(/editing/);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(textoNuevo);
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Editado.');
}

async function descargar(page: Page, nombre: string): Promise<Uint8Array> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await download.saveAs(destino);
  return new Uint8Array(fs.readFileSync(destino));
}

test('N1: la capa pinta UNA .run por línea editable (20), no una por glifo (335)', async ({ page }) => {
  await abrir(page);
  const { lineas } = await medir('Celda A1');
  expect(lineas.length).toBe(20);
  await expect(page.locator('.page').first().locator('.run')).toHaveCount(20);
  // Cada .run tiene el texto de su línea entera.
  await expect(page.locator('.run', { hasText: 'uno dos tres cuatro cinco seis' })).toHaveText('uno dos tres cuatro cinco seis');
  await expect(page.locator('.run', { hasText: 'Estilo mixto: normal NEGRITA y fin.' })).toHaveText('Estilo mixto: normal NEGRITA y fin.');
});

test('N1 (1)-(3): clic en la línea → edita la LÍNEA ENTERA; solo cambia su franja; guardar y reabrir conserva todo', async ({ page }) => {
  const ORIGINAL = 'uno dos tres cuatro cinco seis';
  const NUEVO = 'uno dos TRES CUATRO cuatro cinco seis';
  const { linea, anchoPt, altoPt, lineas } = await medir(ORIGINAL);
  await abrir(page);
  await page.waitForTimeout(300); // el render de la página ya está pintado; deja asentar el ajuste al ancho
  await capturarAntes(page);

  const run = page.locator('.run', { hasText: ORIGINAL });
  await run.click();
  await expect(run).toHaveClass(/editing/);
  // (1) El editor contiene la línea completa, no un glifo.
  await expect(run).toHaveText(ORIGINAL);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(NUEVO);
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Editado.');
  await expect(page.locator('.run', { hasText: NUEVO })).toBeVisible();

  // (2) Píxeles: nada fuera de la franja vertical de la línea (+1 px); el prefijo «uno dos » intacto dentro de ella.
  const b = linea.boxPt;
  const eng0 = await PdfiumEngine.create();
  const doc0 = await eng0.open(new Uint8Array(fs.readFileSync(POR_GLIFO)));
  const runs0 = eng0.getPageText(doc0, 0);
  const prefijo = linea.tramos.filter((t) => t.fin <= 'uno dos '.length).map((t) => runs0.find((r) => r.runId === t.runId)!);
  const xFinPrefijo = Math.max(...prefijo.map((r) => r.boxPt.xPt + r.boxPt.wPt));
  eng0.close(doc0);
  await expect.poll(async () => (await compararConAntes(page, { y0Pt: altoPt - (b.yPt + b.hPt), y1Pt: altoPt - b.yPt }, xFinPrefijo, anchoPt)).total).toBeGreaterThan(0);
  const px = await compararConAntes(page, { y0Pt: altoPt - (b.yPt + b.hPt), y1Pt: altoPt - b.yPt }, xFinPrefijo, anchoPt);
  expect(px.fuera).toBe(0);
  expect(px.prefijo).toBe(0);

  // (3) Guardar y reabrir: texto nuevo extraíble y buscable; las demás líneas y columnas intactas.
  const bytes = await descargar(page, 'editada.pdf');
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(bytes);
  expect(eng.findText(doc, 0, 'TRES CUATRO').length).toBeGreaterThan(0);
  const despues = agruparLineasEditables(eng.getPageText(doc, 0), 0);
  expect(despues.map((l) => l.text)).toContain(NUEVO);
  for (const v of lineas.filter((l) => l.text !== ORIGINAL)) {
    const d = despues.find((l) => l.text === v.text);
    expect(d, v.text).toBeDefined();
    expect(d!.boxPt.xPt).toBeCloseTo(v.boxPt.xPt, 1);
    expect(d!.boxPt.yPt).toBeCloseTo(v.boxPt.yPt, 1);
  }
  eng.close(doc);
});

test('N1 (4): una línea multiestilo editada FUERA del tramo en negrita conserva la negrita y el color', async ({ page }) => {
  await abrir(page);
  await editarLinea(page, 'Estilo mixto: normal NEGRITA y fin.', 'Estilos mixtos: normal NEGRITA y fin.');
  const bytes = await descargar(page, 'multiestilo.pdf');
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(bytes);
  const l = agruparLineasEditables(eng.getPageText(doc, 0), 0).find((x) => x.text === 'Estilos mixtos: normal NEGRITA y fin.')!;
  expect(l).toBeDefined();
  const neg = l.estilos.find((e) => l.text.slice(e.inicio, e.fin).includes('NEGRITA'))!;
  expect(neg.fontName).toMatch(/Bold/i);
  expect(neg.color[0]).toBeGreaterThan(150);
  expect(neg.color[1]).toBeLessThan(100);
  eng.close(doc);
});

test('N1 (5): deshacer devuelve la página idéntica a la original (bytes renderizados) y anuncia «Deshecho: Editar texto»', async ({ page }) => {
  await abrir(page);
  await page.waitForTimeout(300);
  await capturarAntes(page);
  await editarLinea(page, 'Columna izquierda uno', 'Columna izq. uno');
  await page.locator('#btn-undo').click();
  await expect(page.locator('#status')).toHaveText('Deshecho: Editar texto');
  await expect(page.locator('.run', { hasText: 'Columna izquierda uno' })).toBeVisible();
  const { anchoPt } = await medir('Celda A1');
  // Sin franja: cualquier píxel distinto cuenta como «fuera».
  await expect.poll(async () => (await compararConAntes(page, { y0Pt: 0, y1Pt: 0 }, 0, anchoPt)).total).toBe(0);
});

test('N1: editar la columna izquierda no mueve la derecha (píxeles de su caja idénticos)', async ({ page }) => {
  const { linea: der, anchoPt, altoPt } = await medir('Columna derecha uno');
  await abrir(page);
  await page.waitForTimeout(300);
  await capturarAntes(page);
  await editarLinea(page, 'Columna izquierda uno', 'Columna izq. uno');
  const b = der.boxPt;
  // La franja «permitida» es TODO salvo la caja de la columna derecha: aquí se invierte: se mide solo ella.
  const n = await page.evaluate(({ b, ancho }) => {
    const antes = (window as unknown as { __antes: ImageData }).__antes;
    const c = document.querySelector<HTMLCanvasElement>('.page canvas')!;
    const ahora = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    const k = c.width / ancho;
    let d = 0;
    for (let y = Math.floor(b.y0 * k); y < Math.ceil(b.y1 * k); y++) for (let x = Math.floor(b.x0 * k); x < Math.ceil(b.x1 * k); x++) {
      const i = (y * c.width + x) * 4;
      if (antes.data[i] !== ahora.data[i] || antes.data[i + 1] !== ahora.data[i + 1] || antes.data[i + 2] !== ahora.data[i + 2]) d++;
    }
    return d;
  }, { b: { x0: b.xPt, x1: b.xPt + b.wPt, y0: altoPt - (b.yPt + b.hPt), y1: altoPt - b.yPt }, ancho: anchoPt });
  expect(n).toBe(0);
});

test('N1: en reposo la capa de líneas no altera ni un píxel del render (E-029)', async ({ page }) => {
  await abrir(page);
  const wrapper = page.locator('.page').first();
  const antes = await wrapper.screenshot({ animations: 'disabled' });
  await page.evaluate(() => document.querySelectorAll<HTMLElement>('.run').forEach((el) => { el.style.visibility = 'hidden'; }));
  const despues = await wrapper.screenshot({ animations: 'disabled' });
  expect(Buffer.compare(antes, despues)).toBe(0);
});

test('N1: mover una línea compuesta con el tirador mueve TODOS sus objetos', async ({ page }) => {
  const { linea, anchoPt } = await medir('Celda B1');
  await abrir(page);
  const escala = (await page.locator('.page').first().boundingBox())!.width / anchoPt;
  const run = page.locator('.run', { hasText: 'Celda B1' });
  const h = (await run.locator('.run-drag').boundingBox())!;
  const dx = 30 * escala; // +30 pt en X
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('#status')).toBeVisible();
  const bytes = await descargar(page, 'movida.pdf');
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(bytes);
  const despues = agruparLineasEditables(eng.getPageText(doc, 0), 0);
  const nueva = despues.find((l) => l.text === 'Celda B1')!;
  expect(nueva).toBeDefined(); // sigue siendo UNA línea: no se partió
  expect(nueva.runIds.length).toBe(linea.runIds.length);
  expect(nueva.boxPt.xPt - linea.boxPt.xPt).toBeGreaterThan(25);
  expect(nueva.boxPt.xPt - linea.boxPt.xPt).toBeLessThan(35);
  expect(nueva.boxPt.wPt).toBeCloseTo(linea.boxPt.wPt, 1);
  // Las vecinas (misma fila) no se movieron.
  expect(despues.find((l) => l.text === 'Celda A1')!.boxPt.xPt).toBeCloseTo((await medir('Celda A1')).linea.boxPt.xPt, 1);
  eng.close(doc);
});

test('N1: resaltar una línea compuesta seleccionada cubre la línea entera', async ({ page }) => {
  const { linea } = await medir('uno dos tres cuatro cinco seis');
  await abrir(page);
  await page.locator('.run', { hasText: 'uno dos tres cuatro cinco seis' }).click();
  await page.keyboard.press('Escape');
  await abrirPestana(page, 'comentar');
  await page.locator('#btn-highlight').click();
  await expect(page.locator('#status')).toHaveText('Resaltado.');
  const bytes = await descargar(page, 'resaltada.pdf');
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(bytes);
  const quads = eng.getMarkupQuads(doc, 0, 0);
  const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]]); // QuadPt: x1 y1 x2 y2 x3 y3 x4 y4
  const ancho = Math.max(...xs) - Math.min(...xs);
  expect(ancho).toBeGreaterThan(linea.boxPt.wPt * 0.95); // la línea entera, no un glifo
  eng.close(doc);
});

test('N1: Suprimir con una línea compuesta seleccionada la borra entera y deshacer la restaura', async ({ page }) => {
  await abrir(page);
  await page.locator('.run', { hasText: 'Celda C2' }).click();
  await page.keyboard.press('Escape');
  await page.locator('#btn-delete').click();
  await expect(page.locator('#status')).toHaveText('Línea borrada del documento.');
  await expect(page.locator('.run', { hasText: 'Celda C2' })).toHaveCount(0);
  await expect(page.locator('.run', { hasText: 'Celda B2' })).toBeVisible();
  await page.locator('#btn-undo').click();
  await expect(page.locator('.run', { hasText: 'Celda C2' })).toBeVisible();
});

test('N1: en la página con /Rotate 90 el clic edita la línea entera', async ({ page }) => {
  await abrir(page);
  const p2 = page.locator('.page').nth(1);
  await p2.scrollIntoViewIfNeeded();
  await expect(p2.locator('.run')).toHaveCount(2);
  const run = p2.locator('.run').first();
  const texto = (await run.textContent())!;
  expect(texto.length).toBeGreaterThan(8); // una línea, no un glifo
  await run.click();
  await expect(run).toHaveClass(/editing/);
  await expect(run).toHaveText(texto);
});
