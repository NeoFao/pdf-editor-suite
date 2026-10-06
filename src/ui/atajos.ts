/**
 * Atajos de teclado (#34 de la tabla de paridad, §9) — un único sitio
 * declarativo, en vez de un `if`/`else` disperso por `App.ts` (así era antes
 * de este PR: solo Ctrl/Cmd+Z y Ctrl/Cmd+Y en el constructor de `App`).
 *
 * `resolverAtajo()` es una función PURA: toma un evento ya normalizado (no un
 * `KeyboardEvent` del DOM) y devuelve la definición que coincide, o `null`.
 * Así se puede testear en Node sin levantar un navegador — el DOM real solo
 * hace falta para construir el evento normalizado (`App.ts`) y para ejecutar
 * la acción resuelta.
 *
 * Regla de oro (AGENTS.md, encargo de este PR): ningún atajo de una sola
 * tecla ni de navegación se dispara con el foco en un campo editable
 * (`input`/`textarea`/`select`/`[contenteditable]`, incluida una `.run` en
 * edición — que es `contentEditable` mientras dura la edición, ver
 * `TextLayer.ts`). Deshacer/rehacer respetan la misma regla, a propósito:
 * dentro de un campo de formulario, Ctrl+Z debe deshacer TEXTO escrito ahí,
 * no la última acción del documento — se deja actuar al navegador. El resto
 * de combinaciones con Ctrl/Cmd (guardar/abrir/imprimir/buscar/zoom) no
 * tienen ningún significado de edición de texto nativo del navegador dentro
 * de un campo — si no se interceptaran, dispararían el diálogo nativo
 * correspondiente (guardar página, abrir archivo del SO, imprimir, buscar en
 * la página) en vez de la acción de la app, así que se disparan siempre.
 */

/** Evento normalizado que consume `resolverAtajo`. Todos los campos booleanos explícitos, sin `undefined`. */
export interface EventoAtajo {
  /** `KeyboardEvent.key` tal cual lo entrega el navegador (p. ej. 'z', 'Z', 'Home', 'PageDown', '?'). */
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  /** true si `document.activeElement`/`event.target` es un campo editable (ver `esCampoEditable`). */
  editable: boolean;
}

export type AccionAtajo =
  | 'deshacer'
  | 'rehacer'
  | 'guardar'
  | 'abrir'
  | 'imprimir'
  | 'buscar'
  | 'busqueda-siguiente'
  | 'busqueda-anterior'
  | 'reemplazar'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-ajustar'
  | 'primera-pagina'
  | 'ultima-pagina'
  | 'pagina-anterior'
  | 'pagina-siguiente'
  | 'suprimir'
  | 'seleccion-caracter'
  | 'seleccion-linea'
  | 'anotacion-recorrer'
  | 'escape'
  | 'ayuda'
  | 'tool-none'
  | 'tool-insert'
  | 'tool-pen'
  | 'tool-rect'
  | 'tool-eraser'
  | 'tool-note'
  | 'herramienta-colocar'
  | 'herramienta-mover';

export interface DefinicionAtajo {
  /** Texto para el panel de ayuda (`AtajosPanel`), no usado por `resolverAtajo`. */
  combinacion: string;
  accion: AccionAtajo;
  descripcion: string;
  /** true: no se dispara si `evento.editable` — ver la regla de oro de arriba. */
  bloqueaEnEditable: boolean;
  coincide: (e: EventoAtajo) => boolean;
  /**
   * true: depende de la herramienta activa (Nota/Rectángulo), que `atajos.ts` no conoce. `resolverAtajo` la
   * ignora (no choca con p. ej. Mayús+flechas de la selección de texto); `resolverAtajoContextual` solo mira estas,
   * y `App` decide si aplica según la herramienta y el foco (E-073).
   */
  contextual?: boolean;
}

