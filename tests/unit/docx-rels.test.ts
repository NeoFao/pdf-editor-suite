import { test, expect } from 'vitest';
import { leerRelaciones, rutaMediaDesdeWord } from '../../src/convert/docx/rels';

const RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type=".../image" Target="media/image1.png"/>
  <Relationship Id="rId2" Type=".../hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>`;

test('lee Id/Target/TargetMode de cada relación', () => {
  const map = leerRelaciones(RELS_XML);
  expect(map.get('rId1')).toEqual({ target: 'media/image1.png', targetMode: null });
  expect(map.get('rId2')).toEqual({ target: 'https://example.com', targetMode: 'External' });
  expect(map.get('rId9')).toBeUndefined();
});

test('rutaMediaDesdeWord resuelve una ruta relativa a word/', () => {
  expect(rutaMediaDesdeWord('media/image1.png')).toBe('word/media/image1.png');
  expect(rutaMediaDesdeWord('/word/media/image1.png')).toBe('word/media/image1.png');
});
