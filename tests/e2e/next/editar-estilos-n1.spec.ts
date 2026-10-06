import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const POR_GLIFO = path.resolve(AQUI, '../../fixtures/generados/por-glifo.pdf');

/**
 * N1 F4 (3): el editor de una línea compuesta muestra cada TRAMO con su estilo (negrita, color) en vez de todo con la
 * fuente del primer objeto. Son `<span>` creados con `textContent` (nunca innerHTML, §2.2).
 */
async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(POR_GLIFO);
  await expect(page.locator('.run').first()).toBeVisible();
}

test('al editar «Estilo mixto…» el editor pinta tres tramos: normal, NEGRITA roja en negrita y normal', async ({ page }) => {
  await abrir(page);
  const run = page.locator('.run', { hasText: 'Estilo mixto: normal NEGRITA y fin.' });
  await expect(run.locator('.run-estilo')).toHaveCount(0); // en reposo, texto plano
  await run.click();
  await expect(run).toHaveClass(/editing/);
  const tramos = run.locator('.run-estilo');
  await expect(tramos).toHaveCount(3);
  await expect(tramos.nth(0)).toHaveText('Estilo mixto: normal ');
  await expect(tramos.nth(1)).toHaveText('NEGRITA');
  await expect(tramos.nth(2)).toHaveText(' y fin.');
  const estilos = await tramos.evaluateAll((els) => els.map((e) => { const s = getComputedStyle(e); return { peso: s.fontWeight, color: s.color }; }));
  expect(estilos[0]!.peso).toBe('400');
  expect(estilos[1]!.peso).toBe('700');
  expect(estilos[1]!.color).toBe('rgb(255, 0, 0)');
  expect(estilos[2]!.color).not.toBe('rgb(255, 0, 0)');
  await expect(run).toHaveText('Estilo mixto: normal NEGRITA y fin.'); // el texto es el de la línea entera
});

test('una línea compuesta de un solo estilo se edita sin tramos', async ({ page }) => {
  await abrir(page);
  const run = page.locator('.run', { hasText: 'Celda A1' });
  await run.click();
  await expect(run).toHaveClass(/editing/);
  await expect(run.locator('.run-estilo')).toHaveCount(0);
});

test('editar con tramos y confirmar: el diff mínimo respeta la negrita y vuelve a texto plano', async ({ page }) => {
  await abrir(page);
  const run = page.locator('.run', { hasText: 'Estilo mixto: normal NEGRITA y fin.' });
  await run.click();
  await expect(run).toHaveClass(/editing/);
  // Se teclea al final (fuera de la negrita).
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' FIN');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Editado.');
  const editada = page.locator('.run', { hasText: 'Estilo mixto: normal NEGRITA y fin. FIN' });
  await expect(editada).toBeVisible();
  await expect(editada.locator('.run-estilo')).toHaveCount(0);
});

test('Escape cancela y devuelve el texto plano sin perder el tirador de arrastre', async ({ page }) => {
  await abrir(page);
  const run = page.locator('.run', { hasText: 'Estilo mixto: normal NEGRITA y fin.' });
  await run.click();
  await expect(run.locator('.run-estilo')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(run).not.toHaveClass(/editing/);
  await expect(run.locator('.run-estilo')).toHaveCount(0);
  await expect(run.locator('.run-drag')).toHaveCount(1);
  await expect(run).toHaveText('Estilo mixto: normal NEGRITA y fin.');
});
