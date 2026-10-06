import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const GRANDE = path.resolve(AQUI, '../../fixtures/generados/grande.pdf'); // 500 páginas, "Pagina N" en cada una

/**
 * E-087: durante «Reemplazar todo» (cede el hilo) Guardar seguía habilitado y descargaba un PDF a medio reemplazar.
 * Candado de operación en curso: una sola operación larga a la vez; Guardar, Imprimir, Deshacer y Rehacer (y sus atajos)
 * quedan en `aria-disabled` hasta que termina; la navegación y el zoom siguen libres.
 */
let total = 0; // coincidencias de «Pagina» en el original
async function lanzarReemplazo(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(GRANDE);
  await expect(page.locator('.run').first()).toBeVisible();
  await page.keyboard.press('Control+H');
  await page.locator('#btn-search').fill('Pagina');
  await expect(page.locator('#search-count')).toHaveText(/^[0-9]+ resultados$/, { timeout: 60_000 });
  total = Number(/^([0-9]+)/.exec(await page.locator('#search-count').innerText())![1]);
  await page.locator('#replace-input').fill('Hoja');
  await page.locator('#btn-replace-all').click();
}

test('durante «Reemplazar todo» Guardar/Imprimir/Deshacer/Rehacer están deshabilitados, Ctrl+S no descarga y el zoom sigue; al acabar Guardar descarga el resultado COMPLETO', async ({ page }) => {
  await lanzarReemplazo(page);
  for (const id of ['btn-save', 'btn-print', 'btn-undo', 'btn-redo']) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('aria-disabled', 'true');
  }
  let descargo = false;
  page.on('download', () => { descargo = true; });
  await page.keyboard.press('Control+S');
  await page.locator('#btn-save').click({ force: true });
  await expect(page.locator('#btn-save')).toHaveAttribute('title', /Espera a que termine «Reemplazar todo»/);
  // La navegación y el zoom siguen permitidos.
  await page.locator('#btn-zoom-in').click();
  await expect(page.locator('#zoom-pct')).not.toHaveText('100%');
  await expect(page.locator('#replace-result')).toContainText(`${total} reemplazos`, { timeout: 120_000 });
  expect(descargo).toBe(false);
  for (const id of ['btn-save', 'btn-print', 'btn-undo', 'btn-redo']) {
    await expect(page.locator(`#${id}`)).not.toHaveAttribute('aria-disabled', 'true');
  }
  // Ya liberado: guardar descarga el documento con las 500 páginas reemplazadas.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const destino = path.join(test.info().outputDir, 'reemplazado.pdf');
  await dl.saveAs(destino);
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(destino);
  await expect(page.locator('.run').first()).toBeVisible();
  await page.locator('#btn-search').fill('Hoja');
  await expect(page.locator('#search-count')).toHaveText(`${total} resultados`, { timeout: 60_000 });
  await page.locator('#btn-search').fill('Pagina');
  await expect(page.locator('#search-count')).toHaveText('Sin resultados', { timeout: 60_000 });
});
