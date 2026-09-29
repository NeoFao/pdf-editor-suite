import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/paginas-pequenas.pdf'); // 4 páginas

/**
 * Interfaz en móvil (#35 de la tabla de paridad, §9): cajón lateral,
 * barra de herramientas en ≤2 filas, objetivos táctiles ≥40×40px, visor a
 * todo el ancho, sin scroll horizontal de la página.
 *
 * El viewport se fija AQUÍ (`test.use`), en vez de añadir un proyecto nuevo
 * a playwright.config.js (p. ej. `next-movil` con `devices['Pixel 7']`):
 * un proyecto nuevo compartiría el mismo `webServer` de `build:next` sin
 * problema, pero el diseño responsivo de esta app es puramente por ANCHO
 * (media query `max-width: 768px`, igual que E-026 en la app vieja) — no
 * depende de `isMobile`/`hasTouch`/user-agent de un dispositivo emulado — así
 * que fijar el viewport en el propio spec basta y evita otra entrada de
 * `projects`/`testMatch`/`testIgnore` que mantener sincronizada en el mismo
 * fichero que ya reparte `movil` (app vieja) y `next` (app nueva, escritorio).
 */
test.use({ viewport: { width: 390, height: 844 } });

test.describe('Móvil (390×844)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(FIXTURE);
    await expect(page.locator('.run').first()).toBeVisible();
  });

  test('el panel lateral está oculto al abrir; ☰ lo abre; clic en una miniatura navega y lo cierra', async ({ page }) => {
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).not.toHaveClass(/abierto/);
    // Fuera de pantalla por `transform: translateX(-100%)`: su borde derecho
    // queda en x<=0 (o muy cerca, por redondeo de subpíxel).
    const cerrado = (await sidebar.boundingBox())!;
    expect(cerrado.x + cerrado.width).toBeLessThanOrEqual(1);

    await page.locator('#btn-drawer').click();
    await expect(sidebar).toHaveClass(/abierto/);
    await expect(page.locator('#btn-drawer')).toHaveAttribute('aria-expanded', 'true');
    // `#sidebar` desliza con una transición CSS de .2s (`transform`); sin
    // esperar a que termine, la caja medida a mitad de camino todavía está
    // parcialmente fuera de pantalla (ver docs/TESTING.md § "Sin esperas por
    // tiempo cuando haya una condición que esperar": esta es la excepción
    // documentada, una transición sin evento que esperar).
    await page.waitForTimeout(250);
    const abierto = (await sidebar.boundingBox())!;
    expect(abierto.x).toBeGreaterThanOrEqual(-1);

    await page.locator('#thumbs canvas').nth(2).click();
    await expect(page.locator('#page-indicator')).toHaveText('3 / 4');
    await expect(sidebar).not.toHaveClass(/abierto/);
    await expect(page.locator('#btn-drawer')).toHaveAttribute('aria-expanded', 'false');
  });

  test('Escape y el telón de fondo también cierran el cajón, y devuelven el foco a ☰', async ({ page }) => {
    const sidebar = page.locator('#sidebar');

    await page.locator('#btn-drawer').click();
    await expect(sidebar).toHaveClass(/abierto/);
    await page.keyboard.press('Escape');
    await expect(sidebar).not.toHaveClass(/abierto/);
    await expect(page.locator('#btn-drawer')).toBeFocused();

    await page.locator('#btn-drawer').click();
    await expect(sidebar).toHaveClass(/abierto/);
    // Se toca fuera del cajón (que ocupa como mucho 320px de los 390): el
    // telón sigue ahí, más a la derecha.
    await page.locator('#drawer-backdrop').click({ position: { x: 360, y: 400 } });
    await expect(sidebar).not.toHaveClass(/abierto/);
  });

  test('la barra de herramientas no supera 2 filas y sus botones alcanzan 40×40 px', async ({ page }) => {
    const alturaBoton = (await page.locator('#btn-save').boundingBox())!.height;
    const alturaBarra = (await page.locator('#toolbar').boundingBox())!.height;
    // ≤2 filas de botones + status (una línea de texto pequeña) + padding/gap
    // del propio #toolbar: holgura generosa a propósito, la aserción real es
    // "no crece sin límite" (varias filas de controles), no un pixel exacto.
    expect(alturaBarra).toBeLessThanOrEqual(alturaBoton * 2 + 48);

    for (const id of ['#btn-drawer', '#btn-more', '#btn-save', '#btn-undo', '#btn-redo', '#btn-zoom-in', '#btn-zoom-out', '#btn-new']) {
      const caja = (await page.locator(id).boundingBox())!;
      expect(caja.width, `${id} ancho`).toBeGreaterThanOrEqual(40);
      expect(caja.height, `${id} alto`).toBeGreaterThanOrEqual(40);
    }
  });

  test('el menú "⋯" revela los controles secundarios (ocultos hasta entonces)', async ({ page }) => {
    await expect(page.locator('#btn-rotate')).not.toBeVisible();
    await expect(page.locator('#btn-more')).toHaveAttribute('aria-expanded', 'false');

    await page.locator('#btn-more').click();
    await expect(page.locator('#btn-rotate')).toBeVisible();
    await expect(page.locator('#btn-more')).toHaveAttribute('aria-expanded', 'true');

    await page.locator('#btn-more').click();
    await expect(page.locator('#btn-rotate')).not.toBeVisible();
  });

  test('el visor ocupa al menos el 95% del ancho de la ventana', async ({ page }) => {
    const caja = (await page.locator('#viewer').boundingBox())!;
    expect(caja.width).toBeGreaterThanOrEqual(390 * 0.95);
  });

  test('no hay scroll horizontal de la página, ni con el cajón cerrado ni con él abierto', async ({ page }) => {
    const scrollHorizontal = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(await scrollHorizontal()).toBe(false);

    await page.locator('#btn-drawer').click();
    expect(await scrollHorizontal()).toBe(false);

    await page.locator('#btn-drawer').click();
    await page.locator('#btn-more').click();
    expect(await scrollHorizontal()).toBe(false);
  });
});
