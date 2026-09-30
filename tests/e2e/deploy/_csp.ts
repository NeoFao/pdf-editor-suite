import type { Page } from '@playwright/test';

/**
 * Sonda de violaciones de CSP para los tests de `tests/e2e/deploy/`.
 *
 * Dos fuentes independientes, porque ninguna cubre el 100% de los casos:
 * - El evento `securitypolicyviolation` (DOM), que dispara para casi todo
 *   bloqueo de CSP salvo algunos casos de red antiguos.
 * - `page.on('console')`, porque Chromium también imprime "Refused to ..."
 *   en consola para bloqueos que a veces no llegan a disparar el evento
 *   (p. ej. algunas variantes de `worker-src`/`connect-src` en versiones
 *   viejas de Chromium) — doble red, igual que pide la spec de esta tarea.
 *
 * `addInitScript` se reinstala en cada navegación de `page` (nuevo realm de
 * JS), así que el acumulador `window.__violacionesCSP` siempre empieza vacío
 * en el documento que se está probando.
 */
export interface ViolacionCSP {
  violatedDirective: string;
  blockedURI: string;
}

export interface SondaCSP {
  /** Mensajes de consola que mencionan la CSP (bloqueo), en el orden en que llegaron. */
  mensajesConsola: string[];
  /** Violaciones acumuladas por el evento securitypolicyviolation del documento actual. */
  violaciones(): Promise<ViolacionCSP[]>;
}

export async function instalarSondaCSP(page: Page): Promise<SondaCSP> {
  const mensajesConsola: string[] = [];
  page.on('console', (msg) => {
    if (/content security policy|refused to/i.test(msg.text())) mensajesConsola.push(msg.text());
  });

  await page.addInitScript(() => {
    (window as unknown as { __violacionesCSP: ViolacionCSPGlobal[] }).__violacionesCSP = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __violacionesCSP: ViolacionCSPGlobal[] }).__violacionesCSP.push({
        violatedDirective: e.violatedDirective,
        blockedURI: e.blockedURI
      });
    });
  });

  return {
    mensajesConsola,
    violaciones: () =>
      page.evaluate(() => (window as unknown as { __violacionesCSP: ViolacionCSP[] }).__violacionesCSP ?? [])
  };
}

// Solo para tipar el callback de addInitScript (se serializa a texto, no se importa en runtime).
interface ViolacionCSPGlobal {
  violatedDirective: string;
  blockedURI: string;
}

/** Lee la cabecera Content-Security-Policy real que el servidor manda para `ruta`. */
export async function leerCSP(page: Page, ruta: string, baseURL: string | undefined): Promise<string> {
  const respuesta = await page.request.get(new URL(ruta, baseURL).toString());
  return respuesta.headers()['content-security-policy'] ?? '';
}

/**
 * Stub de `HTMLIFrameElement.prototype.src`, adaptado de
 * `tests/e2e/next/imprimir.spec.ts`: simula que el visor de PDF del
 * navegador cargó el blob: y expone un `contentWindow.print()` capturable —
 * necesario porque el Chromium de Playwright no trae el plugin de PDF (un
 * iframe con `src` blob: dispara una descarga, no `load`).
 *
 * A diferencia del original, aquí el `set` real de `src` SIGUE ejecutándose
 * (`srcDesc.set!.call(this, value)`): la navegación real del iframe al
 * blob: SÍ ocurre, así que la CSP real del servidor (`frame-src`) se aplica
 * de verdad y puede disparar `securitypolicyviolation` — que es justo lo
 * que este fichero de tests quiere observar. El stub solo evita depender de
 * que el Chromium de CI sepa renderizar el PDF para simular `load`/`print()`.
 */
export async function instalarStubIframeImpresion(page: Page): Promise<void> {
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
            addEventListener: () => {},
            removeEventListener: () => {},
            print: () => {
              (window as unknown as { __printLlamadas: Array<{ src: string }> }).__printLlamadas.push({ src: value });
            }
          })
        });
        queueMicrotask(() => this.dispatchEvent(new Event('load')));
      }
    });
  });
}
