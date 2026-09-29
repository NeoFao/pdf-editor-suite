import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');
const FORMULARIO = path.resolve(AQUI, '../../fixtures/generados/formulario.pdf');

/**
 * Atajos de una letra (§6 del encargo de rediseño de interfaz — paridad con
 * E-017 de la app vieja): V/T/P/R/E/N pasan por `App.setTool()` (único punto
 * de verdad) y activan también la pestaña donde vive esa herramienta
 * (`activarPestana`), para que el botón recién resaltado sea visible sin un
 * clic adicional. `tests/unit/atajos.test.ts` ya cubre `resolverAtajo()` en
 * aislamiento (sin DOM); esto comprueba la INTEGRACIÓN real: que el botón
 * queda `aria-pressed="true"` Y la pestaña correcta queda activa.
 */

test('T con el foco en el documento activa Insertar texto (#btn-insert) y la pestaña Editar', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  // Empieza en otra pestaña a propósito: si T no activara también "Editar",
  // #btn-insert seguiría oculto (en otra `.context-bar`) y el clic de
  // comprobación fallaría por falta de visibilidad.
  await page.locator('#tab-organizar').click();
  await expect(page.locator('#tab-organizar')).toHaveAttribute('aria-selected', 'true');

  // Foco en el documento (el visor), no en ningún campo de formulario.
  await page.locator('.page').first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('t');

  await expect(page.locator('#btn-insert')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#tab-editar')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tab-organizar')).toHaveAttribute('aria-selected', 'false');
});

test('P con el foco en el documento activa Pluma (#btn-pen) y la pestaña Comentar', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  // "Editar" ya es la pestaña por defecto: la prueba de que P cambia de
  // pestaña de verdad está en que, tras pulsarla, #btn-pen (que solo vive en
  // la barra contextual de "Comentar") sea alcanzable y quede marcado.
  await expect(page.locator('#tab-editar')).toHaveAttribute('aria-selected', 'true');
  await page.locator('.page').first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('p');

  await expect(page.locator('#btn-pen')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#tab-comentar')).toHaveAttribute('aria-selected', 'true');
});

test('regla de oro: escribir "t" en un campo de un formulario del documento no cambia de herramienta', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FORMULARIO);

  const nombreInput = page.locator('.form-layer input[data-field-name="nombre"]');
  await expect(nombreInput).toBeVisible();
  await nombreInput.click();
  await page.keyboard.type('t');

  await expect(page.locator('#btn-insert')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#tab-editar')).toHaveAttribute('aria-selected', 'true'); // sigue en la pestaña por defecto, no la activó "Comentar" ni ninguna otra
  await expect(nombreInput).toHaveValue('t'); // la tecla SÍ llegó al campo, como texto normal
});

test('regla de oro: escribir "t" dentro de una .run en edición no cambia de herramienta (el carácter se escribe en la línea)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = page.locator('.run').first();
  await expect(run).toBeVisible();

  await run.click(); // entra en edición (contentEditable)
  await page.keyboard.press('End');
  await page.keyboard.type('t');

  await expect(page.locator('#btn-insert')).toHaveAttribute('aria-pressed', 'false');
  await expect(run).toContainText('t');
});
