import { mostrarModal } from './dialogo';
import { crearBoton, crearCabecera, crearCuerpo, crearPie } from './dlgPartes';
import { normalizarTextoNota } from '../texto/notaTexto';

/**
 * Editor de nota (B4): sustituye al cuadro nativo de petición de texto. `<dialog>` modal con un textarea
 * multilínea («Texto de la nota»), Guardar y Cancelar. Ctrl/Cmd+Enter guarda; Escape cancela; el foco entra en el
 * textarea y, al cerrar, `mostrarModal` lo devuelve al disparador. Resuelve con el texto normalizado, o `null` si
 * se cancela o queda en blanco (así crear no deja una nota vacía). Con `permitirQuitar` (editar el comentario de un
 * marcado) aparece además «Quitar comentario», que resuelve con `''` (vaciar `/Contents`): es el único modo de
 * obtener `''`, así que un texto en blanco sigue siendo cancelar y no hay ambigüedad. Sin innerHTML (§2.2).
 * Presentación: anatomía `.dlg-*` del sistema de diseño (E-130); la lógica no cambia.
 */
export function pedirTextoNota(opciones: { titulo: string; valorInicial?: string; permitirQuitar?: boolean }): Promise<string | null> {
  return new Promise<string | null>((resolver) => {
    const dialog = document.createElement('dialog');
    dialog.id = 'nota-dialogo';
    dialog.classList.add('nota-dialogo');

    const { cabecera } = crearCabecera('nota-dialogo-titulo', opciones.titulo);

    const area = document.createElement('textarea');
    area.id = 'nota-dialogo-texto';
    area.className = 'nota-area';
    area.rows = 6;
    area.value = opciones.valorInicial ?? '';
    area.setAttribute('aria-label', 'Texto de la nota');

    const ayuda = document.createElement('p');
    ayuda.className = 'dlg-mensaje';
    const k1 = document.createElement('kbd'); k1.textContent = 'Ctrl+Enter';
    const k2 = document.createElement('kbd'); k2.textContent = 'Esc';
    ayuda.append(k1, ' guarda · ', k2, ' cancela');

    let resultado: string | null = null;
    const guardar = (): void => {
      const t = normalizarTextoNota(area.value);
      resultado = t === '' ? null : t;
      dialog.close();
    };

    const btnGuardar = crearBoton('primario', 'Guardar');
    btnGuardar.addEventListener('click', guardar);
    const btnCancelar = crearBoton('secundario', 'Cancelar');
    btnCancelar.addEventListener('click', () => dialog.close());

    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); guardar(); }
    });
    // Escape: el evento `cancel` nativo cierra el diálogo; `resultado` sigue en null.
    dialog.addEventListener('close', () => resolver(resultado));

    const pie = crearPie();
    if (opciones.permitirQuitar) {
      const btnQuitar = crearBoton('peligro', 'Quitar comentario', 'nota-dialogo-quitar');
      btnQuitar.classList.add('dlg-pie-izq');
      btnQuitar.setAttribute('aria-label', 'Quitar comentario');
      btnQuitar.addEventListener('click', () => { resultado = ''; dialog.close(); });
      pie.append(btnQuitar);
    }
    pie.append(btnCancelar, btnGuardar);
    dialog.append(cabecera, crearCuerpo(area, ayuda), pie);
    mostrarModal(dialog, { tituloId: 'nota-dialogo-titulo' });
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  });
}
