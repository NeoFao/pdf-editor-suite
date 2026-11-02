import { test, expect } from 'vitest';
import { construirModeloDocx, esParrafo, type Parrafo } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';
import { textosAdvertencias } from '../../src/convert/advertencia';

/** Flotantes de Word (`wp:anchor`): lectura del ajuste y de la capa (modelo) y su salida al maquetar. `medir` falso: 5 pt por carácter. */
const medir = (_f: string, _s: number, t: string): number => t.length * 5;
const RELS = '<Relationships><Relationship Id="rId1" Type="x/image" Target="media/image1.png"/></Relationships>';
const anchor = (attrs: string, wrap: string, h = 'margin|<wp:align>right</wp:align>', v = 'paragraph|<wp:posOffset>0</wp:posOffset>') =>
  `<w:drawing><wp:anchor ${attrs}><wp:positionH relativeFrom="${h.split('|')[0]}">${h.split('|')[1]}</wp:positionH><wp:positionV relativeFrom="${v.split('|')[0]}">${v.split('|')[1]}</wp:positionV><wp:extent cx="1270000" cy="635000"/>${wrap}<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
const modeloDe = (dibujo: string) => construirModeloDocx(`<w:document><w:body><w:p><w:r>${dibujo}<w:t>x</w:t></w:r></w:p></w:body></w:document>`, null, null, RELS);
const flot = (m: ReturnType<typeof construirModeloDocx>) => {
  const p = m.bloques.filter(esParrafo)[0] as Parrafo;
  const i = p.partes.find((x) => x.tipo === 'imagen');
  return i && i.tipo === 'imagen' ? i.flotante : undefined;
};

test('wrapNone con behindDoc="1": capa "detras", sin aviso (Word lo dibuja igual)', () => {
  const m = modeloDe(anchor('behindDoc="1"', '<wp:wrapNone/>'));
  expect(flot(m)?.capa).toBe('detras');
  expect(textosAdvertencias(m.advertencias)).toEqual([]);
});

test('wrapNone con behindDoc="0": capa "delante" (delante del texto), sin aviso', () => {
  const m = modeloDe(anchor('behindDoc="0"', '<wp:wrapNone/>'));
  expect(flot(m)?.capa).toBe('delante');
  expect(textosAdvertencias(m.advertencias)).toEqual([]);
});

test('wrapSquare y wrapTopAndBottom no llevan capa; wrapTight/wrapThrough = square con aviso "aproximado"', () => {
  expect(flot(modeloDe(anchor('behindDoc="0"', '<wp:wrapSquare wrapText="bothSides"/>')))?.capa).toBeUndefined();
  expect(flot(modeloDe(anchor('behindDoc="0"', '<wp:wrapTopAndBottom/>')))?.capa).toBeUndefined();
  const m = modeloDe(anchor('behindDoc="0"', '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"/></wp:wrapTight>'));
  expect(flot(m)?.ajuste?.modo).toBe('square');
  expect(textosAdvertencias(m.advertencias).join(' | ')).toMatch(/aproxim/i);
});

test('sin ningún elemento de ajuste sigue avisando (no se sabe cómo la quiere el documento)', () => {
  const m = modeloDe(anchor('behindDoc="0"', ''));
  expect(textosAdvertencias(m.advertencias).join(' | ')).toMatch(/imagen flotante/i);
});

test('al maquetar, la capa llega a la imagen colocada', () => {
  const m = modeloDe(anchor('behindDoc="1"', '<wp:wrapNone/>', 'page|<wp:posOffset>254000</wp:posOffset>', 'page|<wp:posOffset>254000</wp:posOffset>'));
  const res = renderizarModeloDocx(m, medir);
  expect(res.imagenes).toHaveLength(1);
  expect(res.imagenes[0]!.capa).toBe('detras');
  expect([res.imagenes[0]!.xPt, res.imagenes[0]!.wPt, res.imagenes[0]!.hPt]).toEqual([20, 100, 50]);
});
