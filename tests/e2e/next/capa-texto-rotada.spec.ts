import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

// E-063: en una página con /Rotate 90/270/180 la capa de texto (`.run`) se dibujaba con la geometría
// visual pero con texto horizontal dentro de cajas verticales: las cajas crecían, se solapaban y un clic
// sobre una línea editaba OTRA (modificar lo que el usuario no tocó, AGENTS.md §2.3).
// `rotada-lineas.pdf`: 3 páginas (/Rotate 90, 270, 180) con 4 líneas "LINEA-k-ROTADA" de texto normal (vertical en 90/270).
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/rotada-lineas.pdf');
const CASOS = [
  { pagina: 0, rot: 90 },
  { pagina: 1, rot: 270 },
  { pagina: 2, rot: 180 }
] as const;

async function abrir(page: Page, pagina: number) {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();
  const wrapper = page.locator('.page').nth(pagina);
  await wrapper.scrollIntoViewIfNeeded();
  await expect(wrapper.locator('.run')).toHaveCount(4);
  return wrapper;
}

for (const { pagina, rot } of CASOS) {
  test(`capa-texto-rotada ${rot}: las cajas .run no se solapan y caen sobre los píxeles de su línea`, async ({ page }) => {
    const wrapper = await abrir(page, pagina);
    const r = await wrapper.evaluate((w) => {
      const canvas = w.querySelector('canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const wr = w.getBoundingClientRect();
      const k = canvas.width / wr.width; // px de canvas por px CSS de página
      return Array.from(w.querySelectorAll<HTMLElement>('.run')).map((el) => {
        const b = el.getBoundingClientRect(); // px CSS de cliente
        const x = Math.max(0, Math.round((b.left - wr.left) * k)), y = Math.max(0, Math.round((b.top - wr.top) * k));
        const ancho = Math.min(canvas.width - x, Math.round(b.width * k)), alto = Math.min(canvas.height - y, Math.round(b.height * k));
        const d = ctx.getImageData(x, y, Math.max(1, ancho), Math.max(1, alto)).data;
        let oscuros = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! < 384 && d[i + 3]! > 0) oscuros++;
        return { texto: el.textContent, l: b.left - wr.left, t: b.top - wr.top, w: b.width, h: b.height, oscuros };
      });
    });
    // (a) ninguna caja se solapa con otra
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const a = r[i]!, b = r[j]!;
      const sx = Math.min(a.l + a.w, b.l + b.w) - Math.max(a.l, b.l);
      const sy = Math.min(a.t + a.h, b.t + b.h) - Math.max(a.t, b.t);
      expect(sx > 1 && sy > 1, `cajas solapadas: ${JSON.stringify(a)} con ${JSON.stringify(b)}`).toBe(false);
    }
    // (b) cada caja es fina (una línea, no un bloque) y contiene píxeles oscuros de su línea
    for (const c of r) {
      const lado = rot === 180 ? c.h : c.w; // lado corto visual: alto de línea (ancho con texto vertical)
      expect(lado, `caja demasiado gruesa: ${JSON.stringify(c)}`).toBeLessThan(60);
      expect(c.oscuros, `la caja no cae sobre los píxeles de su línea: ${JSON.stringify(c)}`).toBeGreaterThan(30);
    }
  });

  test(`capa-texto-rotada ${rot}: clic en la línea X edita la línea X y solo esa`, async ({ page }) => {
    const wrapper = await abrir(page, pagina);
    // Se edita la línea 3 (no la primera ni la última: un clic desviado a una vecina o a la 4.ª se vería).
    const run = wrapper.locator('.run', { hasText: 'LINEA-3-ROTADA' });
    await run.click(); // al centro de la caja, tras llevarla a la vista; falla si otra caja la tapa
    await expect(run, 'el clic en el centro de LINEA-3 no la puso en edición').toHaveClass(/editing/);
    await expect(wrapper.locator('.run.editing')).toHaveCount(1);
    // El editor queda alineado con la línea: su caja es la de una línea (fina), no un bloque.
    const e = (await run.boundingBox())!;
    expect(Math.min(e.width, e.height), `editor desalineado ${JSON.stringify(e)}`).toBeLessThan(60);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('EDITADA-3');
    await page.keyboard.press('Enter');
    await expect(page.locator('#status')).toHaveText('Editado.');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
    const destino = path.join(test.info().outputDir, `rot${rot}.pdf`);
    await download.saveAs(destino);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
    const textos = eng.getPageText(doc, pagina).map((t) => t.text);
    const otras = eng.getPageText(doc, (pagina + 1) % 3).map((t) => t.text);
    eng.close(doc);
    expect(textos.some((t) => t.includes('EDITADA-3')), `textos=${JSON.stringify(textos)}`).toBe(true);
    expect(textos.some((t) => t.includes('LINEA-2-ROTADA')), `la línea 2 cambió: ${JSON.stringify(textos)}`).toBe(true);
    expect(textos.some((t) => t.includes('LINEA-4-ROTADA')), `la línea 4 cambió: ${JSON.stringify(textos)}`).toBe(true);
    expect(textos.some((t) => t.includes('LINEA-1-ROTADA')), `la línea 1 cambió: ${JSON.stringify(textos)}`).toBe(true);
    expect(textos.some((t) => t.includes('LINEA-3-ROTADA')), 'la línea 3 sigue con el texto original').toBe(false);
    expect(otras.filter((t) => t.includes('LINEA-')).length, 'otra página cambió').toBe(4);
  });

  test(`capa-texto-rotada ${rot}: arrastrar el tirador mueve la línea en la dirección visual del ratón`, async ({ page }) => {
    const wrapper = await abrir(page, pagina);
    const run = wrapper.locator('.run', { hasText: 'LINEA-3-ROTADA' });
    // En 180 la línea 3 queda cerca del borde inferior de la página: se centra para que el tirador (en la
    // esquina de la caja, fuera de ella) no caiga bajo la barra inferior del visor.
    await run.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
    await run.hover();
    const h =(await run.locator('.run-drag').boundingBox())!;
    const D = 60; // px CSS visuales de arrastre
    // 90/270: el eje X de usuario es el eje Y visual; 180: es el eje X visual (invertido).
    const [dx, dy] = rot === 180 ? [D, 0] : [0, D];
    const sentido = rot === 90 ? 1 : -1; // signo del cambio de xPt de usuario
    const escala = (await wrapper.boundingBox())!.width / (rot === 180 ? 595.28 : 841.89); // px CSS por pt
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2 + dy, { steps: 6 });
    await page.mouse.up();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
    const destino = path.join(test.info().outputDir, `mov${rot}.pdf`);
    await download.saveAs(destino);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
    const l3 = eng.getPageText(doc, pagina).find((t) => t.text.includes('LINEA-3-ROTADA'))!;
    eng.close(doc);
    const esperadoX = 80 + (sentido * D) / escala; // x de usuario original 80 pt
    const msg = `origen=${JSON.stringify(l3.originPt)} esperadoX=${esperadoX.toFixed(1)}`;
    expect(Math.abs(l3.originPt.xPt - esperadoX), msg).toBeLessThan(4); // pt PDF
    expect(Math.abs(l3.originPt.yPt - (841.89 - 100 - 64)), msg).toBeLessThan(4); // y de usuario no cambia
  });
}

