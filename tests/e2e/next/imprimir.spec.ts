import { test, expect } from '@playwright/test';
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
 * de escribir este test, un `<iframe src="blob:...">` con
 * `type: 'application/pdf'` dispara una DESCARGA en vez de `load` — nunca
 * llegaría a llamarse `print()` y el test no podría depender de eso sin ser
 * frágil según el navegador/las preferencias de PDF del usuario.
 *
 * Por eso el test sustituye, ANTES de que cargue cualquier script de la app
 * (`page.addInitScript`), el setter `src` y el getter `contentWindow` de
 * `HTMLIFrameElement.prototype`: cuando la app asigna un `src` de tipo
 * blob: a un iframe, el test dispara un `load` sintético y expone un
 * `contentWindow.print()` capturable — así se comprueba el CONTRATO de la
 * app (qué iframe, con qué blob, llama a print) sin depender de que el
 * navegador de CI sepa renderizar PDFs incrustados.
 */
test('imprimir: #btn-print carga el PDF vectorial en un iframe oculto y llama a print()', async ({ page }) => {
  await page.addInitScript(() => {
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
            print: () => {
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
  });

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
