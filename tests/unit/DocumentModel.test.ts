import { test, expect } from 'vitest';
import { DocumentModel } from '../../src/model/DocumentModel';
import type { PageModel } from '../../src/model/types';

function modeloDe(): DocumentModel {
  const pages: PageModel[] = [
    { index: 0, sizePt: { widthPt: 320, heightPt: 200 }, rotation: 0, runs: [
      { runId: 0, text: 'hola', boxPt: { xPt: 40, yPt: 150, wPt: 30, hPt: 12 }, fontName: 'Times-Roman', sizePt: 18, color: [0,0,0,255], originPt: { xPt: 40, yPt: 150 } }
    ] }
  ];
  return new DocumentModel(pages);
}

test('updateRunText cambia el run y notifica con el pageIndex correcto', () => {
  const m = modeloDe();
  const notificadas: number[] = [];
  m.on('change', (pageIndex) => notificadas.push(pageIndex));
  m.updateRunText(0, 0, 'adios');
  expect(m.pages[0]!.runs[0]!.text).toBe('adios');
  expect(notificadas).toEqual([0]);
});

test('el desuscriptor detiene las notificaciones', () => {
  const m = modeloDe();
  let n = 0;
  const off = m.on('change', () => { n++; });
  m.updateRunText(0, 0, 'uno');
  off();
  m.updateRunText(0, 0, 'dos');
  expect(n).toBe(1);
});