// Texto contragirado (rotada.pdf: /Rotate 90/270/180 con el texto girado para que se lea horizontal): la línea
// gira en el espacio de usuario además de la página; el editor debe quedar horizontal y sobre la línea.
const ROTADA_CONTRAGIRADA = path.resolve(AQUI, '../../fixtures/generados/rotada.pdf');
for (const { pagina, rot } of CASOS) {
  test(`capa-texto-rotada ${rot}: con el texto contragirado el editor queda horizontal sobre la línea`, async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(ROTADA_CONTRAGIRADA);
    const wrapper = page.locator('.page').nth(pagina);
    await wrapper.scrollIntoViewIfNeeded();
    const run = wrapper.locator('.run', { hasText: 'ESQUINA-SUP-IZQ' });
    await run.scrollIntoViewIfNeeded();
    const reposo = (await run.boundingBox())!;
    await run.click();
    await expect(run).toHaveClass(/editing/);
    const e = (await run.boundingBox())!;
    const msg = `reposo=${JSON.stringify(reposo)} editor=${JSON.stringify(e)}`;
    expect(e.width, `el editor no es horizontal: ${msg}`).toBeGreaterThan(e.height * 3);
    // El centro del editor cae dentro de la caja de reposo de la línea (misma línea, no desplazado).
    const cx = e.x + e.width / 2, cy = e.y + e.height / 2;
    expect(cx > reposo.x - 10 && cx < reposo.x + reposo.width + 10 && cy > reposo.y - 10 && cy < reposo.y + reposo.height + 10, msg).toBe(true);
  });
}
