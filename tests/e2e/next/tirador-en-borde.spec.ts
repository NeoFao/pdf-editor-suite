import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BORDE = path.resolve(AQUI, '../../fixtures/generados/lineas-borde.pdf');

// E-066: el tirador de mover (`.run-drag`) sobresale 9 px por la esquina superior izquierda de la línea.
// En una línea pegada al borde de la página quedaba fuera de la página (recortado o bajo otra capa).

for (const texto of ['ESQUINA', 'SUELO', 'CENTRO']) {
  test(`el tirador de mover de la línea ${texto} queda dentro de la página y es alcanzable`, async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(BORDE);
    await expect(page.locator('.run').first()).toBeVisible();
    const linea = page.locator('.run', { hasText: texto });
    await linea.hover();
    const tirador = linea.locator('.run-drag');
    await expect(tirador).toHaveCSS('opacity', '1');
    const t = (await tirador.boundingBox())!;
    const pag = (await page.locator('.acrobat-page, .page').first().boundingBox())!;
    expect(t.x).toBeGreaterThanOrEqual(pag.x - 0.5);
    expect(t.y).toBeGreaterThanOrEqual(pag.y - 0.5);
    expect(t.x + t.width).toBeLessThanOrEqual(pag.x + pag.width + 0.5);
    expect(t.y + t.height).toBeLessThanOrEqual(pag.y + pag.height + 0.5);
    // Es lo que recibe el puntero en su centro (no hay otra capa encima).
    const alcanzable = await page.evaluate(([cx, cy]: [number, number]) => document.elementFromPoint(cx, cy)?.classList.contains('run-drag'), [t.x + t.width / 2, t.y + t.height / 2] as [number, number]);
    expect(alcanzable).toBe(true);
  });
}
