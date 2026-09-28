import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

// E-030: al entrar en edición, el bloque se posicionaba con `run.boxPt` (la
// caja ajustada a los glifos) y un `line-height` igual a su alto — pero el
// tamaño real de la fuente es mayor que esa caja, así que el texto editado
// quedaba desplazado en vertical respecto al original (el contorno cruzaba
// las letras en vez de enmarcarlas). Estos tests fijan que, al editar, la
// línea base y el x de inicio del texto coincidan con el origen real del
// texto original (`run.originPt`), como en Acrobat.
test('linea-base-edicion: al editar, la línea base y el x de inicio coinciden con el original', async ({ page }) => {
  // Geometría esperada, leída del propio PDF con el motor (Node), no
  // re-derivada del DOM: la app usa escala 1 sin rotación para este fixture
  // (mismo supuesto que fidelidad-reposo.spec.ts).
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(FIXTURE)));
  const original = eng.getPageText(doc, 0).find((r) => r.text.includes('ORIGINAL-TIMES'))!;
  const pageSize = eng.pageSize(doc, 0);
  eng.close(doc);
  expect(original).toBeDefined();

  // ptToCss con escala 1 y rotación 0 (ver PageGeometry.ptToCss, caso `0`):
  // x_css = xPt, y_css = alturaPágina - yPt.
  const esperadoBaselineCss = pageSize.heightPt - original.originPt.yPt;
  const esperadoXCss = original.originPt.xPt;

  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(run).toBeVisible();

  await run.click();
  await expect(run).toHaveClass(/editing/);

  // La propia run expone el objetivo calculado (dato de negocio, no derivado
  // del DOM): sirve de sanity-check de que TextLayer usa `originPt`.
  const baselineDataset = await run.evaluate((el) => el.getAttribute('data-baseline-css'));
  expect(baselineDataset).not.toBeNull();
  expect(Math.abs(Number(baselineDataset) - esperadoBaselineCss)).toBeLessThan(0.5);

  const pageRect = await page.locator('.page').first().boundingBox();
  expect(pageRect).not.toBeNull();

  // Mide la línea base REAL renderizada: un marcador de alto 0 con
  // `vertical-align: baseline` insertado al principio del bloque se alinea,
  // por definición, con la línea base — su `top` en viewport ES la línea base.
  const medida = await run.evaluate((el) => {
    const marker = document.createElement('span');
    marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;';
    el.insertBefore(marker, el.firstChild);
    const baselineTop = marker.getBoundingClientRect().top;
    const left = el.getBoundingClientRect().left;
    marker.remove();
    return { baselineTop, left };
  });

  const baselineViewportEsperado = pageRect!.y + esperadoBaselineCss;
  const xViewportEsperado = pageRect!.x + esperadoXCss;

  expect(Math.abs(medida.baselineTop - baselineViewportEsperado)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(medida.left - xViewportEsperado)).toBeLessThanOrEqual(1.5);

  // Escape restaura la geometría de reposo (misma caja que fidelidad-reposo).
  await page.keyboard.press('Escape');
  await expect(run).not.toHaveClass(/editing/);
  const tras = await run.evaluate((el) => el.getAttribute('data-baseline-css'));
  expect(tras).toBeNull();
});
