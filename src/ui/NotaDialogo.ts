import { mostrarModal } from './dialogo';
import { normalizarTextoNota } from '../texto/notaTexto';

/**
 * Editor de nota (B4): sustituye al cuadro nativo de petición de texto. `<dialog>` modal con un textarea
 * multilínea («Texto de la nota»), Guardar y Cancelar. Ctrl/Cmd+Enter guarda; Escape cancela; el foco entra en el
 * textarea y, al cerrar, `mostrarModal` lo devuelve al disparador. Resuelve con el texto normalizado, o `null` si
 * se cancela o queda en blanco (así crear no deja una nota vacía). Sin innerHTML (§2.2): el valor entra por `.value`.
 */
export function pedirTextoNota(opciones: { titulo: string; valorInicial?: string }): Promise<string | null> {
  return new Promise<string | null>((resolver) => {
    const dialog = document.createElement('dialog');
    dialog.id = 'nota-dialogo';
    Object.assign(dialog.style, { width: 'min(32rem, 92vw)', boxSizing: 'border-box' });

    const titulo = document.createElement('div');
    titulo.id = 'nota-dialogo-titulo';
    titulo.textContent = opciones.titulo;
    Object.assign(titulo.style, { fontWeight: 'bold', marginBottom: '8px' });

    const area = document.createElement('textarea');
    area.id = 'nota-dialogo-texto';
    area.rows = 6;
    area.value = opciones.valorInicial ?? '';
    area.setAttribute('aria-label', 'Texto de la nota');
    Object.assign(area.style, { width: '100%', boxSizing: 'border-box', resize: 'vertical', font: 'inherit' });

    const barra = document.createElement('div');
    Object.assign(barra.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '10px', alignItems: 'center' });
    const ayuda = document.createElement('span');
    ayuda.textContent = 'Ctrl+Enter guarda · Esc cancela';
    Object.assign(ayuda.style, { marginRight: 'auto', fontSize: '12px', opacity: '0.7' });

    let resultado: string | null = null;
    const guardar = (): void => {
      const t = normalizarTextoNota(area.value);
      resultado = t === '' ? null : t;
      dialog.close();
    };

    const btnGuardar = document.createElement('button');
    btnGuardar.type = 'button';
    btnGuardar.textContent = 'Guardar';
    btnGuardar.addEventListener('click', guardar);
    const btnCancelar = document.createElement('button');
    btnCancelar.type = 'button';
    btnCancelar.textContent = 'Cancelar';
    btnCancelar.addEventListener('click', () => dialog.close());

    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); guardar(); }
    });
    // Escape: el evento `cancel` nativo cierra el diálogo; `resultado` sigue en null.
    dialog.addEventListener('close', () => resolver(resultado));

    barra.append(ayuda, btnCancelar, btnGuardar);
    dialog.append(titulo, area, barra);
    mostrarModal(dialog, { tituloId: 'nota-dialogo-titulo' });
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  });
}
