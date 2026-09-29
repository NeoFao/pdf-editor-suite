import { test, expect } from 'vitest';
import { parseXml, hijosElemento, primerHijo, textoDirecto } from '../../src/convert/docx/xml';
import { DocxError } from '../../src/convert/docx/DocxError';

test('parsea un elemento simple con atributos y texto', () => {
  const raiz = parseXml('<w:p w:val="1"><w:r><w:t>Hola</w:t></w:r></w:p>');
  expect(raiz.nombre).toBe('w:p');
  expect(raiz.atributos['w:val']).toBe('1');
  const r = primerHijo(raiz, 'w:r')!;
  const t = primerHijo(r, 'w:t')!;
  expect(textoDirecto(t)).toBe('Hola');
});

test('ignora el prólogo <?xml ...?> y los comentarios antes de la raíz', () => {
  const raiz = parseXml('<?xml version="1.0" encoding="UTF-8"?><!-- c --><root>ok</root>');
  expect(raiz.nombre).toBe('root');
  expect(textoDirecto(raiz)).toBe('ok');
});

test('etiquetas autocerradas producen un elemento sin hijos', () => {
  const raiz = parseXml('<w:p><w:br/><w:t>x</w:t></w:p>');
  const hijos = raiz.hijos.filter((h) => h.tipo === 'elemento');
  expect(hijos).toHaveLength(2);
  expect((hijos[0] as { nombre: string }).nombre).toBe('w:br');
});

test('hijosElemento devuelve todos los hijos directos con ese nombre, en orden', () => {
  const raiz = parseXml('<w:p><w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r></w:p>');
  const runs = hijosElemento(raiz, 'w:r');
  expect(runs).toHaveLength(2);
  expect(textoDirecto(primerHijo(runs[0]!, 'w:t')!)).toBe('a');
  expect(textoDirecto(primerHijo(runs[1]!, 'w:t')!)).toBe('b');
});

test('decodifica las 5 entidades predefinidas y referencias numéricas', () => {
  const raiz = parseXml('<a>&amp; &lt; &gt; &quot; &apos; &#65; &#x41;</a>');
  expect(textoDirecto(raiz)).toBe('& < > " \' A A');
});

test('decodifica entidades dentro de un valor de atributo', () => {
  const raiz = parseXml('<a titulo="Ñandú &amp; C&#237;a"/>');
  expect(raiz.atributos.titulo).toBe('Ñandú & Cía');
});

test('CDATA se conserva literal, sin interpretar su contenido', () => {
  const raiz = parseXml('<a><![CDATA[<raw> & cosas]]></a>');
  expect(textoDirecto(raiz)).toBe('<raw> & cosas');
});

test('los comentarios dentro del árbol se ignoran', () => {
  const raiz = parseXml('<a>uno<!-- comentario -->dos</a>');
  expect(textoDirecto(raiz)).toBe('unodos');
});

test('espacios de nombres: conserva el prefijo tal cual (w:, a:, r:)', () => {
  const raiz = parseXml('<w:p xmlns:w="uri"><a:blip r:embed="rId1"/></w:p>');
  const blip = primerHijo(raiz, 'a:blip')!;
  expect(blip.atributos['r:embed']).toBe('rId1');
});

// --- Entrada hostil ---

test('rechaza un DOCTYPE (previene XXE) sin intentar interpretarlo', () => {
  expect(() => parseXml('<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><a>&xxe;</a>'))
    .toThrow(DocxError);
});

test('rechaza "billion laughs" (DOCTYPE con entidades anidadas) sin expandir nada', () => {
  const entidades = Array.from({ length: 9 }, (_v, i) => `<!ENTITY lol${i + 1} "${'&lol' + i + ';'.repeat(1)}">`).join('');
  const hostil = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">${entidades}]><lolz>&lol9;</lolz>`;
  expect(() => parseXml(hostil)).toThrow(DocxError);
});

test('rechaza una entidad no reconocida (sin DOCTYPE, no hay entidad propia válida)', () => {
  expect(() => parseXml('<a>&noExiste;</a>')).toThrow(DocxError);
});

test('rechaza un anidamiento de 100 000 elementos sin colgarse ni desbordar la pila', () => {
  const profundidad = 100_000;
  const hostil = '<a>'.repeat(profundidad) + 'x' + '</a>'.repeat(profundidad);
  expect(() => parseXml(hostil)).toThrow(DocxError);
  expect(() => parseXml(hostil)).toThrow(/profund/);
});

test('rechaza una etiqueta de cierre que no coincide', () => {
  expect(() => parseXml('<a><b></c></a>')).toThrow(DocxError);
});

test('rechaza una etiqueta sin cerrar', () => {
  expect(() => parseXml('<a><b>texto')).toThrow(DocxError);
});

test('rechaza un documento vacío o sin elemento raíz', () => {
  expect(() => parseXml('   ')).toThrow(DocxError);
});

test('rechaza un valor de atributo sin comillas', () => {
  expect(() => parseXml('<a b=1/>')).toThrow(DocxError);
});
