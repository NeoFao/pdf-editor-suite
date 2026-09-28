import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PAGINAS_PEQUENAS = path.resolve(AQUI, '../../fixtures/generados/paginas-pequenas.pdf');
const PAGINAS_PEQUENAS_MARCADORES = path.resolve(AQUI, '../../fixtures/generados/paginas-pequenas-marcadores.pdf');
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf'); // A4, 2 páginas: NO caben todas, hace falta scroll real

// E-032 (docs/ERRORES-CONOCIDOS.md): la página "actual" (`App.currentPage`)
// dependía de que el IntersectionObserver del Viewer reaccionara a un scroll
// real. Con `paginas-pequenas.pdf` las 4 páginas caben a la vez en el
// viewport (1440×900): el scroll no se mueve al navegar y antes del arreglo
// `currentPage` se quedaba con el valor anterior.

test.describe('E-032: la "página actual" sigue la selección explícita del usuario', () => {
  test('clic en una miniatura fija la página actual aunque el scroll no se mueva; Eliminar página borra la elegida, no la primera', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(PAGINAS_PEQUENAS);
    await expect(page.locator('.run').first()).toBeVisible();
    await expect(page.locator('#thumbs canvas')).toHaveCount(4);

    // Las 4 páginas ya son visibles: seleccionar la 3 no mueve el scroll.
    await page.locator('#thumbs canvas').nth(2).click();
    await expect(page.locator('#page-indicator')).toHaveText('3 / 4');
    await expect(page.locator('#thumbs canvas').nth(2)).toHaveClass(/active/);

    await page.locator('#btn-delete-page').click();

    await expect(page.locator('#thumbs canvas')).toHaveCount(3);
    // El defecto destructivo: sin el arreglo, esto borraba PAGINA-1.
    await expect(page.locator('.run', { hasText: 'PAGINA-3' })).toHaveCount(0);
    await expect(page.locator('.run', { hasText: 'PAGINA-1' })).toHaveCount(1);
    await expect(page.locator('.run', { hasText: 'PAGINA-2' })).toHaveCount(1);
    await expect(page.locator('.run', { hasText: 'PAGINA-4' })).toHaveCount(1);
  });

  test('siguiente/anterior avanzan la página actual aunque todo el documento quepa en pantalla', async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(PAGINAS_PEQUENAS);
    await expect(page.locator('.run').first()).toBeVisible();

    await expect(page.locator('#page-indicator')).toHaveText('1 / 4');
    await page.locator('#btn-next').click();
    await expect(page.locator('#page-indicator')).toHaveText('2 / 4');
    await page.locator('#btn-prev').click();
    await expect(page.locator('#page-indicator')).toHaveText('1 / 4');
  });

  test('clic en un marcador fija la página actual a la suya, aunque todas quepan en pantalla', async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(PAGINAS_PEQUENAS_MARCADORES);
    await expect(page.locator('.run').first()).toBeVisible();

    await page.locator('#tab-outline').click();
    await page.locator('.outline-item', { hasText: 'Marcador 3' }).click();
    await expect(page.locator('#page-indicator')).toHaveText('3 / 4');
  });

  test('el scroll manual del usuario sigue actualizando el indicador', async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(NATIVO);
    await expect(page.locator('.run').first()).toBeVisible();
    await expect(page.locator('#page-indicator')).toHaveText('1 / 2');

    await page.locator('#viewer').hover();
    // Rueda del ratón: scroll real del usuario, no programático.
    await page.mouse.wheel(0, 2000);
    await expect(page.locator('#page-indicator')).toHaveText('2 / 2');
  });
});
