import { test, expect } from 'vitest';
import { resolverAtajo, resolverAtajoContextual, esCampoEditable, TABLA_ATAJOS } from '../../src/ui/atajos';

/** Construye un evento normalizado con los campos por defecto en `false`/vacíos. */
function ev(over: Partial<Parameters<typeof resolverAtajo>[0]>) {
  return { key: '', ctrl: false, meta: false, shift: false, alt: false, editable: false, ...over };
}

test('Ctrl+Z (Windows/Linux) resuelve a deshacer', () => {
  expect(resolverAtajo(ev({ key: 'z', ctrl: true }))?.accion).toBe('deshacer');
});

test('Cmd+Z (macOS, metaKey) resuelve a deshacer', () => {
  expect(resolverAtajo(ev({ key: 'z', meta: true }))?.accion).toBe('deshacer');
});

test('Ctrl+Y resuelve a rehacer', () => {
  expect(resolverAtajo(ev({ key: 'y', ctrl: true }))?.accion).toBe('rehacer');
});

test('Ctrl+Shift+Z resuelve a rehacer (alternativa a Ctrl+Y)', () => {
  expect(resolverAtajo(ev({ key: 'Z', ctrl: true, shift: true }))?.accion).toBe('rehacer');
});

test('Cmd+Shift+Z (macOS) resuelve a rehacer', () => {
  expect(resolverAtajo(ev({ key: 'z', meta: true, shift: true }))?.accion).toBe('rehacer');
});

test('Ctrl+Z con Mayús NO es deshacer (evita colisión con rehacer)', () => {
  expect(resolverAtajo(ev({ key: 'z', ctrl: true, shift: true }))?.accion).toBe('rehacer');
});

test('Ctrl+S resuelve a guardar', () => {
  expect(resolverAtajo(ev({ key: 's', ctrl: true }))?.accion).toBe('guardar');
});

test('Ctrl+O resuelve a abrir', () => {
  expect(resolverAtajo(ev({ key: 'o', ctrl: true }))?.accion).toBe('abrir');
});

test('Ctrl+P resuelve a imprimir', () => {
  expect(resolverAtajo(ev({ key: 'p', ctrl: true }))?.accion).toBe('imprimir');
});

test('Ctrl+F resuelve a buscar', () => {
  expect(resolverAtajo(ev({ key: 'f', ctrl: true }))?.accion).toBe('buscar');
});

test('Ctrl+"+" resuelve a zoom-in', () => {
  expect(resolverAtajo(ev({ key: '+', ctrl: true }))?.accion).toBe('zoom-in');
});

test('Ctrl+"=" (mismo físico sin Mayús) también resuelve a zoom-in', () => {
  expect(resolverAtajo(ev({ key: '=', ctrl: true }))?.accion).toBe('zoom-in');
});

test('Ctrl+"-" resuelve a zoom-out', () => {
  expect(resolverAtajo(ev({ key: '-', ctrl: true }))?.accion).toBe('zoom-out');
});

test('Ctrl+0 resuelve a zoom-ajustar (ajustar al ancho)', () => {
  expect(resolverAtajo(ev({ key: '0', ctrl: true }))?.accion).toBe('zoom-ajustar');
});

test('Inicio (sin campo editable) resuelve a primera-pagina', () => {
  expect(resolverAtajo(ev({ key: 'Home' }))?.accion).toBe('primera-pagina');
});

test('Fin (sin campo editable) resuelve a ultima-pagina', () => {
  expect(resolverAtajo(ev({ key: 'End' }))?.accion).toBe('ultima-pagina');
});

test('RePág (sin campo editable) resuelve a pagina-anterior', () => {
  expect(resolverAtajo(ev({ key: 'PageUp' }))?.accion).toBe('pagina-anterior');
});

test('AvPág (sin campo editable) resuelve a pagina-siguiente', () => {
  expect(resolverAtajo(ev({ key: 'PageDown' }))?.accion).toBe('pagina-siguiente');
});

test('Escape (sin campo editable) resuelve a escape', () => {
  expect(resolverAtajo(ev({ key: 'Escape' }))?.accion).toBe('escape');
});

