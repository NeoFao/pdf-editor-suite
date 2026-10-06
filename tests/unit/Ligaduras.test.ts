import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { EditarLineaCmd } from '../../src/commands/EditarLinea';
import { agruparLineasEditables } from '../../src/texto/lineasEditables';
import { fixture } from './_util/fixtures';

/**
 * E-088 (F5): editar una palabra cerca de las ligaduras «fi» de una fuente tipo Calibri/Chrome. `ligaduras.pdf` escribe la
 * ligadura como UN glifo (ToUnicode «fi») en su propio objeto; su avance NATURAL por caracteres (f + i = 15,84 pt) casi
 * dobla lo que ocupa (caja 7,92 pt). Antes, si la palabra editada acababa en espacio el objeto escrito se alargaba con el
 * siguiente, y ese objeto era la ligadura de la palabra de al lado: se reescribía como «f» + «i» sueltas y el sufijo se
 * movía con el avance natural. Un cambio del usuario solo puede alterar lo que el usuario tocó (AGENTS.md §2.3).
 */
async function editar(prefijo: string, de: string, a: string) {
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, fixture('ligaduras.pdf'));
  const lineas = () => agruparLineasEditables(s.ensureText(0), 0);
  const antes = lineas().find((l) => l.text.startsWith(prefijo))!;
  const cajas = (ids: number[]) => ids.map((id) => s.ensureText(0).find((r) => r.runId === id)!);
  const runsAntes = cajas(antes.runIds).map((r) => ({ texto: r.text, x: r.boxPt.xPt, w: r.boxPt.wPt }));
  const nuevo = antes.text.replace(de, a);
  const cmd = new EditarLineaCmd(0, antes, nuevo);
  await cmd.execute(s);
  expect(cmd.ok).toBe(true);
  expect(cmd.fontName).toBeNull(); // todos los glifos existen: se conserva la fuente original
  const despues = lineas().find((l) => l.text === nuevo)!;
  expect(despues).toBeDefined();
  const runsDespues = cajas(despues.runIds).map((r) => ({ texto: r.text, x: r.boxPt.xPt, w: r.boxPt.wPt, fuente: r.fontName }));
  return { runsAntes, runsDespues };
}

type R = { texto: string; x: number; w: number };
const solapes = (rs: R[]) => rs.filter((r, i) => i > 0 && rs[i - 1]!.x + rs[i - 1]!.w > r.x + 0.6).length;
const fin = (r: R) => r.x + r.w;

test('«una» → «aun»: la ligadura de «fino» ni se reescribe ni se mueve de más', async () => {
  const { runsAntes, runsDespues } = await editar('una ', 'una', 'aun');
  expect(runsDespues.filter((r) => r.texto === 'fi')).toHaveLength(2); // las dos ligaduras siguen siendo un objeto «fi»
  expect(runsDespues.filter((r) => r.texto === 'fi').every((r) => Math.abs(r.w - 7.92) < 0.1)).toBe(true); // misma caja
  expect(solapes(runsDespues)).toBe(0);
  // El hueco entre el final de la palabra editada y la ligadura que sigue se conserva (±1,5 pt: el borde de «n» y el de «a» difieren).
  const hueco = (rs: R[]) => rs.find((r) => r.texto === 'fi')!.x - fin(rs[0]!);
  expect(Math.abs(hueco(runsDespues) - hueco(runsAntes))).toBeLessThan(1.5);
});

test('«fino» → «nufo» (la palabra con la ligadura): el resto de la línea conserva su sitio relativo', async () => {
  const { runsAntes, runsDespues } = await editar('una ', 'fino', 'nufo');
  expect(runsDespues.filter((r) => r.texto === 'fi')).toHaveLength(1); // solo queda la ligadura de «fin»
  expect(solapes(runsDespues)).toBe(0);
  const ultimaFi = (rs: R[]) => rs.filter((r) => r.texto === 'fi').at(-1)!;
  const hueco = (rs: R[]) => ultimaFi(rs).x - fin(rs[rs.length - 3]!);
  expect(Math.abs(hueco(runsDespues) - hueco(runsAntes))).toBeLessThan(2);
});

test('«fin» → «nif» al final de la línea (ligadura + «n»): sin solapes', async () => {
  const { runsDespues } = await editar('una ', 'fin', 'nif');
  expect(solapes(runsDespues)).toBe(0);
  expect(runsDespues.filter((r) => r.texto === 'fi')).toHaveLength(1); // la de «fino»
});

test('la ligadura es el ÚLTIMO objeto cambiado: «fi» → «of» conserva el hueco con la «a» que sigue', async () => {
  const { runsAntes, runsDespues } = await editar('nu ', 'fia', 'ofa');
  expect(solapes(runsDespues)).toBe(0);
  const hueco = (rs: R[]) => rs[rs.length - 1]!.x - fin(rs[rs.length - 2]!);
  expect(Math.abs(hueco(runsDespues) - hueco(runsAntes))).toBeLessThan(1.5);
});
