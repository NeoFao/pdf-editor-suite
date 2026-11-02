import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// E-122: en una página con /Rotate 90 un arrastre entre varias líneas copiaba y marcaba el texto en orden inverso
// con los extremos cambiados, y los rectángulos salían en decenas de fragmentos (uno por carácter). El texto va
// horizontal en el espacio de usuario; con 90/270 queda vertical en pantalla. `seleccion-giros.pdf`: 5 páginas
// (/Rotate 0, 90, 180, 270 y 90 con CropBox desplazado) con 4 líneas "Pn-Lk alfa bravo charlie".
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/seleccion-giros.pdf');
const CASOS = [
  { pagina: 0, nombre: 'rotate 0' },
  { pagina: 1, nombre: 'rotate 90' },
  { pagina: 2, nombre: 'rotate 180' },
  { pagina: 3, nombre: 'rotate 270' },
  { pagina: 4, nombre: 'rotate 90 con CropBox desplazado' }
] as const;

interface Caja { x: number; y: number; width: number; height: number }

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();
  // Se aleja para que cada página quepa entera en la ventana: el arrastre no necesita scroll.
  const alto0 = (await page.locator('.page').first().boundingBox())!.height;
  for (let k = 0; k < 3; k++) await page.locator('#btn-zoom-out').click();
  await expect.poll(async () => (await page.locator('.page').first().boundingBox())!.height).toBeLessThan(alto0 * 0.7);
  await expect(page.locator('.page').first().locator('.run').first()).toBeVisible();
}

/** Caja (px de ventana) de la línea `k` (1..4) de la página `pagina`, con la página a la vista. */
async function caja(page: Page, pagina: number, k: number): Promise<Caja> {
  const w = page.locator('.page').nth(pagina);
  await w.scrollIntoViewIfNeeded();
  const run = w.locator('.run', { hasText: `P${pagina + 1}-L${k} ` });
  await expect(run).toBeVisible();
  return (await run.boundingBox())!;
}

/** Arrastra con el ratón real del centro de la línea `desde` al centro de la `hasta` (misma página). */
async function arrastrar(page: Page, pagina: number, desde: number, hasta: number): Promise<void> {
  const a = await caja(page, pagina, desde), b = await caja(page, pagina, hasta);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 4, a.y + a.height / 2 + 4, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
}

const corta = (a: Caja, b: Caja): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

for (const { pagina, nombre } of CASOS) {
  for (const inverso of [false, true]) {
    test(`${nombre}${inverso ? ' (arrastre inverso)' : ''}: de la línea 1 a la 3 copia cola, línea 2 y cabeza, en orden`, async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await abrir(page);
      if (inverso) await arrastrar(page, pagina, 3, 1); else await arrastrar(page, pagina, 1, 3);
      await page.keyboard.press('Control+C');
      const copiado = await page.evaluate(() => navigator.clipboard.readText());
      const [cola, l2, cabeza, ...mas] = copiado.split('\n');
      const l1 = `P${pagina + 1}-L1 alfa bravo charlie`, l3 = `P${pagina + 1}-L3 alfa bravo charlie`;
      expect(mas).toEqual([]);
      expect(l2).toBe(`P${pagina + 1}-L2 alfa bravo charlie`);
      // Los extremos son parciales (el punto inicial manda): cola de la línea 1 y cabeza de la 3, ni vacías ni enteras.
      expect(l1.endsWith(cola!) && cola!.length >= 4 && cola!.length < l1.length - 3).toBe(true);
      expect(l3.startsWith(cabeza!) && cabeza!.length >= 4 && cabeza!.length < l3.length - 3).toBe(true);
    });
  }

  test(`${nombre}: el arrastre de la línea 1 a la 3 pinta un rectángulo por línea sobre esas tres líneas`, async ({ page }) => {
    await abrir(page);
    await arrastrar(page, pagina, 1, 3);
    const rects = page.locator('.page').nth(pagina).locator('.sel-rect');
    await expect(rects).toHaveCount(3);
    const cajas: Caja[] = [];
    for (let k = 1; k <= 4; k++) cajas.push(await caja(page, pagina, k));
    const rs: Caja[] = await rects.evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }));
    // Cada rectángulo cae sobre UNA línea (1, 2 o 3) y la línea 4 queda sin marcar.
    const lineasMarcadas = rs.map((r) => cajas.map((c, i) => (corta(r, c) ? i + 1 : 0)).filter((n) => n > 0));
    for (const l of lineasMarcadas) expect(l.length).toBe(1);
    expect(lineasMarcadas.map((l) => l[0]).sort()).toEqual([1, 2, 3]);
  });
}
