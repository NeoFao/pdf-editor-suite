import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/subconjunto.pdf');

const TEXTO_ORIGINAL = '✁✂✃✄';

/**
 * `subconjunto.pdf` tiene una línea en ZapfDingbats (fuente estándar sin
 * ningún glifo latino — ver generar-fixtures.mjs). Editarla a texto con
 * caracteres que le faltan ("Mañana €") dispara `glyph-missing` en
 * `editTextRun`; la app, como Acrobat, sustituye la fuente de esa línea por
 * la estándar PDF más parecida (Helvetica, aquí) en vez de rendirse.
 */
test('sustituir-fuente: editar con caracteres ausentes en el subconjunto sustituye la fuente y avisa', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);

  const run = page.locator('.run').first();
  await expect(run).toBeVisible();
  await expect(run).toHaveText(TEXTO_ORIGINAL);

  await run.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Mañana €');
  await page.keyboard.press('Enter');

  // Aviso: la línea sigue editada, pero con la fuente estándar (no se revirtió).
  await expect(page.locator('#status')).toHaveText('La fuente original no tiene algún carácter; la línea usa Helvetica.');

  // La capa de texto (tras el refresh del modelo) muestra el texto nuevo.
  const runNuevo = page.locator('.run', { hasText: 'Mañana €' });
  await expect(runNuevo).toBeVisible();

  // Prueba de oro de reposo (E-029/fidelidad-reposo.spec.ts): en reposo, tras
  // la sustitución, la capa de texto sigue sin pintar nada por encima del
  // render del motor — sin ella no habría diferencia visual. El ratón se
  // aparta primero: si quedara sobre la línea, `:hover` pintaría el contorno
  // sutil de selección (CSS intencional, no fantasma) y falsearía la prueba.
  await page.mouse.move(0, 0);
  const wrapper = page.locator('.page').first();
  const antes = await wrapper.screenshot();
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('.run').forEach((el) => { el.style.visibility = 'hidden'; });
  });
  const despues = await wrapper.screenshot();
  expect(Buffer.compare(antes, despues)).toBe(0);

  // Restaurar la capa oculta por el paso anterior antes de seguir interactuando.
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('.run').forEach((el) => { el.style.visibility = ''; });
  });

  // Deshacer vuelve exactamente al texto (y fuente) originales.
  await page.locator('#btn-undo').click();
  const runRestaurado = page.locator('.run').first();
  await expect(runRestaurado).toHaveText(TEXTO_ORIGINAL);
});
