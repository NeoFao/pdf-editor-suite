import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MARCADORES = path.resolve(AQUI, '../../fixtures/generados/marcadores.pdf');
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

// Fase 1 de marcadores (outline): solo lectura y navegación, como el panel
// "Marcadores" de Acrobat. marcadores.pdf (ver generar-fixtures.mjs) tiene 3
// páginas y un outline: "Capítulo 1" (página 1) con el hijo "Sección 1.1"
// (página 2), y "Capítulo 2 — Ñandú" (página 3).

test('marcadores: el árbol se despliega y navega a la página; volver a Páginas restaura las miniaturas', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(MARCADORES);
  await expect(page.locator('.run').first()).toBeVisible();

  // Por defecto se ve el panel de páginas (miniaturas).
  await expect(page.locator('#thumbs canvas')).toHaveCount(3);

  await page.locator('#tab-outline').click();
  await expect(page.locator('#thumbs')).toBeHidden();

  const cap1 = page.locator('.outline-item', { hasText: 'Capítulo 1' });
  const cap2 = page.locator('.outline-item', { hasText: 'Capítulo 2 — Ñandú' });
  await expect(cap1).toBeVisible();
  await expect(cap2).toBeVisible();
  // El hijo aún no está desplegado.
  await expect(page.locator('.outline-item', { hasText: 'Sección 1.1' })).toBeHidden();

  // Despliega "Capítulo 1" y navega a su hijo.
  const filaCap1 = page.locator('li').filter({ has: cap1 }).first();
  await filaCap1.locator('.outline-toggle').click();
  const sec11 = page.locator('.outline-item', { hasText: 'Sección 1.1' });
  await expect(sec11).toBeVisible();
  await sec11.click();

  await expect(page.locator('#page-indicator')).toHaveText('2 / 3');

  // Vuelve a "Páginas": reaparecen las miniaturas.
  await page.locator('#tab-pages').click();
  await expect(page.locator('#thumbs canvas')).toHaveCount(3);
  await expect(page.locator('#outline-panel')).toBeHidden();
});

test('marcadores: un documento sin outline muestra el aviso de que no tiene marcadores', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(NATIVO);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#tab-outline').click();
  await expect(page.locator('#outline-panel')).toHaveText('Este documento no tiene marcadores.');
});
