import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

// T15 (E-055): el trabajo pesado de imagen de "Comprimir" (reescalar + codificar JPEG) corre en un Web Worker.
//
// Medición ESTRUCTURAL (nunca milisegundos, E-040): se envuelve `Worker.prototype.postMessage` y, para cada
// petición, se anota (a) cuántos frames de un `requestAnimationFrame` encadenado habían pasado al enviarla y
// al recibir su respuesta y (b) si una tarea de un MessageChannel encolada justo tras el envío llegó ANTES
// que la respuesta. Si el reescalado/codificación bloquease el hilo principal, no habría frames ni tareas
// intermedias. Se descartó la API Long Tasks porque el hilo principal SÍ ejecuta trabajo largo legítimo en
// esa operación (PDFium WASM decodificando los 5,6 Mpx de la imagen, que no se mueve al worker): contaría
// tareas largas ajenas a la codificación y haría el test dependiente de la máquina.

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.resolve(AQUI, '../../fixtures/generados/escaneado.pdf'); // una imagen de 2000×2800 px
const LINEA_ESCANEADO = 'Linea vectorial de referencia';

interface Traza { id: number; tipo: string; px: number; framesEnvio: number; framesRespuesta: number | null; pingAntes: boolean | null }
interface Diag { compresionWorker: number; compresionHiloPrincipal: number }

async function instalarSonda(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: number; __trazas: Traza[] };
    w.__frames = 0; w.__trazas = [];
    const tick = (): void => { w.__frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const vistos = new WeakSet<Worker>();
    const orig = Worker.prototype.postMessage as (this: Worker, ...a: unknown[]) => void;
    Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
      const m = args[0] as { id: number; tipo: string; width: number; height: number };
      const t: Traza = { id: m.id, tipo: m.tipo, px: m.width * m.height, framesEnvio: w.__frames, framesRespuesta: null, pingAntes: null };
      w.__trazas.push(t);
      if (!vistos.has(this)) {
        vistos.add(this);
        this.addEventListener('message', (e) => {
          const r = (e as MessageEvent<{ id: number }>).data;
          const mia = w.__trazas.find((x) => x.id === r.id && x.framesRespuesta === null);
          if (mia) { mia.framesRespuesta = w.__frames; mia.pingAntes ??= false; }
        });
      }
      const mc = new MessageChannel();
      mc.port1.onmessage = () => { t.pingAntes = t.framesRespuesta === null; mc.port1.close(); };
      mc.port2.postMessage(0);
      orig.apply(this, args);
    } as typeof Worker.prototype.postMessage;
  });
}

async function comprimirEscaneado(page: Page): Promise<{ status: string; bytes: Uint8Array }> {
  await page.goto('/index.next.html?diagnostico=1');
  await page.locator('#file-input').setInputFiles(PDF);
  await expect(page.locator('#status')).toHaveText('1 página(s)', { timeout: 60_000 });
  await abrirPestana(page, 'convertir');
  await page.locator('#btn-compress').click();
  await page.locator('#compress-dpi').selectOption('150');
  await page.locator('#btn-compress-run').click();
  await expect(page.locator('#status')).toContainText('Comprimido:', { timeout: 120_000 });
  const status = (await page.locator('#status').textContent()) ?? '';
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'comprimido.pdf');
  await download.saveAs(destino);
  return { status, bytes: new Uint8Array(fs.readFileSync(destino)) };
}

async function resumen(bytes: Uint8Array): Promise<{ imagenes: number; ancho: number; alto: number; texto: boolean; paginas: number }> {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(bytes);
  const imgs = eng.listImageObjects(doc, 0);
  const pix = eng.getImagePixels(doc, 0, imgs[0]!.objIndex)!;
  const texto = eng.getPageText(doc, 0).some((r) => r.text.includes(LINEA_ESCANEADO));
  const paginas = eng.pageCount(doc);
  eng.close(doc);
  return { imagenes: imgs.length, ancho: pix.width, alto: pix.height, texto, paginas };
}

const leerDiag = (page: Page): Promise<Diag> => page.evaluate(() => (window as unknown as { __diagnostico: Diag }).__diagnostico);

test('el reescalado y la codificación de la imagen grande ocurren en un worker mientras el hilo principal sigue vivo', async ({ page }) => {
  test.setTimeout(180_000);
  await instalarSonda(page);
  const { bytes } = await comprimirEscaneado(page);

  const trazas = await page.evaluate(() => (window as unknown as { __trazas: Traza[] }).__trazas);
  expect(trazas.map((t) => t.tipo)).toEqual(['reescalar', 'jpeg']); // las dos operaciones pesadas, ambas en el worker
  for (const t of trazas) {
    expect(t.framesRespuesta, `respuesta de ${t.tipo}`).not.toBeNull();
    // Una tarea encolada justo tras el envío se ejecutó antes de que el worker respondiera: el hilo no estaba ocupado.
    expect(t.pingAntes, `el hilo principal atendió tareas durante ${t.tipo}`).toBe(true);
  }
  // La más pesada (reescalar los 5,6 Mpx originales): el navegador llegó a pintar al menos un frame mientras tanto.
  const mayor = trazas.reduce((a, b) => (b.px > a.px ? b : a));
  expect(mayor.tipo).toBe('reescalar');
  expect(mayor.framesRespuesta! - mayor.framesEnvio).toBeGreaterThanOrEqual(1);

  const diag = await leerDiag(page);
  expect(diag.compresionWorker).toBe(2);
  expect(diag.compresionHiloPrincipal).toBe(0);

  // Mismo resultado que el camino de T9: una imagen, a 150 dpi, texto vectorial intacto y mucho más ligero.
  expect(bytes.length).toBeLessThanOrEqual(fs.statSync(PDF).size * 0.6);
  expect(await resumen(bytes)).toEqual({ imagenes: 1, ancho: 1000, alto: 1400, texto: true, paginas: 1 });
});

test('sin OffscreenCanvas se cae al camino del hilo principal y el resultado es equivalente', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => { (window as unknown as { OffscreenCanvas: undefined }).OffscreenCanvas = undefined; });
  const { bytes } = await comprimirEscaneado(page);
  const diag = await leerDiag(page);
  expect(diag.compresionWorker).toBe(0);
  expect(diag.compresionHiloPrincipal).toBe(2);
  expect(bytes.length).toBeLessThanOrEqual(fs.statSync(PDF).size * 0.6);
  expect(await resumen(bytes)).toEqual({ imagenes: 1, ancho: 1000, alto: 1400, texto: true, paginas: 1 });
});

test('si el worker no se puede crear, comprimir sigue funcionando en el hilo principal sin error visible', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    (window as unknown as { Worker: unknown }).Worker = class { constructor() { throw new Error('worker bloqueado'); } };
  });
  const { status, bytes } = await comprimirEscaneado(page);
  expect(status).not.toContain('Error');
  const diag = await leerDiag(page);
  expect(diag.compresionWorker).toBe(0);
  expect(diag.compresionHiloPrincipal).toBe(2);
  expect((await resumen(bytes)).ancho).toBe(1000);
});
