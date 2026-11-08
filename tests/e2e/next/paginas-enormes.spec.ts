import { test, expect, type Page } from '@playwright/test';
import { MAX_PIXELES_BITMAP } from '../../../src/engine/limiteBitmap';

/**
 * E-129: el tamaño del bitmap por página no estaba acotado de forma absoluta (A-2, A-3 del QA de funciones). Una página
 * válida de 7200x7200 o 14400x14400 pt (límite de Acrobat) bloqueaba el hilo segundos, y un MediaBox de 1e9 lanzaba
 * «Invalid typed array length» dejando la página en blanco y sin aviso. Aquí se fija el contrato por TRABAJO (píxeles del
 * canvas, mensajes, errores), no por tiempo de reloj (E-040).
 */

/** PDF mínimo con una página por tamaño `[ancho, alto]` (pt de usuario) y la cadena "HHHH" grande en (w/10, h/2). */
function construirPdf(paginas: Array<[number, number]>): Buffer {
  const objs: string[] = [];
  const kids = paginas.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  paginas.forEach(([w, h], i) => {
    const pg = 4 + i * 2, ct = pg + 1;
    const tam = w < 5000 ? 24 : Math.min(2000, Math.max(24, Math.round(Math.min(w, h) / 6)));
    const flujo = `BT /F1 ${tam} Tf ${Math.round(w / 10)} ${Math.round(h / 2)} Td (HHHH) Tj ET`;
    objs[pg] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${ct} 0 R >>`;
    objs[ct] = `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const off: number[] = [];
  for (let n = 1; n < objs.length; n++) { off[n] = out.length; out += `${n} 0 obj\n${objs[n]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) out += `${String(off[n]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function abrir(page: Page, paginas: Array<[number, number]>): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles({ name: 'enorme.pdf', mimeType: 'application/pdf', buffer: construirPdf(paginas) });
  await page.locator('.page').first().waitFor({ state: 'attached' });
}

/** Píxeles de bitmap, caja de tinta y caja del run de la página `n` (px CSS relativos al wrapper). */
async function medirPagina(page: Page, n: number) {
  const w = page.locator('.page').nth(n);
  await w.scrollIntoViewIfNeeded();
  await w.locator('canvas').first().waitFor({ state: 'attached' });
  return w.evaluate((wrap) => {
    const cv = wrap.querySelector('canvas') as HTMLCanvasElement;
    const wr = wrap.getBoundingClientRect();
    const k = cv.width / cv.getBoundingClientRect().width;
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height);
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
      const i = (y * d.width + x) * 4;
      if (d.data[i]! + d.data[i + 1]! + d.data[i + 2]! < 384) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    }
    const run = wrap.querySelector('.run') as HTMLElement | null;
    const rr = run?.getBoundingClientRect();
    return {
      pixeles: cv.width * cv.height, cssPorPx: 1 / k,
      tinta: x1 < 0 ? null : { left: x0 / k, top: y0 / k, right: (x1 + 1) / k, bottom: (y1 + 1) / k },
      run: rr ? { left: rr.left - wr.left, top: rr.top - wr.top, right: rr.right - wr.left, bottom: rr.bottom - wr.top } : null
    };
  });
}

for (const lado of [7200, 14400]) {
  test(`página de ${lado} pt: el bitmap no supera el tope de píxeles y la capa de texto sigue sobre los glifos`, async ({ page }) => {
    await abrir(page, [[612, 792], [lado, lado]]);
    await page.locator('.page').nth(1).scrollIntoViewIfNeeded();
    // Zoom alto para que el bitmap (no solo el CSS) se acote.
    for (let i = 0; i < 6; i++) await page.locator('#btn-zoom-in').click();
    const m = await medirPagina(page, 1);
    expect(m.pixeles).toBeLessThanOrEqual(MAX_PIXELES_BITMAP);
    expect(m.run, 'la capa de texto debe existir').not.toBeNull();
    expect(m.tinta, 'la página debe tener glifos pintados').not.toBeNull();
    // Alineación ±1 px de BITMAP (a resolución reducida un px de bitmap son varios px CSS): la tinta cae dentro del run (caja de línea) y cubre la mayor parte de su ancho.
    const tol = 1 + m.cssPorPx;
    expect(m.tinta!.left).toBeGreaterThanOrEqual(m.run!.left - tol);
    expect(m.tinta!.right).toBeLessThanOrEqual(m.run!.right + tol);
    expect(m.tinta!.top).toBeGreaterThanOrEqual(m.run!.top - tol);
    expect(m.tinta!.bottom).toBeLessThanOrEqual(m.run!.bottom + tol);
    expect(m.tinta!.right - m.tinta!.left).toBeGreaterThan((m.run!.right - m.run!.left) * 0.6);
    // Resolución reducida: aviso visible en la página.
    await expect(page.locator('.page').nth(1).locator('.aviso-resolucion')).toBeVisible();
  });
}

test('MediaBox de 1e9: aviso visible en esa página, ninguna pageerror y las demás páginas se pintan', async ({ page }) => {
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await abrir(page, [[612, 792], [1e9, 1e9], [612, 792]]);
  await expect(page.locator('.page').first().locator('canvas')).toBeAttached();
  const absurda = page.locator('.page').nth(1);
  await absurda.scrollIntoViewIfNeeded();
  await expect(absurda.locator('.pagina-invalida')).toBeVisible();
  await expect(absurda.locator('.pagina-invalida')).toContainText(/tamaño/i);
  const ultima = page.locator('.page').nth(2);
  await ultima.scrollIntoViewIfNeeded();
  await expect(ultima.locator('canvas')).toBeAttached();
  expect(errores).toEqual([]);
});