test('Supr (sin campo editable) resuelve a suprimir', () => {
  expect(resolverAtajo(ev({ key: 'Delete' }))?.accion).toBe('suprimir');
  expect(resolverAtajo(ev({ key: 'Backspace' }))?.accion).toBe('suprimir');
});

test('"?" (sin campo editable) resuelve a ayuda', () => {
  expect(resolverAtajo(ev({ key: '?' }))?.accion).toBe('ayuda');
});

test('regla de oro: AvPág con el foco en un campo editable no dispara nada', () => {
  expect(resolverAtajo(ev({ key: 'PageDown', editable: true }))).toBeNull();
});

test('regla de oro: Inicio con el foco en un campo editable no dispara nada', () => {
  expect(resolverAtajo(ev({ key: 'Home', editable: true }))).toBeNull();
});

test('regla de oro: "?" con el foco en un campo editable no dispara nada (para poder escribir el carácter)', () => {
  expect(resolverAtajo(ev({ key: '?', editable: true }))).toBeNull();
});

test('regla de oro: Escape con el foco en un campo editable no dispara la acción global', () => {
  expect(resolverAtajo(ev({ key: 'Escape', editable: true }))).toBeNull();
});

test('regla de oro: Supr con el foco en un campo editable no dispara nada (deja borrar el carácter)', () => {
  expect(resolverAtajo(ev({ key: 'Delete', editable: true }))).toBeNull();
});

test('regla de oro: Ctrl+Z con el foco en un campo editable deja actuar al navegador (deshacer nativo del input)', () => {
  expect(resolverAtajo(ev({ key: 'z', ctrl: true, editable: true }))).toBeNull();
});

test('regla de oro: Ctrl+Y con el foco en un campo editable deja actuar al navegador', () => {
  expect(resolverAtajo(ev({ key: 'y', ctrl: true, editable: true }))).toBeNull();
});

test('Ctrl+S SÍ dispara aunque el foco esté en un campo editable (evita el diálogo de guardar del navegador)', () => {
  expect(resolverAtajo(ev({ key: 's', ctrl: true, editable: true }))?.accion).toBe('guardar');
});

test('Ctrl+F SÍ dispara aunque el foco esté en un campo editable', () => {
  expect(resolverAtajo(ev({ key: 'f', ctrl: true, editable: true }))?.accion).toBe('buscar');
});

test('Ctrl/Cmd+H resuelve "reemplazar" y SÍ dispara con el foco en un campo editable', () => {
  expect(resolverAtajo(ev({ key: 'h', ctrl: true }))?.accion).toBe('reemplazar');
  expect(resolverAtajo(ev({ key: 'H', meta: true }))?.accion).toBe('reemplazar');
  expect(resolverAtajo(ev({ key: 'h', ctrl: true, editable: true }))?.accion).toBe('reemplazar');
});

test('la tecla h sola (sin Ctrl/Cmd) no resuelve nada', () => {
  expect(resolverAtajo(ev({ key: 'h' }))).toBeNull();
});

test('una tecla suelta sin ninguna combinación reconocida no resuelve nada', () => {
  expect(resolverAtajo(ev({ key: 'a' }))).toBeNull();
});

test('la tabla declarativa tiene una entrada por acción, sin duplicados', () => {
  const acciones = TABLA_ATAJOS.map((d) => d.accion);
  expect(new Set(acciones).size).toBe(acciones.length);
});

test('esCampoEditable: un <input> es editable', () => {
  const input = { tagName: 'INPUT', isContentEditable: false } as unknown as HTMLElement;
  expect(esCampoEditable(input)).toBe(true);
});

test('esCampoEditable: un <textarea> es editable', () => {
  const el = { tagName: 'TEXTAREA', isContentEditable: false } as unknown as HTMLElement;
  expect(esCampoEditable(el)).toBe(true);
});

test('esCampoEditable: un <select> es editable', () => {
  const el = { tagName: 'SELECT', isContentEditable: false } as unknown as HTMLElement;
  expect(esCampoEditable(el)).toBe(true);
});

test('esCampoEditable: un elemento contentEditable (p. ej. una .run en edición) es editable', () => {
  const el = { tagName: 'DIV', isContentEditable: true } as unknown as HTMLElement;
  expect(esCampoEditable(el)).toBe(true);
});