/** `KeyboardEvent.key` en minúsculas: normaliza 'Z'/'z' y deja 'Home'/'PageDown'/'Escape'/etc. comparables en minúsculas. */
function tecla(e: EventoAtajo): string {
  return e.key.toLowerCase();
}

function ctrlOMeta(e: EventoAtajo): boolean {
  return e.ctrl || e.meta;
}

/**
 * Tabla declarativa: una entrada por acción, en el orden en que se muestran
 * en el panel de ayuda (`#btn-shortcuts` / tecla `?`, `AtajosPanel`).
 */
export const TABLA_ATAJOS: DefinicionAtajo[] = [
  {
    combinacion: 'Ctrl/Cmd + Z',
    accion: 'deshacer',
    descripcion: 'Deshacer el último cambio',
    bloqueaEnEditable: true,
    coincide: (e) => ctrlOMeta(e) && !e.shift && tecla(e) === 'z'
  },
  {
    combinacion: 'Ctrl/Cmd + Y  ·  Ctrl/Cmd + Mayús + Z',
    accion: 'rehacer',
    descripcion: 'Rehacer el último cambio deshecho',
    bloqueaEnEditable: true,
    coincide: (e) => ctrlOMeta(e) && ((tecla(e) === 'y' && !e.shift) || (tecla(e) === 'z' && e.shift))
  },
  {
    combinacion: 'Ctrl/Cmd + S',
    accion: 'guardar',
    descripcion: 'Guardar (descargar) el PDF',
    bloqueaEnEditable: false,
    coincide: (e) => ctrlOMeta(e) && tecla(e) === 's'
  },
  {
    combinacion: 'Ctrl/Cmd + O',
    accion: 'abrir',
    descripcion: 'Abrir un archivo',
    bloqueaEnEditable: false,
    coincide: (e) => ctrlOMeta(e) && tecla(e) === 'o'
  },
  {
    combinacion: 'Ctrl/Cmd + P',
    accion: 'imprimir',
    descripcion: 'Imprimir el documento',
    bloqueaEnEditable: false,
    coincide: (e) => ctrlOMeta(e) && tecla(e) === 'p'
  },
  {
    combinacion: 'Ctrl/Cmd + F',
    accion: 'buscar',
    descripcion: 'Ir al buscador',
    bloqueaEnEditable: false,
    coincide: (e) => ctrlOMeta(e) && tecla(e) === 'f'
  },
  // F3 no inserta texto, así que no choca con la regla de oro: funciona también con el foco en el buscador.
  {
    combinacion: 'F3  ·  Enter (en el buscador)',
    accion: 'busqueda-siguiente',
    descripcion: 'Ir a la siguiente coincidencia de la búsqueda',
    bloqueaEnEditable: false,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && !e.shift && tecla(e) === 'f3'
  },
  {
    combinacion: 'Mayús + F3  ·  Mayús + Enter (en el buscador)',
    accion: 'busqueda-anterior',
    descripcion: 'Ir a la coincidencia anterior de la búsqueda',
    bloqueaEnEditable: false,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && e.shift && tecla(e) === 'f3'
  },
  {
    combinacion: 'Ctrl/Cmd + H',
    accion: 'reemplazar',
    descripcion: 'Buscar y reemplazar',
    bloqueaEnEditable: false,
    coincide: (e) => ctrlOMeta(e) && !e.shift && !e.alt && tecla(e) === 'h'
  },
  {
    combinacion: 'Ctrl/Cmd + "+"',
    accion: 'zoom-in',
    descripcion: 'Acercar (zoom in)',
    bloqueaEnEditable: false,
    // '=' es la misma tecla física que '+' sin Mayús en un teclado US: el
    // navegador entrega uno u otro según si el shift lo produjo o no.
    coincide: (e) => ctrlOMeta(e) && (tecla(e) === '+' || tecla(e) === '=')
  },
  {
    combinacion: 'Ctrl/Cmd + "-"',
    accion: 'zoom-out',
    descripcion: 'Alejar (zoom out)',
    bloqueaEnEditable: false,
    coincide: (e) => ctrlOMeta(e) && tecla(e) === '-'
  },
  {
    combinacion: 'Ctrl/Cmd + 0',
    accion: 'zoom-ajustar',
    descripcion: 'Ajustar al ancho',
    bloqueaEnEditable: false,
    coincide: (e) => ctrlOMeta(e) && tecla(e) === '0'
  },
  {
    combinacion: 'Inicio',
    accion: 'primera-pagina',
    descripcion: 'Ir a la primera página',
    bloqueaEnEditable: true,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && tecla(e) === 'home'
  },
  {
    combinacion: 'Fin',
    accion: 'ultima-pagina',
    descripcion: 'Ir a la última página',
    bloqueaEnEditable: true,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && tecla(e) === 'end'
  },
  {
    combinacion: 'RePág',
    accion: 'pagina-anterior',
    descripcion: 'Página anterior',
    bloqueaEnEditable: true,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && tecla(e) === 'pageup'
  },
  {
    combinacion: 'AvPág',
    accion: 'pagina-siguiente',
    descripcion: 'Página siguiente',
    bloqueaEnEditable: true,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && tecla(e) === 'pagedown'
  },
  {
    combinacion: 'Supr',
    accion: 'suprimir',
    descripcion: 'Borrar la imagen o la anotación seleccionada',
    bloqueaEnEditable: true,
    coincide: (e) => !ctrlOMeta(e) && (tecla(e) === 'delete' || tecla(e) === 'backspace')
  },
  {
    combinacion: 'Mayús + →  ·  Mayús + ←',
    accion: 'seleccion-caracter',
    descripcion: 'Con una línea enfocada: ampliar o reducir la selección de texto un carácter (luego Resaltar, Subrayar, Tachar o Ctrl/Cmd + C)',
    bloqueaEnEditable: true,
    coincide: (e) => e.shift && !e.alt && !ctrlOMeta(e) && (tecla(e) === 'arrowright' || tecla(e) === 'arrowleft')
  },
  {
    combinacion: 'Mayús + ↓  ·  Mayús + ↑',
    accion: 'seleccion-linea',
    descripcion: 'Con una línea enfocada: ampliar o reducir la selección de texto una línea',
    bloqueaEnEditable: true,
    coincide: (e) => e.shift && !e.alt && !ctrlOMeta(e) && (tecla(e) === 'arrowdown' || tecla(e) === 'arrowup')
  },
  {
    combinacion: 'Alt + ↓  ·  Alt + ↑',
    accion: 'anotacion-recorrer',
    descripcion: 'Seleccionar la anotación siguiente o anterior de la página (en orden de lectura); Supr la borra y Esc la suelta',
    bloqueaEnEditable: true,
    // Alt+←/→ son atrás/adelante del navegador: no se tocan.
    coincide: (e) => e.alt && !e.shift && !ctrlOMeta(e) && (tecla(e) === 'arrowdown' || tecla(e) === 'arrowup')
  },
  {
    combinacion: 'Esc',
    accion: 'escape',
    descripcion: 'Salir de la herramienta activa, descartar la selección de texto o soltar la anotación seleccionada',
    bloqueaEnEditable: true,
    coincide: (e) => !ctrlOMeta(e) && tecla(e) === 'escape'
  },
  {
    combinacion: '?',
    accion: 'ayuda',
    descripcion: 'Mostrar esta ayuda',
    bloqueaEnEditable: true,
    coincide: (e) => !ctrlOMeta(e) && tecla(e) === '?'
  },
  // Atajos de una letra (§6 del rediseño de interfaz — paridad con E-017 de
  // la app vieja, ver js/app.js: V=seleccionar, P=pluma, T=texto, E=borrador,
  // R=rectángulo; N=nota es nuevo aquí, la app vieja no lo tenía). Todos
  // bloqueados en campos editables (`bloqueaEnEditable: true`) y sin
  // Ctrl/Cmd/Alt para no chocar con atajos del sistema o del navegador.
  {
    combinacion: 'V',
    accion: 'tool-none',
    descripcion: 'Herramienta Seleccionar (ninguna herramienta)',
    bloqueaEnEditable: true,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && tecla(e) === 'v'
  },
  {
    combinacion: 'T',
    accion: 'tool-insert',
    descripcion: 'Herramienta Insertar texto',
    bloqueaEnEditable: true,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && tecla(e) === 't'
  },
  {
    combinacion: 'P',
    accion: 'tool-pen',
    descripcion: 'Herramienta Pluma',
    bloqueaEnEditable: true,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && tecla(e) === 'p'
  },
  {
    combinacion: 'R',
    accion: 'tool-rect',
    descripcion: 'Herramienta Rectángulo',
    bloqueaEnEditable: true,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && tecla(e) === 'r'
  },
  {
    combinacion: 'E',
    accion: 'tool-eraser',
    descripcion: 'Herramienta Borrador',
    bloqueaEnEditable: true,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && tecla(e) === 'e'
  },
  {
    combinacion: 'N',
    accion: 'tool-note',
    descripcion: 'Herramienta Nota',
    bloqueaEnEditable: true,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && tecla(e) === 'n'
  },
  // E-073 (WCAG 2.1.1): Nota y Rectángulo sin ratón. Solo con la herramienta activa y el foco en el visor.
  {
    combinacion: 'Enter (con Nota o Rectángulo activa)',
    accion: 'herramienta-colocar',
    descripcion: 'Nota: la coloca en la zona visible (sobre la línea enfocada, si la hay) y pide su texto. Rectángulo: crea uno de tamaño por defecto en la zona visible; Enter de nuevo lo confirma y Esc lo cancela',
    bloqueaEnEditable: true,
    contextual: true,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && !e.shift && tecla(e) === 'enter'
  },
  {
    combinacion: 'Flechas  ·  Mayús + flechas (rectángulo en preparación)',
    accion: 'herramienta-mover',
    descripcion: 'Mover el rectángulo (flechas) o redimensionarlo (Mayús + flechas: ← → ancho, ↑ ↓ alto)',
    bloqueaEnEditable: true,
    contextual: true,
    coincide: (e) => !ctrlOMeta(e) && !e.alt && (tecla(e) === 'arrowleft' || tecla(e) === 'arrowright' || tecla(e) === 'arrowup' || tecla(e) === 'arrowdown')
  }
];

