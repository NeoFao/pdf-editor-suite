import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

/**
 * Revisión de PR #63 (captura 12-movil-cajon): sin `overflow: hidden` en
 * `html`/`body`, un desajuste de unos pocos px entre el contenido de `#app`
 * y el alto real de la ventana abría una TERCERA barra de scroll vertical a
 * nivel de página (además de las de `#viewer` y `#thumbs`, que sí deben
 * desplazar) — y con ella, scroll horizontal también a nivel de página. Esta
 * app es un "shell" de una sola pantalla: `document.documentElement` (y
 * `body`) nunca deben poder desplazarse por sí mismos.
 */
for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`sin scroll a nivel de página en ${vp.width}×${vp.height}, con un documento abierto y el cajón/menú abiertos`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(FIXTURE);
    await expect(page.locator('.run').first()).toBeVisible();

    const sinScrollDePagina = () => page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollH: doc.scrollHeight, innerH: window.innerHeight, scrollW: doc.scrollWidth, innerW: window.innerWidth };
    });

    let m = await sinScrollDePagina();
    expect(m.scrollH).toBeLessThanOrEqual(m.innerH);
    expect(m.scrollW).toBeLessThanOrEqual(m.innerW);

    if (vp.width <= 768) {
      // El cajón (☰) y el menú "⋯" son los casos que más contenido añaden de golpe.
      await page.locator('#btn-drawer').click();
      m = await sinScrollDePagina();
      expect(m.scrollH).toBeLessThanOrEqual(m.innerH);
      expect(m.scrollW).toBeLessThanOrEqual(m.innerW);

      await page.locator('#btn-drawer').click(); // cierra, para no tapar #btn-more
      await page.locator('#btn-more').click();
      m = await sinScrollDePagina();
      expect(m.scrollH).toBeLessThanOrEqual(m.innerH);
      expect(m.scrollW).toBeLessThanOrEqual(m.innerW);
    }
  });
}

test('móvil: la fila de herramientas oculta la barra de scroll horizontal nativa pero conserva el desplazamiento táctil', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  const fila = page.locator('.topbar-scroll');
  await expect(fila).toHaveCSS('scrollbar-width', 'none');

  // El desplazamiento táctil sigue funcionando: fuerza el scroll y comprueba que avanza.
  await fila.evaluate((el) => { el.scrollLeft = 200; });
  await expect.poll(() => fila.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});