test('esCampoEditable: un <button> no es editable', () => {
  const el = { tagName: 'BUTTON', isContentEditable: false } as unknown as HTMLElement;
  expect(esCampoEditable(el)).toBe(false);
});

test('esCampoEditable: null no es editable', () => {
  expect(esCampoEditable(null)).toBe(false);
});

/**
 * Atajos de una letra (§6 del rediseño de interfaz — paridad con E-017 de la
 * app vieja, ver js/app.js: V/P/T/E/R; N es nuevo aquí). Bloqueados en campos
 * editables, igual que Home/Fin/RePág/AvPág/Supr/Escape/"?" — un solo
 * carácter no debe robarle la tecla a un formulario.
 */
test('V (sin campo editable) resuelve a tool-none (herramienta Seleccionar)', () => {
  expect(resolverAtajo(ev({ key: 'v' }))?.accion).toBe('tool-none');
  expect(resolverAtajo(ev({ key: 'V' }))?.accion).toBe('tool-none');
});

test('T (sin campo editable) resuelve a tool-insert (Insertar texto)', () => {
  expect(resolverAtajo(ev({ key: 't' }))?.accion).toBe('tool-insert');
});

test('P (sin campo editable) resuelve a tool-pen (Pluma)', () => {
  expect(resolverAtajo(ev({ key: 'p' }))?.accion).toBe('tool-pen');
});

test('R (sin campo editable) resuelve a tool-rect (Rectángulo)', () => {
  expect(resolverAtajo(ev({ key: 'r' }))?.accion).toBe('tool-rect');
});

test('E (sin campo editable) resuelve a tool-eraser (Borrador)', () => {
  expect(resolverAtajo(ev({ key: 'e' }))?.accion).toBe('tool-eraser');
});

test('N (sin campo editable) resuelve a tool-note (Nota)', () => {
  expect(resolverAtajo(ev({ key: 'n' }))?.accion).toBe('tool-note');
});

test('regla de oro: escribir "t"/"p"/"v" en un campo editable no cambia de herramienta', () => {
  expect(resolverAtajo(ev({ key: 't', editable: true }))).toBeNull();
  expect(resolverAtajo(ev({ key: 'p', editable: true }))).toBeNull();
  expect(resolverAtajo(ev({ key: 'v', editable: true }))).toBeNull();
  expect(resolverAtajo(ev({ key: 'r', editable: true }))).toBeNull();
  expect(resolverAtajo(ev({ key: 'e', editable: true }))).toBeNull();
  expect(resolverAtajo(ev({ key: 'n', editable: true }))).toBeNull();
});

test('Ctrl+P sigue resolviendo a imprimir, no a la herramienta Pluma (P sin modificador)', () => {
  expect(resolverAtajo(ev({ key: 'p', ctrl: true }))?.accion).toBe('imprimir');
});

// T16: paridad de teclado para lo que antes exigía ratón (WCAG 2.1.1).
test('Mayús+→ / Mayús+← resuelven a ampliar o reducir la selección por carácter', () => {
  expect(resolverAtajo(ev({ key: 'ArrowRight', shift: true }))?.accion).toBe('seleccion-caracter');
  expect(resolverAtajo(ev({ key: 'ArrowLeft', shift: true }))?.accion).toBe('seleccion-caracter');
});

test('Mayús+↓ / Mayús+↑ resuelven a ampliar o reducir la selección por línea', () => {
  expect(resolverAtajo(ev({ key: 'ArrowDown', shift: true }))?.accion).toBe('seleccion-linea');
  expect(resolverAtajo(ev({ key: 'ArrowUp', shift: true }))?.accion).toBe('seleccion-linea');
});

test('Alt+↓ / Alt+↑ recorren las anotaciones de la página', () => {
  expect(resolverAtajo(ev({ key: 'ArrowDown', alt: true }))?.accion).toBe('anotacion-recorrer');
  expect(resolverAtajo(ev({ key: 'ArrowUp', alt: true }))?.accion).toBe('anotacion-recorrer');
});

