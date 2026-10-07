import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { AddMarkupCmd } from '../../src/commands/AddMarkup';
import { SetNoteTextCmd } from '../../src/commands/SetNoteText';
import { rectToQuad } from '../../src/coords/quads';
import { PageGeometry } from '../../src/coords/PageGeometry';
import { quadsDeRango } from '../../src/texto/seleccionTexto';
import { textoMarcadoDeAnotacion } from '../../src/texto/textoMarcado';

// Panel Comentarios: el texto que cubre un marcado se saca de la página con sus QuadPoints. Unidades: pt de usuario PDF.
async function sesion(rotar = 0) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 200]);
  p.drawText('PRIMERA LINEA', { x: 40, y: 150, size: 14, font: f });
  p.drawText('SEGUNDA LINEA', { x: 40, y: 120, size: 14, font: f });
  p.drawText('TERCERA', { x: 40, y: 90, size: 14, font: f });
  if (rotar) p.setRotation(degrees(rotar));
  const s = await EditSession.open(await PdfiumEngine.create(), await d.save());
  return { s, bus: new CommandBus(s) };
}

test('el texto de un marcado de 2 líneas sale de sus QuadPoints, sin la tercera línea', async () => {
  const { s, bus } = await sesion();
  const quads = [rectToQuad({ xPt: 38, yPt: 146, wPt: 200, hPt: 18 }), rectToQuad({ xPt: 38, yPt: 116, wPt: 200, hPt: 18 })];
  await bus.execute(new AddMarkupCmd(0, 'highlight', quads, [250, 204, 21]));
  const c = s.engine.getComments(s.doc, 0)[0]!;
  expect(textoMarcadoDeAnotacion(s, 0, c)).toBe('PRIMERA LINEA SEGUNDA LINEA');
});

test('en una página con /Rotate 90 el texto marcado es el mismo (quads calculados con la geometría girada)', async () => {
  const { s, bus } = await sesion(90);
  const chars = s.ensureChars(0);
  const geo = PageGeometry.desdeTamanoVisual(200, 300, 1, 90); // visual: ancho 200, alto 300
  const ini = chars.findIndex((c) => c.ch === 'S'), fin = ini + 6; // «SEGUNDA»
  const quads = quadsDeRango(chars, ini, fin, geo);
  await bus.execute(new AddMarkupCmd(0, 'highlight', quads, [250, 204, 21]));
  const c = s.engine.getComments(s.doc, 0)[0]!;
  expect(textoMarcadoDeAnotacion(s, 0, c)).toBe('SEGUNDA');
});

test('un marcado sin texto debajo devuelve cadena vacía', async () => {
  const { s, bus } = await sesion();
  await bus.execute(new AddMarkupCmd(0, 'underline', [rectToQuad({ xPt: 200, yPt: 10, wPt: 50, hPt: 10 })], [255, 0, 0]));
  expect(textoMarcadoDeAnotacion(s, 0, s.engine.getComments(s.doc, 0)[0]!)).toBe('');
});

test('/Contents de un marcado: SetNoteTextCmd lo escribe, deshacer lo quita y persiste tras guardar y reabrir', async () => {
  const { s, bus } = await sesion();
  await bus.execute(new AddMarkupCmd(0, 'highlight', [rectToQuad({ xPt: 38, yPt: 146, wPt: 200, hPt: 18 })], [250, 204, 21]));
  const idx = s.engine.getComments(s.doc, 0)[0]!.index;
  await bus.execute(new SetNoteTextCmd(0, idx, 'revisar\nesto ñ'));
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(s.engine.save(s.doc)));
  const c = eng.getComments(doc, 0);
  expect(c).toHaveLength(1);
  expect(c[0]!.kind).toBe('highlight');
  expect(c[0]!.text).toBe('revisar\nesto ñ');
  eng.close(doc);
  await bus.undo();
  expect(s.engine.getComments(s.doc, 0)[0]!.text).toBe('');
});
