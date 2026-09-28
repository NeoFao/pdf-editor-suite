import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

/**
 * `#btn-print` genera el PDF actual con `engine.save`, lo carga en un
 * `<iframe>` oculto vía blob: y llama a `iframe.contentWindow.print()` — el
 * visor PDF nativo del navegador imprime así el PDF VECTORIAL real, no un
 * "screenshot" del DOM (que solo pinta las páginas visibles).
 *
 * El Chromium que trae Playwright (a diferencia de Google Chrome) no incluye
 * el plugin del visor de PDF: comprobado con un script de diagnóstico antes
 * de escribir el primer test de este fichero, un `<iframe src="blob:...">`
 * con `type: 'application/pdf'` dispara una DESCARGA en vez de `load` — nunca
 * llegaría a llamarse `print()` y los tests no podrían depender de eso sin
 * ser frágiles según el navegador/las preferencias de PDF del usuario.
 *
 * Por eso `instalarStubIframe` sustituye, ANTES de que cargue cualquier
 * script de la app (`page.addInitScript`), el setter `src` de
 * `HTMLIFrameElement.prototype`: cuando la app asigna un `src` de tipo blob:
 * a un iframe, el stub dispara un `load` sintético y expone un
 * `contentWindow` capturable (`print`/`focus`/`addEventListener` de pega) —
 * así se comprueba el CONTRATO de `App.print()` (qué iframe, con qué blob,
 * llama a print; qué pasa si print() falla; cuándo se limpia) sin depender
 * de que el navegador de CI sepa renderizar PDFs incrustados.
 */
async function instalarStubIframe(page: Page, printLanza: boolean): Promise<void> {
  await page.addInitScript((printLanza: boolean) => {
    (window as unknown as { __printLlamadas: Array<{ src: string }> }).__printLlamadas = [];
    const proto = HTMLIFrameElement.prototype;
    const srcDesc = Object.getOwnPropertyDescriptor(proto, 'src')!;
    Object.defineProperty(proto, 'src', {
      configurable: true,
      get(this: HTMLIFrameElement) { return srcDesc.get!.call(this) as string; },
      set(this: HTMLIFrameElement, value: string) {
        srcDesc.set!.call(this, value);
        if (!value.startsWith('blob:')) return;
        Object.defineProperty(this, 'contentWindow', {
          configurable: true,
          get: () => ({
            focus: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            print: () => {
              if (printLanza) throw new Error('simulado: el navegador de prueba no puede imprimir');
              (window as unknown as { __printLlamadas: Array<{ src: string }> }).__printLlamadas.push({ src: value });
            }
          })
        });
        // El navegador real dispara `load` cuando el visor de PDF termina de
        // cargar el blob; aquí se simula ese momento (microtask, como el
        // `load` real es asíncrono respecto a la asignación de `src`).
        queueMicrotask(() => this.dispatchEvent(new Event('load')));
      }
    });
  }, printLanza);
}

test('imprimir: #btn-print carga el PDF vectorial en un iframe oculto y llama a print()', async ({ page }) => {
  await instalarStubIframe(page, false);

  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-print').click();

  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __printLlamadas: unknown[] }).__printLlamadas.length))
    .toBeGreaterThan(0);

  const llamada = await page.evaluate(() => (window as unknown as { __printLlamadas: Array<{ src: string }> }).__printLlamadas[0]!);
  expect(llamada.src).toMatch(/^blob:/);

  // El iframe cargó de verdad el PDF vectorial (no un blob vacío ni el DOM).
  const cabecera = await page.evaluate(async (url: string) => {
    const r = await fetch(url);
    const buf = new Uint8Array(await r.arrayBuffer());
    return new TextDecoder().decode(buf.slice(0, 5));
  }, llamada.src);
  expect(cabecera).toBe('%PDF-');
});

/**
 * Bug de revisión de PR #52: el camino de respaldo (`abrirEnPestana`) llamaba
 * a `limpiar()` —que revocaba la blob: URL— ANTES de `window.open(url)`. La
 * pestaña nueva recibía una URL ya muerta y no cargaba nada. Justo el camino
 * de la CSP (que no se puede probar de verdad en el Chromium de CI, ver
 * arriba) fallaría siempre. Aquí se fuerza el mismo camino de respaldo por la
 * otra puerta que SÍ es simulable: `contentWindow.print()` lanza.
 */
test('imprimir (respaldo): si contentWindow.print() falla, abre el PDF en pestaña nueva con una blob: URL que SIGUE siendo legible después', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __opens: string[] }).__opens = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __opens: string[] }).__opens.push(String(url ?? ''));
      return null;
    }) as typeof window.open;
  });
  await instalarStubIframe(page, true);

  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-print').click();

  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __opens: string[] }).__opens.length))
    .toBeGreaterThan(0);
  const url = await page.evaluate(() => (window as unknown as { __opens: string[] }).__opens[0]!);
  expect(url).toMatch(/^blob:/);

  // Se lee la URL DESPUÉS de la llamada a window.open: si el código la
  // revocó antes (el bug), fetch() ya no puede leerla.
  const cabecera = await page.evaluate(async (u: string) => {
    const r = await fetch(u);
    const buf = new Uint8Array(await r.arrayBuffer());
    return new TextDecoder().decode(buf.slice(0, 5));
  }, url);
  expect(cabecera).toBe('%PDF-');
});

/**
 * Bug de revisión de PR #52: `setTimeout(limpiar, 2000)` tras `print()`
 * quitaba el iframe (y revocaba la URL) a los 2s pase lo que pase. En un
 * navegador donde `print()` no bloquea hasta cerrar el diálogo, eso podía
 * vaciar la vista previa o cancelar la impresión a medio camino. Ahora el
 * iframe se retira con el evento `afterprint` (con un respaldo largo, no
 * probado aquí por no alargar el test); además, una impresión nueva limpia
 * cualquier intento anterior sin terminar en vez de acumular iframes.
 */
test('imprimir: el iframe no se limpia con un temporizador corto, se retira con afterprint, y una impresión nueva no acumula iframes', async ({ page }) => {
  await instalarStubIframe(page, false);

  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-print').click();
  await expect(page.locator('iframe.print-frame')).toHaveCount(1);

  // Más que el antiguo temporizador de 2s: el iframe debe SEGUIR ahí.
  await page.waitForTimeout(2500);
  await expect(page.locator('iframe.print-frame')).toHaveCount(1);

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('iframe.print-frame')).toHaveCount(0);

  // Una impresión nueva no acumula iframes de intentos previos sin terminar.
  await page.locator('#btn-print').click();
  await expect(page.locator('iframe.print-frame')).toHaveCount(1);
  await page.locator('#btn-print').click();
  await expect(page.locator('iframe.print-frame')).toHaveCount(1);
});