/**
 * Resuelve un evento normalizado a la definición que coincide, o `null` si
 * ninguna combinación aplica o si aplica pero la regla de oro la bloquea
 * (foco en un campo editable). Pura: sin DOM, sin `preventDefault`, sin
 * efectos — quien la llama decide qué hacer con el resultado (`App.ts`).
 */
export function resolverAtajo(e: EventoAtajo): DefinicionAtajo | null {
  const def = TABLA_ATAJOS.find((d) => !d.contextual && d.coincide(e));
  if (!def) return null;
  if (def.bloqueaEnEditable && e.editable) return null;
  return def;
}

/** Como `resolverAtajo`, pero solo entre los atajos contextuales (Nota/Rectángulo por teclado, E-073). */
export function resolverAtajoContextual(e: EventoAtajo): DefinicionAtajo | null {
  const def = TABLA_ATAJOS.find((d) => d.contextual && d.coincide(e));
  if (!def) return null;
  if (def.bloqueaEnEditable && e.editable) return null;
  return def;
}

/**
 * true si `target` es un campo donde las teclas deben editar texto en vez de
 * disparar un atajo global: `input`/`textarea`/`select`, o cualquier
 * elemento `contentEditable` — incluida una `.run` en edición
 * (`block.contentEditable = 'true'` en `TextLayer.ts`).
 */
export function esCampoEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
