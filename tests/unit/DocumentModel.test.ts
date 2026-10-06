import { test, expect } from 'vitest';
import { DocumentModel } from '../../src/model/DocumentModel';
import type { PageModel } from '../../src/model/types';
import { crearTextRun } from './_util/textRun';

function modeloDe(): DocumentModel {
  const pages: PageModel[] = [
    { index: 0, sizePt: { widthPt: 320, heightPt: 200 }, rotation: 0, runs: [
      crearTextRun({ text: 'hola', xPt: 40, yPt: 150, sizePt: 18, wPt: 30, fontName: 'Times-Roman' })
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
