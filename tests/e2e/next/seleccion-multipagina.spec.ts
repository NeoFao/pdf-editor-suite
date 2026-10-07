import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

// E-100: un arrastre que empieza en la página N y acaba en la N+k selecciona desde el punto inicial hasta el
// final de N, las páginas intermedias enteras y el principio de N+k hasta el punto final. Copiar une las
// páginas con un salto de línea; Resaltar/Subrayar/Tachar crean UNA anotación por página en UN solo paso de deshacer.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MULTI = path.resolve(AQUI, '../../fixtures/generados/seleccion-multipagina.pdf');
const L = [['Alfa uno', 'Alfa dos', 'Alfa tres'], ['Beta uno', 'Beta dos', 'Beta tres'], ['Gamma uno', 'Gamma dos', 'Gamma tres']];

/** Abre el fixture; `alejar` pulsa "Alejar" para que quepan las 3 páginas en la ventana (para arrastrar sin scroll). */
async function abrir(page: Page, alejar = true): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(MULTI);
  await expect(page.locator('.run').first()).toBeVisible();
  if (alejar) {
    // Se aleja hasta que las 3 páginas quepan enteras en la ventana: el arrastre del test no necesita scroll.
    for (let k = 0; k < 8; k++) {
      const ultima = await page.locator('.page').nth(2).boundingBox();
      if (ultima && ultima.y + ultima.height < (page.viewportSize()?.height ?? 0) - 20) break;
      await page.locator('#btn-zoom-out').click();
      await page.waitForTimeout(150);
    }
    await expect(page.locator('.page').nth(2).locator('.run').first()).toBeVisible();
  }
}

/** Arrastra con el ratón real del x relativo (0..1) de la línea `desde` al de la línea `hasta` (cualquier página). */
async function arrastrar(page: Page, desde: { texto: string; fx: number }, hasta: { texto: string; fx: number }): Promise<void> {
  const a = (await page.locator('.run', { hasText: desde.texto }).boundingBox())!;
  const b = (await page.locator('.run', { hasText: hasta.texto }).boundingBox())!;
  await page.mouse.move(a.x + a.width * desde.fx, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width * desde.fx + 12, a.y + a.height / 2 + 4, { steps: 3 });
  await page.mouse.move(b.x + b.width * hasta.fx, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
}

/** Guarda y devuelve, por página, los quads de cada anotación de marcado del tipo dado. */
async function marcasGuardadas(page: Page, nombre: string, kind = 'highlight'): Promise<number[][][][]> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const out: number[][][][] = [];
  for (let p = 0; p < 3; p++) {
    const marcas = eng.getComments(doc, p).filter((c) => c.kind === kind);
    out.push(marcas.map((m) => eng.getMarkupQuads(doc, p, m.index).map((q) => [...q])));
  }
  eng.close(doc);
  return out;
}

test('arrastrar de p1 a p3 y Ctrl+C copia exactamente el texto, uniendo las páginas con salto de línea', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await abrir(page);
  await arrastrar(page, { texto: L[0]![1]!, fx: 0.3 }, { texto: L[2]![1]!, fx: 0.98 });
  // p1: 2 líneas, p2: 3, p3: 2 → un rectángulo por línea en su página.
  await expect(page.locator('.page').nth(0).locator('.sel-rect')).toHaveCount(2);
  await expect(page.locator('.page').nth(1).locator('.sel-rect')).toHaveCount(3);
  await expect(page.locator('.page').nth(2).locator('.sel-rect')).toHaveCount(2);
  await page.keyboard.press('Control+C');
  const copiado = await page.evaluate(() => navigator.clipboard.readText());
  // Empieza a mitad de 'Alfa dos' (el punto de inicio manda): cola de esa línea + el resto exacto, páginas unidas con '\n'.
  const [cola, ...resto] = copiado.split('\n');
  expect('Alfa dos'.endsWith(cola!) && cola!.length >= 3 && cola!.length < 8).toBe(true);
  expect(resto).toEqual(['Alfa tres', 'Beta uno', 'Beta dos', 'Beta tres', 'Gamma uno', 'Gamma dos']);
});

test('arrastre inverso (de p3 a p1) selecciona lo mismo en orden de lectura', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await abrir(page);
  await arrastrar(page, { texto: L[2]![0]!, fx: 0.98 }, { texto: L[0]![2]!, fx: 0.02 });
  await page.keyboard.press('Control+C');
  const copiado = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiado).toBe(['Alfa tres', 'Beta uno', 'Beta dos', 'Beta tres', 'Gamma uno'].join('\n'));
});