test('las flechas sin modificador, con Ctrl o con Mayús+Alt no disparan nada (ni chocan con otros atajos)', () => {
  expect(resolverAtajo(ev({ key: 'ArrowDown' }))).toBeNull();
  expect(resolverAtajo(ev({ key: 'ArrowDown', ctrl: true, shift: true }))).toBeNull();
  expect(resolverAtajo(ev({ key: 'ArrowDown', alt: true, shift: true }))).toBeNull();
  expect(resolverAtajo(ev({ key: 'ArrowRight', alt: true }))).toBeNull(); // Alt+→ es "adelante" del navegador
});

test('con el foco en un campo editable, las flechas con modificador no se interceptan', () => {
  expect(resolverAtajo(ev({ key: 'ArrowRight', shift: true, editable: true }))).toBeNull();
  expect(resolverAtajo(ev({ key: 'ArrowDown', alt: true, editable: true }))).toBeNull();
});

test('F3 y Mayús+F3 resuelven a siguiente/anterior coincidencia, también con el foco en un campo editable', () => {
  expect(resolverAtajo(ev({ key: 'F3' }))?.accion).toBe('busqueda-siguiente');
  expect(resolverAtajo(ev({ key: 'F3', editable: true }))?.accion).toBe('busqueda-siguiente');
  expect(resolverAtajo(ev({ key: 'F3', shift: true }))?.accion).toBe('busqueda-anterior');
  expect(resolverAtajo(ev({ key: 'F3', shift: true, editable: true }))?.accion).toBe('busqueda-anterior');
  expect(resolverAtajo(ev({ key: 'F3', ctrl: true }))).toBeNull();
});

test('E-073: Enter y las flechas son atajos contextuales: resolverAtajo los ignora y no pisa Mayús+flechas de la selección', () => {
  expect(resolverAtajo(ev({ key: 'Enter' }))).toBeNull();
  expect(resolverAtajoContextual(ev({ key: 'Enter' }))?.accion).toBe('herramienta-colocar');
  expect(resolverAtajoContextual(ev({ key: 'ArrowLeft', shift: true }))?.accion).toBe('herramienta-mover');
  expect(resolverAtajo(ev({ key: 'ArrowLeft', shift: true }))?.accion).toBe('seleccion-caracter');
  expect(resolverAtajoContextual(ev({ key: 'Enter', editable: true }))).toBeNull();
  expect(resolverAtajoContextual(ev({ key: 'Enter', ctrl: true }))).toBeNull();
});

// N4 (E-075): con un diálogo modal abierto, los atajos globales no actúan sobre el documento de detrás.
test('con un modal abierto ningún atajo global se resuelve (Ctrl+Z, n, End, ?)', () => {
  for (const e of [
    ev({ key: 'z', ctrl: true }),
    ev({ key: 'y', ctrl: true }),
    ev({ key: 'n' }),
    ev({ key: 't' }),
    ev({ key: 'r' }),
    ev({ key: 'End' }),
    ev({ key: '?', shift: true })
  ]) {
    expect(resolverAtajo(e)?.accion, `${e.key} sin modal`).toBeTruthy();
    expect(resolverAtajo({ ...e, modalAbierto: true }), `${e.key} con modal`).toBeNull();
  }
});

test('con un modal abierto tampoco se resuelven los atajos contextuales (Enter de Nota/Rectángulo)', () => {
  const enter = ev({ key: 'Enter' });
  expect(resolverAtajoContextual(enter)).not.toBeNull();
  expect(resolverAtajoContextual({ ...enter, modalAbierto: true })).toBeNull();
});

test('Enter con un marcado seleccionado: atajo contextual marcado-comentar, solo si se pide, y aparece en la tabla de ayuda', () => {
  const enter = ev({ key: 'Enter' });
  expect(resolverAtajoContextual(enter, ['marcado-comentar'])?.accion).toBe('marcado-comentar');
  expect(resolverAtajoContextual(enter)?.accion).toBe('herramienta-colocar'); // Nota/Rectángulo mandan sin filtro
  expect(resolverAtajoContextual(ev({ key: 'Enter', shift: true }), ['marcado-comentar'])).toBeNull();
  expect(resolverAtajoContextual(ev({ key: 'Enter', editable: true }), ['marcado-comentar'])).toBeNull();
  expect(resolverAtajo(enter)).toBeNull();
  expect(TABLA_ATAJOS.some((d) => d.accion === 'marcado-comentar' && /doble clic/i.test(d.combinacion))).toBe(true);
});
