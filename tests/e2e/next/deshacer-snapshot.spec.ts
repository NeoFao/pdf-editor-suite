import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * E-090 (docs/ERRORES-CONOCIDOS.md): deshacer una edición de texto devuelve la página EXACTAMENTE como estaba, incluso
 * si su content stream lleva estado gráfico (`4 M`, `1.5 i`) que PDFium no regenera, porque se restaura por SNAPSHOT.
 * Y esa recarga sigue siendo perezosa en un documento grande (E-043/E-044).
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const INGLETE = path.resolve(AQUI, '../../fixtures/generados/inglete.pdf');
const GRANDE = path.resolve(AQUI, '../../fixtures/generados/grande.pdf');

type Diag = { renderPage: number; getPageText: number };

async function editar(page: Page, run: ReturnType<Page['locator']>, texto: string): Promise<void> {
  await run.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(texto);
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Editado.');
}

test('deshacer-snapshot: editar y deshacer deja el canvas de la página idéntico al original (inglete.pdf)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(INGLETE);
  const run = page.locator('.run', { hasText: 'INGLETE' });
  await expect(run).toBeVisible();
  const lienzo = page.locator('.page canvas').first();
  // Píxeles del canvas del motor, no una captura de pantalla: esa incluiría el contorno y el tirador de la capa de texto.
  const pixeles = (): Promise<string> => lienzo.evaluate((c: HTMLCanvasElement) => c.toDataURL('image/png'));
  const antes = await pixeles();

  await editar(page, run, 'OTRO TEXTO');
  await expect(page.locator('.run', { hasText: 'OTRO TEXTO' })).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.run', { hasText: 'INGLETE' })).toBeVisible();
  await expect(page.locator('.run', { hasText: 'OTRO TEXTO' })).toHaveCount(0);

  // El repintado tras recargar es asíncrono: se reintenta hasta que el canvas coincide (o agota el tiempo).
  await expect.poll(pixeles, { timeout: 8000 }).toBe(antes);
});

test('deshacer-snapshot: en un documento de 500 páginas deshacer no relee ni repinta todas las páginas', async ({ page }) => {
  await page.goto('/index.next.html?diagnostico=1');
  await page.locator('#file-input').setInputFiles(GRANDE);
  const run = page.locator('.run', { hasText: 'Pagina 1' }).first();
  await expect(run).toBeVisible();
  await page.waitForTimeout(200);

  await editar(page, run, 'Pagina X');
  await page.waitForTimeout(150);
  const leer = (): Promise<Diag & { paginasPintadas: number }> =>
    page.evaluate(() => ({ ...(window as unknown as { __diagnostico: Diag & { paginasPintadas: number } }).__diagnostico }));
  const antes = await leer();

  const t0 = Date.now();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.run', { hasText: 'Pagina 1' }).first()).toBeVisible();
  const ms = Date.now() - t0;
  await page.waitForTimeout(300);
  const despues = await leer();
  console.log(`E-090 coste deshacer en grande.pdf: ${ms} ms hasta ver el texto; getPageText +${despues.getPageText - antes.getPageText}, renderPage +${despues.renderPage - antes.renderPage}`);

  expect(despues.getPageText - antes.getPageText).toBeLessThan(10);
  expect(despues.renderPage - antes.renderPage).toBeLessThan(80); // las páginas visibles + miniaturas visibles, nunca las 500
});
