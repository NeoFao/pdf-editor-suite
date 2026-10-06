import { test, expect } from 'vitest';
import { IteradorCoincidencias } from '../../src/texto/iteradorCoincidencias';

const r = (n: number) => ({ xPt: n, yPt: n, wPt: 1, hPt: 1 });

test('vacío: siguiente y anterior no devuelven nada', () => {
  const it = new IteradorCoincidencias();
  expect(it.siguiente()).toBeNull();
  expect(it.anterior()).toBeNull();
  expect(it.total).toBe(0);
  expect(it.posicion).toBe(0);
});

test('siguiente recorre en orden de página y orden de lectura', () => {
  const it = new IteradorCoincidencias();
  it.añadir(0, [r(1), r(2)]);
  it.añadir(3, [r(3)]);
  expect(it.total).toBe(3);
  expect(it.siguiente()).toMatchObject({ pageIndex: 0, rect: r(1), vuelta: false });
  expect(it.posicion).toBe(1);
  expect(it.siguiente()).toMatchObject({ pageIndex: 0, rect: r(2) });
  expect(it.siguiente()).toMatchObject({ pageIndex: 3, rect: r(3) });
});

test('con la búsqueda terminada, siguiente tras la última vuelve al principio y lo avisa', () => {
  const it = new IteradorCoincidencias();
  it.añadir(0, [r(1)]);
  it.añadir(1, [r(2)]);
  it.terminar();
  it.siguiente(); it.siguiente();
  const v = it.siguiente();
  expect(v).toMatchObject({ pageIndex: 0, vuelta: true });
  expect(it.posicion).toBe(1);
});

test('anterior desde la primera (o sin actual) va a la última, con aviso de vuelta', () => {
  const it = new IteradorCoincidencias();
  it.añadir(0, [r(1)]);
  it.añadir(1, [r(2)]);
  it.terminar();
  expect(it.anterior()).toMatchObject({ pageIndex: 1, vuelta: true });
  expect(it.anterior()).toMatchObject({ pageIndex: 0, vuelta: false });
  expect(it.anterior()).toMatchObject({ pageIndex: 1, vuelta: true });
});

test('mientras se busca, siguiente en la última no da la vuelta (aún pueden llegar más)', () => {
  const it = new IteradorCoincidencias();
  it.añadir(0, [r(1)]);
  expect(it.siguiente()).toMatchObject({ pageIndex: 0 });
  expect(it.siguiente()).toBeNull();
  expect(it.posicion).toBe(1);
  it.añadir(5, [r(9)]);
  expect(it.siguiente()).toMatchObject({ pageIndex: 5, vuelta: false });
});

test('añadir resultados mientras se navega no mueve la posición actual', () => {
  const it = new IteradorCoincidencias();
  it.añadir(0, [r(1), r(2)]);
  it.siguiente(); it.siguiente();
  expect(it.posicion).toBe(2);
  it.añadir(7, [r(3), r(4)]);
  expect(it.posicion).toBe(2);
  expect(it.total).toBe(4);
  expect(it.actual()).toMatchObject({ pageIndex: 0, rect: r(2) });
});

test('añadir una lista vacía no cambia nada; terminar es idempotente', () => {
  const it = new IteradorCoincidencias();
  it.añadir(2, []);
  expect(it.total).toBe(0);
  it.terminar(); it.terminar();
  expect(it.terminada).toBe(true);
});

test('un solo resultado con la búsqueda terminada: siguiente repite el mismo con aviso de vuelta', () => {
  const it = new IteradorCoincidencias();
  it.añadir(4, [r(1)]);
  it.terminar();
  expect(it.siguiente()).toMatchObject({ vuelta: false });
  expect(it.siguiente()).toMatchObject({ pageIndex: 4, vuelta: true });
});
