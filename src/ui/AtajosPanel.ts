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

/** Una alternativa suelta es una cadena de teclas (`Mayús + F3`, con nota opcional entre paréntesis) o una frase (`doble clic sobre él`). */
function pintarAlternativa(contenedor: HTMLElement, alt: string): void {
  const destino = document.createElement('span');
  destino.className = 'atajo-alt';
  contenedor.appendChild(destino);
  const m = /^(.*?)(\s+\(.*\))?$/.exec(alt);
  const teclas = (m?.[1] ?? alt).split(' + ');
  const esTecla = (t: string): boolean => !t.includes(' ') && t.length <= 12;
  if (!teclas.every(esTecla)) { destino.textContent = alt; return; }
  teclas.forEach((t, i) => {
    if (i > 0) destino.append(' + ');
    const k = document.createElement('kbd');
    k.textContent = t;
    destino.appendChild(k);
  });
  if (m?.[2]) {
    const nota = document.createElement('span');
    nota.className = 'atajo-nota';
    nota.textContent = m[2];
    destino.append(' ', nota);
  }
}

export class AtajosPanel {
  static open(): void {
    const dialog = document.createElement('dialog');
    dialog.id = 'shortcuts-dialog';
    dialog.className = 'atajos-dialog';

    // Anatomía del sistema de diseño (E-130).
    const titulo = document.createElement('h2');
    titulo.className = 'dlg-titulo';
    // B2: el foco inicial va al título (no al primer enfocable, que era el enlace «Versión anterior»).
    titulo.id = 'shortcuts-title';
    titulo.tabIndex = -1;
    titulo.textContent = 'Atajos de teclado';
    const cabecera = document.createElement('div');
    cabecera.className = 'dlg-cabecera';
    cabecera.appendChild(titulo);

    const tabla = document.createElement('table');
    tabla.id = 'shortcuts-table';
    tabla.className = 'atajos-tabla';
    tabla.setAttribute('aria-label', 'Atajos de teclado y su efecto');

    for (const def of TABLA_ATAJOS) {
      const fila = document.createElement('tr');

      const celdaCombinacion = document.createElement('th');
      celdaCombinacion.scope = 'row';
      // Cada alternativa en su propia línea (el separador «·» de la tabla de datos se vuelve estructura).
      for (const alt of def.combinacion.split(/\s+·\s+/)) pintarAlternativa(celdaCombinacion, alt);

      const celdaDescripcion = document.createElement('td');
      celdaDescripcion.textContent = def.descripcion;

      fila.append(celdaCombinacion, celdaDescripcion);
      tabla.appendChild(fila);
    }

    // Excepción WCAG 2.1.1: la pluma (trazo a mano alzada) no tiene equivalente de teclado.
    const notaPluma = document.createElement('p');
    notaPluma.id = 'shortcuts-pluma';
    notaPluma.className = 'campo-ayuda';
    notaPluma.textContent = 'Pluma: el trazo a mano alzada depende del recorrido del movimiento, por lo que WCAG 2.1.1 lo exime de tener teclado. Para marcar sin ratón usa Rectángulo, Resaltar, Subrayar, Tachar o Nota.';

    const cuerpo = document.createElement('div');
    cuerpo.className = 'dlg-cuerpo';
    cuerpo.append(tabla, notaPluma);

    // Enlace discreto a la app vieja (cutover de despliegue, 2026-09-29):
    // se sirve temporalmente en /legacy/ para quien la necesite mientras la
    // app nueva alcanza paridad completa — ver AGENTS.md y el registro de la
    // reconstrucción. Vive en este diálogo de ayuda, no en la barra
    // principal: es una vía de escape, no una opción de uso habitual.
    const enlaceLegacy = document.createElement('a');
    enlaceLegacy.id = 'link-legacy';
    enlaceLegacy.className = 'enlace dlg-pie-izq';
    enlaceLegacy.href = '/legacy/';
    enlaceLegacy.textContent = 'Versión anterior';

    const barra = document.createElement('div');
    barra.className = 'dlg-pie';
    const btnCerrar = document.createElement('button');
    btnCerrar.id = 'btn-close-shortcuts-dialog';
    btnCerrar.type = 'button';
    btnCerrar.className = 'btn btn--primario';
    btnCerrar.textContent = 'Cerrar';
    btnCerrar.addEventListener('click', () => dialog.close());
    barra.append(enlaceLegacy, btnCerrar);

    dialog.append(cabecera, cuerpo, barra);
    // B-03: foco atrapado, aria-modal y foco devuelto al disparador al cerrar (helper común).
    mostrarModal(dialog, { tituloId: 'shortcuts-title' });
    titulo.focus();
  }
}
