import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

/** Descarga el PDF actual (#btn-save) y devuelve sus bytes. */
async function descargar(page: import('@playwright/test').Page, nombre: string): Promise<Uint8Array> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await download.saveAs(destino);
  return new Uint8Array(fs.readFileSync(destino));
}

// (a) #18: muestras de color — la paleta afecta al color de la HERRAMIENTA
// ACTIVA (aquí, la pluma; revisión del PR #56: cada herramienta recuerda su
// propio color, así que hay que activarla antes de elegir la muestra).
test('muestras de color: con la pluma activa, clic en la azul la marca aria-pressed y el trazo sale azul en el motor', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await abrirPestana(page, 'comentar');
  await page.locator('#btn-pen').click();
  await expect(page.locator('#btn-pen')).toHaveAttribute('aria-pressed', 'true');

  const azul = page.locator('.swatch[data-color="#2563eb"]');
  await azul.click();
  await expect(azul).toHaveAttribute('aria-pressed', 'true');
  // La roja (por defecto de la pluma) deja de estar marcada.
  await expect(page.locator('.swatch[data-color="#dc1414"]')).toHaveAttribute('aria-pressed', 'false');

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

// Revisión del PR #56: el color de herramienta NO se comparte entre
// herramientas — cada una recuerda el suyo. Elegir azul con la pluma activa
// no debe teñir el resaltador (que sigue en su amarillo de siempre); al
// volver a la pluma, la paleta vuelve a mostrar el azul elegido y el trazo
// sale azul otra vez.
test('colores por herramienta: elegir un color con la pluma activa no cambia el color del resaltador', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = page.locator('.run').first();
  await expect(run).toBeVisible();

  await abrirPestana(page, 'comentar');
  await page.locator('#btn-pen').click();
  await page.locator('.swatch[data-color="#2563eb"]').click();
  await expect(page.locator('.swatch[data-color="#2563eb"]')).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Escape'); // sale del modo pluma
  await expect(page.locator('#btn-pen')).toHaveAttribute('aria-pressed', 'false');
  // Sin modo activo, la paleta refleja el resaltador: amarillo, no tocado.
  await expect(page.locator('.swatch[data-color="#facc15"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.swatch[data-color="#2563eb"]')).toHaveAttribute('aria-pressed', 'false');

  await run.click();
  await page.locator('#btn-highlight').click();
  await expect(page.locator('#status')).toHaveText('Resaltado.');

  const bytesResaltado = await descargar(page, 'resaltado-no-afectado.pdf');
  const eng = await PdfiumEngine.create();
  const docResaltado = await eng.open(bytesResaltado);
  const { data: dataResaltado } = eng.renderPage(docResaltado, 0, 1);
  let amarillo = false;
  for (let i = 0; i < dataResaltado.length; i += 4) {
    if (dataResaltado[i]! > 200 && dataResaltado[i + 1]! > 180 && dataResaltado[i + 2]! < 120) { amarillo = true; break; }
  }
  expect(amarillo).toBe(true);
  eng.close(docResaltado);

  // Vuelve a la pluma: la paleta muestra el azul elegido antes, y el trazo sale azul.
  await page.locator('#btn-pen').click();
  await expect(page.locator('.swatch[data-color="#2563eb"]')).toHaveAttribute('aria-pressed', 'true');
  const pagina = page.locator('.page').first();
  const b = (await pagina.boundingBox())!;
  await page.mouse.move(b.x + 60, b.y + 300);
  await page.mouse.down();
  await page.mouse.move(b.x + 180, b.y + 340, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#status')).toHaveText('Trazo dibujado.');

  const bytesTrazo = await descargar(page, 'pluma-recordada-azul.pdf');
  const eng2 = await PdfiumEngine.create();
  const docTrazo = await eng2.open(bytesTrazo);
  const { data: dataTrazo } = eng2.renderPage(docTrazo, 0, 1);
  let azul = false;
  for (let i = 0; i < dataTrazo.length; i += 4) {
    if (dataTrazo[i]! < 90 && dataTrazo[i + 1]! < 150 && dataTrazo[i + 2]! > 150) { azul = true; break; }
  }
  expect(azul).toBe(true);
  eng2.close(docTrazo);
});

// (b) #16: rectángulo — arrastrar dibuja uno, verificado en el motor
// (listPathObjects + color), y Deshacer lo quita.
test('rectángulo: arrastrar dibuja uno con el color de herramienta; Deshacer lo quita', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await abrirPestana(page, 'comentar');
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

  await abrirPestana(page, 'comentar');
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

  // La caja de `.page` se vuelve a medir antes de cada clic (no se reutiliza
  // `b`/`x0..y1` de cuando se dibujó el rectángulo): la barra de
  // herramientas envuelve en varias filas (`flexWrap`) y su alto puede
  // cambiar entre acciones al activar/desactivar herramientas, desplazando
  // verticalmente `.page` unos px — con coordenadas obsoletas, el clic del
  // borde podía caer fuera del trazo y no borrar nada.
  const cajaActual = async (): Promise<{ x0: number; y0: number; x1: number; y1: number }> => {
    const caja = (await pagina.boundingBox())!;
    return { x0: caja.x + 60, y0: caja.y + 80, x1: caja.x + 280, y1: caja.y + 300 };
  };

  // Clic bien dentro del hueco interior: no debe borrar nada.
  {
    const { x0, y0, x1, y1 } = await cajaActual();
    await page.mouse.click((x0 + x1) / 2, (y0 + y1) / 2);
  }
  expect(await contarPaths('borrador-centro.pdf')).toBe(1);

  // Clic sobre el borde superior: sí lo borra.
  {
    const { x0, y0, x1 } = await cajaActual();
    await page.mouse.click((x0 + x1) / 2, y0);
  }
  await expect(page.locator('#status')).toHaveText('Trazo borrado.');
  expect(await contarPaths('borrador-borde.pdf')).toBe(0);
});

// (d) los modos son excluyentes por construcción (setTool); Escape sale de
// cualquiera de ellos.
test('los modos de herramienta son excluyentes entre sí; Escape sale del modo activo', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await abrirPestana(page, 'comentar');
  await page.locator('#btn-pen').click();
  await expect(page.locator('#btn-pen')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#btn-rect').click();
  await expect(page.locator('#btn-rect')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-pen')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#btn-eraser').click();
  await expect(page.locator('#btn-eraser')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-rect')).toHaveAttribute('aria-pressed', 'false');

  await abrirPestana(page, 'editar');
  await page.locator('#btn-insert').click();
  await expect(page.locator('#btn-insert')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-eraser')).toHaveAttribute('aria-pressed', 'false');

  await abrirPestana(page, 'comentar');
  await page.locator('#btn-note').click();
  await expect(page.locator('#btn-note')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-insert')).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('Escape');
  await expect(page.locator('#btn-note')).toHaveAttribute('aria-pressed', 'false');
});
