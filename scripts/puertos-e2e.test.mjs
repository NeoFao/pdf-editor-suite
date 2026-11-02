/**
 * Tests de los puertos E2E con desplazamiento opcional E2E_PUERTO_BASE (E-113).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calcularPuertosE2E, leerDesplazamiento, urlLocal, DESPLAZAMIENTO_MAXIMO } from './puertos-e2e.mjs';

describe('calcularPuertosE2E', () => {
  test('sin variable devuelve EXACTAMENTE los puertos de siempre (CI no cambia)', () => {
    assert.deepEqual({ ...calcularPuertosE2E({}) }, { appVieja: 3100, appNueva: 4173, despliegue: 4174 });
    assert.deepEqual({ ...calcularPuertosE2E({ E2E_PUERTO_BASE: '' }) }, { appVieja: 3100, appNueva: 4173, despliegue: 4174 });
  });

  test('con base desplaza los tres puertos de forma coherente', () => {
    assert.deepEqual({ ...calcularPuertosE2E({ E2E_PUERTO_BASE: '10000' }) }, { appVieja: 13100, appNueva: 14173, despliegue: 14174 });
    assert.deepEqual({ ...calcularPuertosE2E({ E2E_PUERTO_BASE: '20000' }) }, { appVieja: 23100, appNueva: 24173, despliegue: 24174 });
  });

  test('dos worktrees con bases separadas no colisionan', () => {
    const a = Object.values(calcularPuertosE2E({ E2E_PUERTO_BASE: '10000' }));
    const b = Object.values(calcularPuertosE2E({ E2E_PUERTO_BASE: '20000' }));
    assert.equal(new Set([...a, ...b]).size, 6);
  });

  test('base inválida lanza un error claro', () => {
    for (const mala of ['abc', '-5', '1.5', '0', '1e4', '0x10', String(DESPLAZAMIENTO_MAXIMO + 1), '70000', '99999999999999999999']) {
      assert.throws(() => calcularPuertosE2E({ E2E_PUERTO_BASE: mala }), /E2E_PUERTO_BASE/, mala);
    }
  });

  test('el desplazamiento máximo mantiene todos los puertos <= 65535', () => {
    const p = calcularPuertosE2E({ E2E_PUERTO_BASE: String(DESPLAZAMIENTO_MAXIMO) });
    assert.equal(Math.max(...Object.values(p)), 65535);
  });
});

describe('leerDesplazamiento y urlLocal', () => {
  test('ausente o vacío es 0', () => {
    assert.equal(leerDesplazamiento(undefined), 0);
    assert.equal(leerDesplazamiento('  '), 0);
  });
  test('urlLocal compone la URL con el puerto de la clave', () => {
    assert.equal(urlLocal('appNueva', { appNueva: 24173 }), 'http://127.0.0.1:24173');
  });
});
