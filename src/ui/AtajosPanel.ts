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
import { mostrarModal } from './dialogo';

export class AtajosPanel {
  static open(): void {
    const dialog = document.createElement('dialog');
    dialog.id = 'shortcuts-dialog';
    Object.assign(dialog.style, { padding: '16px', borderRadius: '8px', border: '1px solid #ccc', maxWidth: '480px', width: '90vw' });

    const titulo = document.createElement('div');
    titulo.textContent = 'Atajos de teclado';
    titulo.style.fontWeight = 'bold';
    titulo.style.marginBottom = '8px';
    // B2: el foco inicial va al título (no al primer enfocable, que era el enlace «Versión anterior»).
    titulo.id = 'shortcuts-title';
    titulo.tabIndex = -1;

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

    // Excepción WCAG 2.1.1: la pluma (trazo a mano alzada) no tiene equivalente de teclado.
    const notaPluma = document.createElement('p');
    notaPluma.id = 'shortcuts-pluma';
    notaPluma.textContent = 'Pluma: el trazo a mano alzada depende del recorrido del movimiento, por lo que WCAG 2.1.1 lo exime de tener teclado. Para marcar sin ratón usa Rectángulo, Resaltar, Subrayar, Tachar o Nota.';
    Object.assign(notaPluma.style, { font: '12px sans-serif', margin: '8px 0 0' });

    // Enlace discreto a la app vieja (cutover de despliegue, 2026-09-29):
    // se sirve temporalmente en /legacy/ para quien la necesite mientras la
    // app nueva alcanza paridad completa — ver AGENTS.md y el registro de la
    // reconstrucción. Vive en este diálogo de ayuda, no en la barra
    // principal: es una vía de escape, no una opción de uso habitual.
    const enlaceLegacy = document.createElement('a');
    enlaceLegacy.id = 'link-legacy';
    enlaceLegacy.href = '/legacy/';
    enlaceLegacy.textContent = 'Versión anterior';
    enlaceLegacy.style.cssText = 'font-size:12px;color:#6366f1;align-self:center;margin-right:auto;';

    const barra = document.createElement('div');
    Object.assign(barra.style, { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: '12px' });
    const btnCerrar = document.createElement('button');
    btnCerrar.id = 'btn-close-shortcuts-dialog';
    btnCerrar.type = 'button';
    btnCerrar.textContent = 'Cerrar';
    btnCerrar.addEventListener('click', () => dialog.close());
    barra.append(enlaceLegacy, btnCerrar);

    dialog.append(titulo, tabla, notaPluma, barra);
    // B-03: foco atrapado, aria-modal y foco devuelto al disparador al cerrar (helper común).
    mostrarModal(dialog, { tituloId: 'shortcuts-title' });
    titulo.focus();
  }
}
