import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

/** Descarga el PDF actual (#btn-save) y devuelve sus bytes. */
async function descargar(page: import('@playwright/test').Page, nombre: string): Promise<Uint8Array> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await download.saveAs(destino);
  return new Uint8Array(fs.readFileSync(destino));
}

// (a) #18: muestras de color — elegir una muestra fija el color de herramienta
// y lo usa la pluma (verificado en el motor, no solo en pantalla).
test('muestras de color: clic en la azul la marca aria-pressed y el trazo de la pluma sale azul en el motor', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  const azul = page.locator('.swatch[data-color="#2563eb"]');
  await azul.click();
  await expect(azul).toHaveAttribute('aria-pressed', 'true');
  // La roja (por defecto) deja de estar marcada.
  await expect(page.locator('.swatch[data-color="#dc1414"]')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#btn-pen').click();
  await expect(page.locator('#btn-pen')).toHaveAttribute('aria-pressed', 'true');
  const pagina = page.locator('.page').first();
  const b = (await pagina.boundingBox())!;
  await page.mouse.move(b.x + 60, b.y + 120);
  await page.mouse.down();
  await page.mouse.move(b.x + 180, b.y + 160, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#status')).toHaveText('Trazo dibujado.');

  const bytes = await descargar(page, 'pluma-azul.pdf');
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(bytes);
  const paths = eng.listPathObjects(doc, 0);
  expect(paths).toHaveLength(1);
  expect(paths[0]!.hasStroke).toBe(true);
  const { data } = eng.renderPage(doc, 0, 1);
  let azulEncontrado = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! < 90 && data[i + 1]! < 150 && data[i + 2]! > 150) { azulEncontrado = true; break; }
  }
  expect(azulEncontrado).toBe(true);
  eng.close(doc);
});

// (b) #16: rectángulo — arrastrar dibuja uno, verificado en el motor
// (listPathObjects + color), y Deshacer lo quita.
test('rectángulo: arrastrar dibuja uno con el color de herramienta; Deshacer lo quita', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-rect').click();
  await expect(page.locator('#btn-rect')).toHaveAttribute('aria-pressed', 'true');

  const pagina = page.locator('.page').first();
  const b = (await pagina.boundingBox())!;
  await page.mouse.move(b.x + 60, b.y + 80);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y + 180, { steps: 10 });
  // Vista previa discontinua visible mientras se arrastra.
  await expect(page.locator('.rect-preview')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('#status')).toHaveText('Rectángulo dibujado.');
  await expect(page.locator('.rect-preview')).toHaveCount(0);

  const bytes = await descargar(page, 'rect.pdf');
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(bytes);
  const paths = eng.listPathObjects(doc, 0);
  expect(paths).toHaveLength(1);
  expect(paths[0]!.hasStroke).toBe(true);
  // Rojo por defecto (toolColor inicial).
  const { data } = eng.renderPage(doc, 0, 1);
  let rojo = false;
  for (let i = 0; i < data.length; i += 4) { if (data[i]! > 170 && data[i + 1]! < 100 && data[i + 2]! < 100) { rojo = true; break; } }
  expect(rojo).toBe(true);
  eng.close(doc);

  await page.locator('#btn-undo').click();
  const bytesDeshecho = await descargar(page, 'rect-deshecho.pdf');
  const eng2 = await PdfiumEngine.create();
  const doc2 = await eng2.open(bytesDeshecho);
  expect(eng2.listPathObjects(doc2, 0)).toHaveLength(0);
  eng2.close(doc2);
});

// (c) #17: borrador — clic en el BORDE de un rectángulo lo borra; clic en su
// centro (hueco interior) no, porque la selección es por proximidad a la
// arista, no por caja envolvente.
test('borrador: clic en el borde de un rectángulo lo borra; clic en su centro no', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-rect').click();
  const pagina = page.locator('.page').first();
  const b = (await pagina.boundingBox())!;
  const x0 = b.x + 60, y0 = b.y + 80, x1 = b.x + 280, y1 = b.y + 300;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('#status')).toHaveText('Rectángulo dibujado.');

  await page.locator('#btn-eraser').click();
  await expect(page.locator('#btn-eraser')).toHaveAttribute('aria-pressed', 'true');

  const contarPaths = async (nombre: string): Promise<number> => {
    const bytes = await descargar(page, nombre);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(bytes);
    const n = eng.listPathObjects(doc, 0).length;
    eng.close(doc);
    return n;
  };

  // Clic bien dentro del hueco interior: no debe borrar nada.
  await page.mouse.click((x0 + x1) / 2, (y0 + y1) / 2);
  expect(await contarPaths('borrador-centro.pdf')).toBe(1);

  // Clic sobre el borde superior: sí lo borra.
  await page.mouse.click((x0 + x1) / 2, y0);
  await expect(page.locator('#status')).toHaveText('Trazo borrado.');
  expect(await contarPaths('borrador-borde.pdf')).toBe(0);
});

// (d) los modos son excluyentes por construcción (setTool); Escape sale de
// cualquiera de ellos.
test('los modos de herramienta son excluyentes entre sí; Escape sale del modo activo', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-pen').click();
  await expect(page.locator('#btn-pen')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#btn-rect').click();
  await expect(page.locator('#btn-rect')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-pen')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#btn-eraser').click();
  await expect(page.locator('#btn-eraser')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-rect')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#btn-insert').click();
  await expect(page.locator('#btn-insert')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-eraser')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#btn-note').click();
  await expect(page.locator('#btn-note')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-insert')).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('Escape');
  await expect(page.locator('#btn-note')).toHaveAttribute('aria-pressed', 'false');
});
