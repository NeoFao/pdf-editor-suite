/**
 * Fase 2 del sistema de diseño (E-130): Comprimir, Texto…, Atajos, propiedades de línea y paleta de color.
 * Comprueba en Chromium real, con estilos COMPUTADOS: contraste AA en claro y oscuro, foco visible,
 * etiquetas visibles asociadas a cada campo y que el aspecto nuevo no rompe el comportamiento.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';
import { auditarContraste } from './_contraste';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(PDF);
  await expect(page.locator('.run').first()).toBeVisible();
}

async function abrirComprimir(page: Page): Promise<void> {
  await abrirPestana(page, 'convertir');
  await page.locator('#btn-compress').click();
  await expect(page.locator('#compress-panel')).toBeVisible();
}

async function abrirTexto(page: Page): Promise<void> {
  await abrirPestana(page, 'convertir');
  await page.locator('#btn-extract-text').click();
  await expect(page.locator('#text-dialog')).toBeVisible();
}

for (const esquema of ['light', 'dark'] as const) {
  test(`contraste AA (≥ 4,5) en Comprimir, Texto, Atajos, propiedades y paleta, tema ${esquema === 'light' ? 'claro' : 'oscuro'}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: esquema, reducedMotion: 'reduce' });
    await abrir(page);

    await abrirComprimir(page);
    expect(await auditarContraste(page), 'Comprimir').toEqual([]);
    // También con el progreso a la vista (barra y texto).
    await page.locator('#compress-panel').evaluate((d) => {
      (d.querySelector('.progreso') as HTMLElement).hidden = false;
      d.querySelector('#compress-progress-text')!.textContent = 'Comprimiendo… imagen 3/10';
    });
    expect(await auditarContraste(page), 'Comprimir con progreso').toEqual([]);
    await page.keyboard.press('Escape');

    await abrirTexto(page);
    await page.locator('#btn-copy-text').evaluate((b) => b.closest('dialog')!.querySelector('#text-copy-aviso')!.append('Copiado.'));
    expect(await auditarContraste(page), 'Texto').toEqual([]);
    await page.keyboard.press('Escape');

    await page.keyboard.press('?');
    await expect(page.locator('#shortcuts-dialog')).toBeVisible();
    expect(await auditarContraste(page), 'Atajos').toEqual([]);
    await page.keyboard.press('Escape');

    await abrirPestana(page, 'comentar');
    expect(await auditarContraste(page), 'Comentar (paleta)').toEqual([]);
    await abrirPestana(page, 'editar');
    await page.locator('.run').first().click();
    await expect(page.locator('#props-panel')).toBeVisible();
    expect(await auditarContraste(page), 'Editar (propiedades)').toEqual([]);
  });
}

test('Comprimir: cada campo tiene etiqueta visible, el progreso está oculto hasta comprimir y las acciones van al pie', async ({ page }) => {
  await abrir(page);
  await abrirComprimir(page);
  const r = await page.evaluate(() => {
    const d = document.querySelector<HTMLDialogElement>('#compress-panel')!;
    const visible = (e: Element): boolean => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const huerfanos = Array.from(d.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))
      .filter((c) => !Array.from(c.labels ?? []).some((l) => visible(l) && (l.textContent ?? '').trim() !== '')).map((c) => c.id);
    const caja = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const run = caja('#btn-compress-run'); const cancel = caja('#compress-cancel'); const dlg = caja('#compress-panel');
    const fondo = (s: string) => getComputedStyle(document.querySelector(s)!).backgroundColor;
    return {
      huerfanos,
      activo: document.activeElement?.id,
      progresoVisible: visible(d.querySelector('.progreso')!),
      derecha: dlg.right - run.right,
      ordenOk: cancel.right <= run.left,
      distintos: fondo('#btn-compress-run') !== fondo('#compress-cancel'),
      titulo: d.getAttribute('aria-labelledby')
    };
  });
  expect(r.huerfanos).toEqual([]);
  expect(r.activo).toBe('compress-quality');
  expect(r.progresoVisible).toBe(false);
  expect(r.derecha).toBeLessThan(40);
  expect(r.ordenOk).toBe(true);
  expect(r.distintos).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Comprimir documento' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Calidad' })).toBeFocused();
});

test('Texto…: el área de texto tiene nombre accesible, foco inicial en ella y la primaria Copiar va la última', async ({ page }) => {
  await abrir(page);
  await abrirTexto(page);
  await expect(page.getByRole('textbox', { name: 'Texto del documento' })).toBeFocused();
  const orden = await page.locator('#text-dialog .dlg-pie button').allTextContents();
  expect(orden).toEqual(['Cerrar', 'Descargar .txt', 'Copiar']);
  await expect(page.locator('#text-dialog .dlg-cerrar')).toHaveAccessibleName('Cerrar');
  await page.locator('#text-dialog .dlg-cerrar').click();
  await expect(page.locator('#text-dialog')).toHaveCount(0);
});

test('Atajos: las teclas son <kbd>, cada alternativa en su línea y el texto sigue conteniendo la combinación', async ({ page }) => {
  await abrir(page);
  await page.keyboard.press('?');
  const tabla = page.locator('#shortcuts-table');
  await expect(tabla).toBeVisible();
  expect(await tabla.locator('kbd').count()).toBeGreaterThan(20);
  await expect(tabla).toContainText('Mayús + →');
  await expect(tabla).toContainText('Ctrl/Cmd + Z');
  await expect(tabla.locator('th[scope="row"]').first()).toBeVisible();
  // «Ctrl/Cmd + Y» y «Ctrl/Cmd + Mayús + Z» van en líneas distintas (dos .atajo-alt en la misma celda).
  const filaRehacer = tabla.locator('tr', { hasText: 'Rehacer' });
  expect(await filaRehacer.locator('.atajo-alt').count()).toBe(2);
  await expect(page.locator('#shortcuts-title')).toBeFocused();
  await expect(page.getByRole('link', { name: 'Versión anterior' })).toBeVisible();
});

test('foco visible por teclado en Comprimir (botones y campos) y en los botones de Texto…', async ({ page }) => {
  await abrir(page);
  await abrirComprimir(page);
  const visibleFoco = (): Promise<boolean> => page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement!);
    return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1) || (cs.boxShadow !== 'none' && /\d/.test(cs.boxShadow));
  });
  // El foco inicial es programático (no :focus-visible): se comprueba lo que se alcanza con Tab.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await visibleFoco(), `Tab ${i} en Comprimir: ${await page.evaluate(() => document.activeElement?.id)}`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await abrirTexto(page);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await visibleFoco(), `Tab ${i} en Texto`).toBe(true);
  }
});

test('paleta de color y propiedades de línea son grupos compactos con borde; la muestra activa se distingue y mide ≥ 24 px', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'comentar');
  const r = await page.evaluate(() => {
    const g = getComputedStyle(document.querySelector('#swatches')!);
    const sw = Array.from(document.querySelectorAll<HTMLElement>('#swatches button.swatch'));
    const activas = sw.filter((b) => b.getAttribute('aria-pressed') === 'true');
    const caja = sw[0]!.getBoundingClientRect();
    return {
      borde: g.borderTopWidth, radio: g.borderTopLeftRadius,
      activas: activas.length, sombraActiva: activas[0] ? getComputedStyle(activas[0]).boxShadow : 'none',
      sombraInactiva: getComputedStyle(sw.find((b) => b.getAttribute('aria-pressed') !== 'true')!).boxShadow,
      ancho: caja.width, alto: caja.height, fondoInline: sw[0]!.style.background !== ''
    };
  });
  expect(r.borde).toBe('1px');
  expect(parseFloat(r.radio)).toBeGreaterThanOrEqual(8);
  expect(r.activas).toBe(1);
  expect(r.sombraActiva).not.toBe('none');
  expect(r.sombraInactiva).toBe('none');
  expect(r.ancho).toBeGreaterThanOrEqual(24);
  expect(r.alto).toBeGreaterThanOrEqual(24);
  expect(r.fondoInline).toBe(true);

  await abrirPestana(page, 'editar');
  await page.locator('.run').first().click();
  await expect(page.locator('#props-panel')).toBeVisible();
  const p = await page.evaluate(() => {
    const g = getComputedStyle(document.querySelector('#props-panel')!);
    const campos = Array.from(document.querySelectorAll<HTMLElement>('#props-panel select, #props-panel input'));
    return { borde: g.borderTopWidth, ancho: document.querySelector('#prop-size')!.getBoundingClientRect().width, sinInline: campos.every((c) => c.getAttribute('style') === null) };
  });
  expect(p.borde).toBe('1px');
  expect(p.ancho).toBeGreaterThan(50);
  expect(p.sinInline).toBe(true);
});
