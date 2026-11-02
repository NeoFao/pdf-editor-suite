import { test, expect } from 'vitest';
import { dominioDe, decidirEnlaceExterno } from '../../src/ui/enlaceExterno';

// E-116: enlaces externos (/URI) del PDF. La decisión de qué hacer con una URL es lógica pura.

test('dominioDe: host de http(s) y dominio de la dirección en mailto', () => {
  expect(dominioDe('https://Ejemplo.TEST:8443/ruta?x=1')).toBe('ejemplo.test');
  expect(dominioDe('mailto:ana@correo.example?subject=hola')).toBe('correo.example');
  expect(dominioDe('javascript:alert(1)')).toBe('');
});

test('decidirEnlaceExterno: http, https y mailto piden confirmación por defecto', () => {
  for (const u of ['https://a.test/x', 'http://a.test/', 'mailto:a@b.test']) {
    expect(decidirEnlaceExterno(u, new Set()).accion).toBe('confirmar');
  }
});

test('decidirEnlaceExterno: esquemas no permitidos quedan bloqueados, también si el dominio estaba omitido', () => {
  for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<b>x</b>', 'vbscript:x', 'ftp://a.test/', 'pagina.html', '']) {
    expect(decidirEnlaceExterno(u, new Set(['a.test', ''])).accion).toBe('bloqueado');
  }
});

test('decidirEnlaceExterno: un dominio omitido en la sesión se abre sin preguntar; otro dominio sigue preguntando', () => {
  const omitidos = new Set(['a.test']);
  expect(decidirEnlaceExterno('https://a.test/otra', omitidos).accion).toBe('abrir');
  expect(decidirEnlaceExterno('https://b.test/otra', omitidos).accion).toBe('confirmar');
  // Subdominio engañoso: no coincide con el dominio omitido.
  expect(decidirEnlaceExterno('https://a.test.malo.example/', omitidos).accion).toBe('confirmar');
});
