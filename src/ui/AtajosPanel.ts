/**
 * Diálogo de ayuda de atajos de teclado (#34 de la tabla de paridad, §9):
 * `#btn-shortcuts` ("?") o la tecla `?` (fuera de un campo editable, ver
 * `atajos.ts`) muestran la tabla generada desde `TABLA_ATAJOS` — la misma
 * fuente declarativa que resuelve los atajos, para que la ayuda nunca se
 * desincronice de lo que de verdad hace cada tecla.
 *
 * Sin innerHTML (AGENTS.md §2.2): aunque aquí el contenido es fijo (no viene
 * del documento del usuario), se construye con `createElement`/`textContent`
 * igual que el resto de diálogos de esta app (ver `TextPanel.ts`).
 */
import { TABLA_ATAJOS } from './atajos';

export class AtajosPanel {
  static open(): void {
    const dialog = document.createElement('dialog');
    dialog.id = 'shortcuts-dialog';
    Object.assign(dialog.style, { padding: '16px', borderRadius: '8px', border: '1px solid #ccc', maxWidth: '480px', width: '90vw' });

    const titulo = document.createElement('div');
    titulo.textContent = 'Atajos de teclado';
    titulo.style.fontWeight = 'bold';
    titulo.style.marginBottom = '8px';

    const tabla = document.createElement('table');
    tabla.id = 'shortcuts-table';
    Object.assign(tabla.style, { width: '100%', borderCollapse: 'collapse', font: '13px sans-serif' });

    for (const def of TABLA_ATAJOS) {
      const fila = document.createElement('tr');

      const celdaCombinacion = document.createElement('td');
      celdaCombinacion.textContent = def.combinacion;
      Object.assign(celdaCombinacion.style, { padding: '4px 8px 4px 0', whiteSpace: 'nowrap', fontFamily: 'monospace', verticalAlign: 'top' });

      const celdaDescripcion = document.createElement('td');
      celdaDescripcion.textContent = def.descripcion;
      celdaDescripcion.style.padding = '4px 0';

      fila.append(celdaCombinacion, celdaDescripcion);
      tabla.appendChild(fila);
    }

    const barra = document.createElement('div');
    Object.assign(barra.style, { display: 'flex', justifyContent: 'flex-end', marginTop: '12px' });
    const btnCerrar = document.createElement('button');
    btnCerrar.id = 'btn-close-shortcuts-dialog';
    btnCerrar.type = 'button';
    btnCerrar.textContent = 'Cerrar';
    btnCerrar.addEventListener('click', () => dialog.close());
    barra.appendChild(btnCerrar);

    dialog.append(titulo, tabla, barra);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    dialog.showModal();
  }
}
