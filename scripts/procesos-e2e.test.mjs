/**
 * Tests de la clasificación de procesos huérfanos (E-062), con datos falsos.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  clasificarProceso, seleccionarHuerfanos, pidsProtegidos,
  parsearProcesosWindows, parsearProcesosUnix
} from './procesos-e2e.mjs';
import { PUERTOS_E2E, LISTA_PUERTOS_E2E } from './puertos-e2e.mjs';

const RAIZ = 'C:\\Users\\andre\\Documents\\BIBLIOTECA APPS\\PDF Editor';

describe('clasificarProceso', () => {
  test('node con la ruta del repo en su línea de comandos es del repo', () => {
    const cmd = `"C:\\Program Files\\nodejs\\node.exe" "${RAIZ}\\scripts\\servir-despliegue.mjs"`;
    assert.equal(clasificarProceso({ pid: 1, nombre: 'node.exe', cmd }, RAIZ), 'repo');
  });

  test('compara sin distinguir barras ni mayúsculas', () => {
    const cmd = 'node c:/users/ANDRE/documents/biblioteca apps/pdf editor/node_modules/vite/bin/vite.js preview';
    assert.equal(clasificarProceso({ pid: 1, nombre: 'node', cmd }, RAIZ), 'repo');
  });

  test('node de OTRO proyecto es ajeno', () => {
    const cmd = 'node C:\\Users\\andre\\Documents\\OTRO PROYECTO\\server.js';
    assert.equal(clasificarProceso({ pid: 1, nombre: 'node.exe', cmd }, RAIZ), 'ajeno');
  });

  test('una carpeta hermana con prefijo común es ajena', () => {
    const cmd = `node ${RAIZ} 2\\server.js`;
    assert.equal(clasificarProceso({ pid: 1, nombre: 'node.exe', cmd }, RAIZ), 'ajeno');
    assert.equal(clasificarProceso({ pid: 1, nombre: 'node.exe', cmd: `node ${RAIZ}Editorial\\x.js` }, RAIZ), 'ajeno');
  });

  test('un proceso que no es node/vite/vitest/chrome nunca se cierra, aunque cite el repo', () => {
    for (const nombre of ['code.exe', 'explorer.exe', 'powershell.exe', 'git.exe']) {
      assert.equal(clasificarProceso({ pid: 1, nombre, cmd: `${nombre} ${RAIZ}` }, RAIZ), 'ajeno', nombre);
    }
  });

  test('chrome-headless-shell, vite y vitest del repo se reconocen', () => {
    for (const nombre of ['chrome-headless-shell.exe', 'chrome', 'vite', 'vitest.exe']) {
      assert.equal(clasificarProceso({ pid: 1, nombre, cmd: `${nombre} --x="${RAIZ}\\tests"` }, RAIZ), 'repo', nombre);
    }
  });

  test('sin nombre o sin línea de comandos es desconocido (no se cierra)', () => {
    assert.equal(clasificarProceso({ pid: 1, nombre: 'node.exe', cmd: null }, RAIZ), 'desconocido');
    assert.equal(clasificarProceso({ pid: 1, nombre: null, cmd: RAIZ }, RAIZ), 'desconocido');
  });
});

describe('seleccionarHuerfanos', () => {
  const procesos = [
    { pid: 10, ppid: 1, nombre: 'node.exe', cmd: `node ${RAIZ}\\server.js` },
    { pid: 11, ppid: 10, nombre: 'chrome-headless-shell.exe', cmd: `chrome-headless-shell --x ${RAIZ}\\t` },
    { pid: 12, ppid: 1, nombre: 'node.exe', cmd: 'node C:\\otro\\app.js' },
    { pid: 13, ppid: 1, nombre: 'node.exe', cmd: null },
    { pid: 14, ppid: 1, nombre: 'explorer.exe', cmd: 'explorer' },
    { pid: 20, ppid: 21, nombre: 'node.exe', cmd: `node ${RAIZ}\\scripts\\liberar-puertos.mjs` },
    { pid: 21, ppid: 22, nombre: 'node.exe', cmd: `node npm-cli.js run e2e:liberar --prefix ${RAIZ}` },
    { pid: 0, ppid: 0, nombre: 'node.exe', cmd: RAIZ },
    { pid: -5, ppid: 0, nombre: 'node.exe', cmd: RAIZ }
  ];

  test('cierra solo los del repo, avisa del que no se puede leer y respeta al propio script y sus ancestros', () => {
    const protegidos = pidsProtegidos(procesos, 20);
    assert.deepEqual([...protegidos].sort(), [20, 21, 22]);
    const { cerrar, desconocidos } = seleccionarHuerfanos(procesos, RAIZ, protegidos);
    assert.deepEqual(cerrar.map((p) => p.pid), [10, 11]);
    assert.deepEqual(desconocidos.map((p) => p.pid), [13]);
  });
});

describe('parsers de la lista de procesos', () => {
  test('Windows: array JSON y objeto único', () => {
    const uno = parsearProcesosWindows('{"ProcessId":5,"ParentProcessId":2,"Name":"node.exe","CommandLine":null}');
    assert.deepEqual(uno, [{ pid: 5, ppid: 2, nombre: 'node.exe', cmd: null }]);
    assert.equal(parsearProcesosWindows('[{"ProcessId":1},{"ProcessId":2}]').length, 2);
    assert.deepEqual(parsearProcesosWindows('basura'), []);
  });

  test('Unix: pid, ppid y nombre = primer token sin directorio', () => {
    const r = parsearProcesosUnix('  42     1 /usr/bin/node /repo/server.js\n  7 1 [kworker]\n\nbasura\n');
    assert.deepEqual(r[0], { pid: 42, ppid: 1, nombre: 'node', cmd: '/usr/bin/node /repo/server.js' });
    assert.equal(r.length, 2);
  });
});

describe('puertos-e2e', () => {
  test('incluye la app vieja, la nueva y el despliegue, sin repetidos', () => {
    assert.deepEqual([...LISTA_PUERTOS_E2E].sort(), [3100, 4173, 4174]);
    assert.equal(PUERTOS_E2E.despliegue, 4174);
  });
});
