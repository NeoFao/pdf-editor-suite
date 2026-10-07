import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana, escribirNota } from './_ayudas';

// Ronda 2 de accesibilidad (E-097). La auditoría fue ESTÁTICA: cada defecto se comprueba aquí en Chromium
// real (árbol de accesibilidad vía CDP, foco, estilos calculados). Los que NO eran defecto quedan como
// tests de regresión del comportamiento correcto para que la próxima auditoría no los repita.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MARCADORES = path.resolve(AQUI, '../../fixtures/generados/marcadores.pdf'); // 3 páginas, outline 2 niveles
const FUENTES = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

interface NodoAX { role?: { value: string }; name?: { value: string }; properties?: { name: string; value: { value: unknown } }[] }

/** Propiedades del árbol de accesibilidad de Chromium para el elemento que casa con el selector. */
async function propsAX(page: Page, selector: string): Promise<Record<string, unknown>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  const { nodes } = (await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })) as { nodes: NodoAX[] };
  const n = nodes[0]!;
  const out: Record<string, unknown> = { role: n.role?.value, name: n.name?.value };
  for (const p of n.properties ?? []) out[p.name] = p.value.value;
  await cdp.detach();
  return out;
}

async function abrirConNotas(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(MARCADORES);
  await expect(page.locator('.run').first()).toBeVisible();
  for (const [i, t] of [[0, 'Primera nota'], [2, 'Tercera nota']] as const) {
    await page.locator('#tab-pages').click();
    await page.locator('#thumbs canvas').nth(i).click();
    await expect(page.locator('#page-indicator')).toHaveText(`${i + 1} / 3`);
    await abrirPestana(page, 'comentar');
    await page.locator('#btn-note').click();
    await page.locator('.page').nth(i).click({ position: { x: 400, y: 600 } });
    await escribirNota(page, t);
  }
  await page.locator('#tab-comments').click();
}

// B-01 (FALSO POSITIVO): role="status" ya implica aria-live="polite"; el árbol de Chromium lo confirma.
test('B-01: #comentarios-estado (role=status) es región viva cortés sin aria-live explícito', async ({ page }) => {
  await abrirConNotas(page);
  const p = await propsAX(page, '.comentarios-estado');
  expect(p['role']).toBe('status');
  expect(p['live']).toBe('polite');
  await expect(page.locator('.comentarios-estado')).toHaveText('2 comentario(s)');
});

// B-02 (PARCIAL): CDP no expone posinset/setsize, pero el navegador los deriva de la estructura; se fijan explícitos (deterministas con ramas plegadas). Nivel sí se ve en el árbol AX.
test('B-02: los treeitem de marcadores exponen nivel, posición y tamaño del conjunto', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(MARCADORES);
  await expect(page.locator('.run').first()).toBeVisible();
  await page.locator('#tab-outline').click();
  const cap2 = '[role="treeitem"][aria-label^="Capítulo 2"]';
  await expect(page.locator(cap2)).toBeVisible();
  await expect(page.locator(cap2)).toHaveAttribute('aria-posinset', '2');
  await expect(page.locator(cap2)).toHaveAttribute('aria-setsize', '2');
  const p = await propsAX(page, cap2);
  expect(p['level']).toBe(1);
});

// B-03 (PARCIAL): el diálogo ya era modal nativo (showModal); lo que faltaba era devolver el foco.
test('B-03: el diálogo de atajos es modal, atrapa Tab y devuelve el foco al disparador al cerrar', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#btn-shortcuts').focus();
  await page.keyboard.press('Enter');
  const dialogo = page.getByRole('dialog', { name: 'Atajos de teclado' });
  await expect(dialogo).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialogo).toHaveCount(0);
  await expect(page.locator('#btn-shortcuts')).toBeFocused();
});

// B-04: el estado «sucio» tenía solo un «•» visual.
test('B-04: el estado sin guardar tiene nombre accesible y se anuncia UNA vez al pasar a sucio', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();
  const nombre = page.locator('.doc-name');
  await expect(nombre).not.toContainText('Documento con cambios sin guardar');
  await page.evaluate(() => {
    const w = window as unknown as { __anuncios: number };
    w.__anuncios = 0;
    const region = document.getElementById('sucio-aviso');
    if (!region) return;
    new MutationObserver((m) => { for (const r of m) if (r.target.textContent) w.__anuncios++; })
      .observe(region, { childList: true, characterData: true, subtree: true });
  });

  for (const texto of ['CAMBIO UNO', 'CAMBIO DOS', 'CAMBIO TRES']) {
    await page.locator('.run').first().click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(texto);
    await page.keyboard.press('Enter');
    await expect(page.locator('.run', { hasText: texto })).toBeVisible();
  }
  await expect(nombre).toContainText('•');
  // El punto es decorativo (oculto a la AT) y hay un texto solo-lector con el estado.
  await expect(nombre.locator('[aria-hidden="true"]')).toHaveText(/•/);
  await expect(nombre.locator('.sr-only')).toHaveText(/Documento con cambios sin guardar/);
  await expect(page.locator('#sucio-aviso')).toHaveAttribute('role', 'status');
  await expect(page.locator('#sucio-aviso')).toHaveText('Documento con cambios sin guardar.');
  expect(await page.evaluate(() => (window as unknown as { __anuncios: number }).__anuncios)).toBe(1);
});

// B-05
test('B-05: con prefers-reduced-motion las transiciones se anulan', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();
  const dur = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.run-drag')!).transitionDuration));
  expect(dur).toBeLessThan(0.001);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const normal = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.run-drag')!).transitionDuration));
  expect(normal).toBeGreaterThan(0.05);
});

// B-06 (FALSO POSITIVO): Chromium usa el placeholder como nombre accesible del searchbox.
test('B-06: el buscador ya tiene nombre accesible (del placeholder)', async ({ page }) => {
  await page.goto('/index.next.html');
  expect((await propsAX(page, '#btn-search'))['name']).toMatch(/Buscar/);
  await expect(page.getByRole('searchbox', { name: /Buscar/ })).toBeVisible();
});

// B-08 (FALSO POSITIVO): cada fila es un <button> con aria-label descriptivo; al recibir el foco con las flechas
// el lector lo lee sin necesitar una región viva adicional.
test('B-08: con las flechas el foco llega a un botón con nombre descriptivo (tipo, página, texto)', async ({ page }) => {
  await abrirConNotas(page);
  const items = page.locator('.comentario-item');
  await items.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  const p = await propsAX(page, '.comentario-item:focus');
  expect(p['role']).toBe('button');
  expect(String(p['name'])).toMatch(/Nota en la página 3.*Tercera nota/);
});

// B-09 (FALSO POSITIVO): la selección por teclado ya se anuncia en #status (aria-live).
test('B-09: Mayús+flecha sobre una línea anuncia lo seleccionado en #status', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();
  await page.locator('.run').first().focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('#status')).toHaveText(/^Seleccionado: «.+»$/);
});
