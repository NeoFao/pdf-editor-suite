import { test, expect } from 'vitest';
import zlib from 'node:zlib';
import { abrirZip, DocxError } from '../../src/convert/docx/zip';
import { construirZip, construirEOCDConTotal } from './helpers/zipBuilder';

test('lee una entrada guardada sin comprimir (stored)', async () => {
  const zip = construirZip([{ nombre: 'word/document.xml', datos: new TextEncoder().encode('<a>hola</a>'), metodo: 0 }]);
  const archivo = abrirZip(zip);
  expect(archivo.nombres()).toEqual(['word/document.xml']);
  const datos = await archivo.leer('word/document.xml');
  expect(new TextDecoder().decode(datos!)).toBe('<a>hola</a>');
});

test('lee una entrada comprimida con deflate', async () => {
  const texto = 'Contenido de prueba '.repeat(50);
  const zip = construirZip([{ nombre: 'word/styles.xml', datos: new TextEncoder().encode(texto), metodo: 8 }]);
  const archivo = abrirZip(zip);
  const datos = await archivo.leer('word/styles.xml');
  expect(new TextDecoder().decode(datos!)).toBe(texto);
});

test('lee varias entradas mezclando stored y deflate', async () => {
  const zip = construirZip([
    { nombre: 'word/document.xml', datos: new TextEncoder().encode('AAA'), metodo: 0 },
    { nombre: 'word/numbering.xml', datos: new TextEncoder().encode('BBB'.repeat(30)), metodo: 8 },
    { nombre: '[Content_Types].xml', datos: new TextEncoder().encode('CCC'), metodo: 0 }
  ]);
  const archivo = abrirZip(zip);
  expect(archivo.nombres().sort()).toEqual(['[Content_Types].xml', 'word/document.xml', 'word/numbering.xml'].sort());
  expect(new TextDecoder().decode((await archivo.leer('word/document.xml'))!)).toBe('AAA');
  expect(new TextDecoder().decode((await archivo.leer('word/numbering.xml'))!)).toBe('BBB'.repeat(30));
});

test('leer() devuelve null para una entrada inexistente', async () => {
  const zip = construirZip([{ nombre: 'a.txt', datos: new TextEncoder().encode('x') }]);
  const archivo = abrirZip(zip);
  expect(await archivo.leer('no-existe.txt')).toBeNull();
});

test('rutas con .. se ignoran (no rompen la lectura del resto del ZIP)', async () => {
  const zip = construirZip([
    { nombre: '../../etc/passwd', datos: new TextEncoder().encode('malicioso') },
    { nombre: 'word/document.xml', datos: new TextEncoder().encode('bien') }
  ]);
  const archivo = abrirZip(zip);
  expect(archivo.nombres()).toEqual(['word/document.xml']);
  expect(await archivo.leer('../../etc/passwd')).toBeNull();
});

test('rutas absolutas se ignoran', async () => {
  const zip = construirZip([
    { nombre: '/etc/passwd', datos: new TextEncoder().encode('malicioso') },
    { nombre: 'C:/Windows/win.ini', datos: new TextEncoder().encode('malicioso') },
    { nombre: 'word/document.xml', datos: new TextEncoder().encode('bien') }
  ]);
  const archivo = abrirZip(zip);
  expect(archivo.nombres()).toEqual(['word/document.xml']);
});

test('un fichero que no es ZIP (sin EOCD) se rechaza con DocxError', () => {
  const basura = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(() => abrirZip(basura)).toThrow(DocxError);
});

test('demasiadas entradas en el directorio central se rechaza sin recorrerlo', () => {
  const eocdFalso = construirEOCDConTotal(10_001);
  expect(() => abrirZip(eocdFalso)).toThrow(DocxError);
  expect(() => abrirZip(eocdFalso)).toThrow(/demasiadas entradas/);
});

test('una entrada con ratio de compresión absurdo (zip bomb) se rechaza sin descomprimir', () => {
  // Tamaño declarado: 500 MB descomprimidos a partir de una entrada
  // comprimida de solo 2 KB -> ratio > 100:1. El payload real ni siquiera
  // hace falta que exista para que la detección dispare (se basa en los
  // tamaños DECLARADOS del directorio central).
  const zip = construirZip([{
    nombre: 'word/document.xml',
    datos: new Uint8Array(2048),
    metodo: 0,
    descomprimidoBytesFalso: 500 * 1024 * 1024
  }]);
  expect(() => abrirZip(zip)).toThrow(DocxError);
});

test('una zip bomb REAL (deflate de muchos ceros) también se rechaza', () => {
  // Payload real: 5 MB de ceros comprimen a un puñado de bytes con deflate.
  const ceros = new Uint8Array(5 * 1024 * 1024);
  const comprimido = zlib.deflateRawSync(Buffer.from(ceros));
  expect(comprimido.length).toBeLessThan(ceros.length / 100);
  const zip = construirZip([{ nombre: 'word/document.xml', datos: ceros, metodo: 8 }]);
  expect(() => abrirZip(zip)).toThrow(DocxError);
});

test('una entrada más grande que el límite por entrada se rechaza', () => {
  const zip = construirZip([{
    nombre: 'word/document.xml',
    datos: new Uint8Array(1024),
    // Comprimido "grande" para no disparar el ratio, solo el límite de tamaño.
    descomprimidoBytesFalso: 300 * 1024 * 1024
  }]);
  // Con datos.length=1024 comprimidos y 300MB declarados el ratio también
  // dispara; lo relevante es que en cualquier caso se rechaza.
  expect(() => abrirZip(zip)).toThrow(DocxError);
});

test('una entrada cifrada (flag bit 0) se rechaza con mensaje claro', () => {
  const zip = construirZip([{ nombre: 'word/document.xml', datos: new TextEncoder().encode('x'), flag: 0x1 }]);
  expect(() => abrirZip(zip)).toThrow(/cifrad/);
});

test('una entrada repartida en otro disco (multidisco) se rechaza', () => {
  const zip = construirZip([{ nombre: 'word/document.xml', datos: new TextEncoder().encode('x'), discoInicio: 1 }]);
  expect(() => abrirZip(zip)).toThrow(/disco/);
});

test('un método de compresión distinto de stored/deflate se rechaza', () => {
  const zip = construirZip([{ nombre: 'word/document.xml', datos: new TextEncoder().encode('x'), metodo: 0 }]);
  // Parchea el método a un valor no soportado (12 = bzip2) en ambas cabeceras.
  const view = new DataView(zip.buffer);
  view.setUint16(8, 12, true); // cabecera local, offset del método
  // La cabecera central empieza después de local(30)+nombre('word/document.xml'.length)+datos('x'.length).
  const offsetCentral = 30 + 'word/document.xml'.length + 1;
  view.setUint16(offsetCentral + 10, 12, true);
  expect(() => abrirZip(zip)).toThrow(/método de compresión/);
});
