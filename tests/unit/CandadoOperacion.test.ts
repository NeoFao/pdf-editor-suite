import { describe, it, expect } from 'vitest';
import { CommandBus, type Command, type Ctx } from '../../src/commands/Command';

/** E-087: el candado de operación en curso del bus (sin motor: los comandos son de mentira). */
function cmd(log: string[], nombre: string): Command {
  return { id: nombre, label: nombre, execute: () => { log.push(`+${nombre}`); }, undo: () => { log.push(`-${nombre}`); } };
}

describe('CommandBus: candado de operación en curso (E-087)', () => {
  it('con el candado puesto, execute/undo/redo ajenos no actúan y avisan; el dueño sí ejecuta', async () => {
    const log: string[] = [];
    const bus = new CommandBus({} as Ctx);
    const avisos: string[] = [];
    bus.onBloqueado = (op) => avisos.push(op);
    await bus.execute(cmd(log, 'a'));
    const liberar = bus.bloquear('Reemplazar todo')!;
    expect(bus.bloquear('otra')).toBeNull(); // una sola operación larga a la vez
    await bus.execute(cmd(log, 'ajeno'));
    expect(await bus.undo()).toBeNull();
    expect(await bus.redo()).toBeNull();
    await bus.execute(cmd(log, 'propio'), true);
    expect(log).toEqual(['+a', '+propio']);
    expect(avisos).toEqual(['Reemplazar todo', 'Reemplazar todo', 'Reemplazar todo']);
    liberar();
    expect(bus.operacionEnCurso()).toBeNull();
    expect(await bus.undo()).toBe('propio'); // liberado: vuelve a actuar
  });
});
