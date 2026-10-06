import { test, expect, vi } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';

/**
 * Caché de texto por página y su invalidación (E-043/E-044,
 * docs/ERRORES-CONOCIDOS.md): abrir un documento NO debe leer el texto de
 * TODAS sus páginas (`engine.getPageText`) — solo cuando de verdad hace
 * falta (`ensureText`) — y un comando que toca UNA página
 * (`refreshPage`) no debe forzar releer las demás.
 *
 * Motor real (Node, sin DOM) — mismo patrón que el resto de
 * `tests/unit/PdfiumEngine.*.test.ts`. Asertamos sobre el TRABAJO realizado
 * (nº de llamadas espiadas con `vi.spyOn`), nunca sobre tiempo de reloj
 * (E-040, docs/TESTING.md).
 */
async function sesionDeNPaginas(n: number): Promise<EditSession> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) {
    const p = d.addPage([300, 200]);
    p.drawText(`Pagina ${i}`, { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  }
  const engine = await PdfiumEngine.create();
  return EditSession.open(engine, await d.save());
}

test('abrir un documento de N páginas NO llama a getPageText ni una sola vez', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 10; i++) d.addPage([300, 200]).drawText(`P${i}`, { x: 10, y: 100, size: 12, font: f });
  const engine = await PdfiumEngine.create();
  const spy = vi.spyOn(engine, 'getPageText');

  const s = await EditSession.open(engine, await d.save());

  expect(s.model.pages).toHaveLength(10);
  expect(spy).not.toHaveBeenCalled();
  // Las páginas existen con metadatos (tamaño/rotación) pero sin texto todavía.
  expect(s.model.pages[3]!.runs).toEqual([]);
  expect(s.hasLoadedText(3)).toBe(false);
});

test('ensureText carga y cachea: dos llamadas seguidas a la misma página piden el texto al motor UNA sola vez', async () => {
  const s = await sesionDeNPaginas(5);
  const spy = vi.spyOn(s.engine, 'getPageText');

  const primera = s.ensureText(2);
  const segunda = s.ensureText(2);

  expect(spy).toHaveBeenCalledTimes(1);
  expect(segunda).toBe(primera); // mismo array: sirvió el caché, no releyó
  expect(s.hasLoadedText(2)).toBe(true);
  expect(primera[0]!.text).toContain('Pagina 2');
});

test('ensureText de una página no toca las demás', async () => {
  const s = await sesionDeNPaginas(5);
  const spy = vi.spyOn(s.engine, 'getPageText');

  s.ensureText(0);

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith(s.doc, 0);
  expect(s.hasLoadedText(1)).toBe(false);
  expect(s.hasLoadedText(4)).toBe(false);
});

test('invalidateText olvida el caché de esa página: la siguiente ensureText vuelve a pedirlo al motor', async () => {
  const s = await sesionDeNPaginas(3);
  s.ensureText(1);
  s.invalidateText(1);
  const spy = vi.spyOn(s.engine, 'getPageText');

  s.ensureText(1);

  expect(spy).toHaveBeenCalledTimes(1);
  expect(s.hasLoadedText(1)).toBe(true);
});

test('refreshPage(i) recarga SOLO la página i y no toca el texto cacheado de otras páginas', async () => {
  const s = await sesionDeNPaginas(5);
  // Se "visitan" (cargan) las páginas 0 y 4 antes de tocar la 2.
  s.ensureText(0);
  s.ensureText(4);
  const spy = vi.spyOn(s.engine, 'getPageText');

  s.refreshPage(2);

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith(s.doc, 2);
  expect(s.hasLoadedText(2)).toBe(true);
  // Las que ya estaban cargadas siguen cargadas (no se releyeron ni se descartaron).
  expect(s.hasLoadedText(0)).toBe(true);
  expect(s.hasLoadedText(4)).toBe(true);
});

test('refreshPage notifica el cambio SOLO de esa página (Viewer/miniatura no deben repintar las demás)', async () => {
  const s = await sesionDeNPaginas(5);
  const notificadas: number[] = [];
  s.model.on('change', (i) => notificadas.push(i));
  const rebuilt: number[] = [];
  s.model.onPageRebuilt(() => rebuilt.push(1));

  s.refreshPage(3);

  expect(notificadas).toEqual([3]);
  expect(rebuilt).toEqual([1]);
});

test('refresh() (documento completo) limpia todo el caché de texto y vuelve a ser perezoso', async () => {
  const s = await sesionDeNPaginas(5);
  s.ensureText(0);
  s.ensureText(1);
  expect(s.hasLoadedText(0)).toBe(true);

  const spy = vi.spyOn(s.engine, 'getPageText');
  s.refresh();

  expect(spy).not.toHaveBeenCalled(); // refresh() sigue sin leer texto de nadie
  expect(s.hasLoadedText(0)).toBe(false);
  expect(s.hasLoadedText(1)).toBe(false);
  expect(s.model.pages[0]!.runs).toEqual([]);
});

test('reload() (deshacer un borrado/inserción) también limpia el caché de texto', async () => {
  const s = await sesionDeNPaginas(3);
  s.ensureText(0);
  const bytes = s.engine.save(s.doc);

  await s.reload(bytes);

  expect(s.hasLoadedText(0)).toBe(false);
  expect(s.model.pages[0]!.runs).toEqual([]);
});

test('ensureChars es perezoso, cachea por página y se invalida con refreshPage (T12)', async () => {
  const s = await sesionDeNPaginas(4);
  const spy = vi.spyOn(s.engine, 'getCharBoxes');
  expect(spy).not.toHaveBeenCalled(); // abrir el documento no pide caracteres

  const a = s.ensureChars(1);
  const b = s.ensureChars(1);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(b).toBe(a);
  expect(a.map((c) => c.ch).join('')).toContain('Pagina');

  s.ensureChars(2); // otra página: otra llamada, la 1 sigue cacheada
  expect(spy).toHaveBeenCalledTimes(2);

  s.refreshPage(1); // el texto de esa página pudo cambiar: se descarta SOLO su caché
  s.ensureChars(1);
  s.ensureChars(2);
  expect(spy).toHaveBeenCalledTimes(3);
});
