import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana, escribirNota } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

test('modo Nota: un clic sobre una línea de texto coloca la nota, no edita la línea (N7)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const linea = page.locator('.run').first();
  await expect(linea).toBeVisible();

  await abrirPestana(page, 'comentar');
  await page.locator('#btn-note').click();
  await linea.click(); // centro de la línea

  await escribirNota(page, 'Nota sobre texto');
  await expect(page.locator('#status')).toHaveText('Nota añadida.');
  await expect(page.locator('.note-marker')).toHaveCount(1);
  await expect(page.locator('.run.editing')).toHaveCount(0);
});

test('modo Insertar texto: un clic sobre una línea inserta texto nuevo, no edita la línea (N7)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const linea = page.locator('.run').first();
  await expect(linea).toBeVisible();
  const antes = await page.locator('.run').count();

  await abrirPestana(page, 'editar');
  await page.locator('#btn-insert').click();
  await linea.click();

  await expect(page.locator('.run', { hasText: 'Texto nuevo' })).toHaveCount(1);
  await expect(page.locator('.run')).toHaveCount(antes + 1);
  await expect(page.locator('.run.editing')).toHaveCount(0);
});

test('sin herramienta, un clic sobre la línea sigue editándola', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const linea = page.locator('.run').first();
  await linea.click();
  await expect(page.locator('.run.editing')).toHaveCount(1);
});