test('resaltar crea una anotación por página con quads sobre las líneas correctas; deshacer las quita todas y rehacer las devuelve', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'comentar');
  await arrastrar(page, { texto: L[0]![1]!, fx: 0.3 }, { texto: L[2]![1]!, fx: 0.98 });
  await page.locator('#btn-highlight').click();
  await expect(page.locator('#status')).toHaveText('Resaltado.');
  await expect(page.locator('.sel-rect')).toHaveCount(0);

  const tras = await marcasGuardadas(page, 'marcado.pdf');
  expect(tras.map((p) => p.length)).toEqual([1, 1, 1]);
  expect(tras.map((p) => p[0]!.length)).toEqual([2, 3, 2]);
  // Cada quad cae sobre la línea que corresponde: se compara con la caja de las líneas del propio PDF.
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(path.join(test.info().outputDir, 'marcado.pdf'))));
  const esperadas = [[1, 2], [0, 1, 2], [0, 1]];
  for (let p = 0; p < 3; p++) {
    const runs = eng.getPageText(doc, p);
    tras[p]![0]!.forEach((q, k) => {
      const caja = runs.find((r) => r.text === L[p]![esperadas[p]![k]!])!.boxPt;
      const ys = [q[1]!, q[3]!, q[5]!, q[7]!], xs = [q[0]!, q[2]!, q[4]!, q[6]!];
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      expect(cy).toBeGreaterThan(caja.yPt - 1);
      expect(cy).toBeLessThan(caja.yPt + caja.hPt + 1);
      if (!(p === 0 && k === 0)) expect(Math.min(...xs)).toBeLessThan(caja.xPt + 3); // el primero empieza a mitad de línea
      expect(Math.max(...xs)).toBeGreaterThan(caja.xPt + caja.wPt - 3);
    });
  }
  eng.close(doc);

  // UN solo paso de deshacer quita las tres.
  await page.locator('#btn-undo').click();
  expect((await marcasGuardadas(page, 'deshecho.pdf')).map((p) => p.length)).toEqual([0, 0, 0]);
  await page.locator('#btn-redo').click();
  expect((await marcasGuardadas(page, 'rehecho.pdf')).map((p) => p.length)).toEqual([1, 1, 1]);
});

test('subrayar y tachar con selección multipágina crean una anotación por página', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'comentar');
  await arrastrar(page, { texto: L[0]![2]!, fx: 0.3 }, { texto: L[1]![0]!, fx: 0.6 });
  await page.locator('#btn-underline').click();
  await expect(page.locator('#status')).toHaveText('Subrayado.');
  await arrastrar(page, { texto: L[1]![2]!, fx: 0.3 }, { texto: L[2]![0]!, fx: 0.6 });
  await page.locator('#btn-strike').click();
  await expect(page.locator('#status')).toHaveText('Tachado.');
  const sub = await marcasGuardadas(page, 'sub.pdf', 'underline');
  expect(sub.map((p) => p.length)).toEqual([1, 1, 0]);
  const tac = await marcasGuardadas(page, 'tac.pdf', 'strikeout');
  expect(tac.map((p) => p.length)).toEqual([0, 1, 1]);
});

test('un arrastre dentro de una sola página se comporta como antes (una anotación, copia sin saltos extra)', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await abrir(page);
  await abrirPestana(page, 'comentar');
  await arrastrar(page, { texto: L[1]![0]!, fx: 0.3 }, { texto: L[1]![2]!, fx: 0.98 });
  await expect(page.locator('.page').nth(1).locator('.sel-rect')).toHaveCount(3);
  await expect(page.locator('.page').nth(0).locator('.sel-rect')).toHaveCount(0);
  await expect(page.locator('.page').nth(2).locator('.sel-rect')).toHaveCount(0);
  await page.keyboard.press('Control+C');
  const [cola, ...resto] = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
  expect('Beta uno'.endsWith(cola!) && cola!.length >= 3).toBe(true);
  expect(resto).toEqual(['Beta dos', 'Beta tres']);
  await page.locator('#btn-highlight').click();
  expect((await marcasGuardadas(page, 'una.pdf')).map((p) => p.length)).toEqual([0, 1, 0]);
});

test('con la ventana baja, mantener el ratón en el borde inferior desplaza solo y la selección llega a la página que no se veía', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 520 });
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(MULTI);
  await expect(page.locator('.run').first()).toBeVisible();
  const a = (await page.locator('.run', { hasText: L[0]![0]! }).boundingBox())!;
  const visor = (await page.locator('#viewer').boundingBox())!;
  await page.mouse.move(a.x + 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + 30, { steps: 3 });
  // Se queda quieto pegado al borde inferior del visor: el scroll automático lleva la selección hasta p3.
  await page.mouse.move(a.x + 60, visor.y + visor.height - 6, { steps: 5 });
  await expect.poll(async () => page.locator('.page').nth(2).locator('.sel-rect').count(), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.mouse.up();
  await page.keyboard.press('Control+C');
  const copiado = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiado.startsWith('Alfa uno\nAlfa dos')).toBe(true);
  expect(copiado).toContain('Beta dos');
  expect(copiado).toContain('Gamma uno');
});
