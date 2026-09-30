# PDF Editor - Suite Integral de Edición y Manipulación de PDF

Una suite web moderna, ultrarrápida y 100% interactiva para la edición, manipulación, escaneo OCR y conversión multiformato de documentos PDF. Diseñada bajo la filosofía **Zero-Data Storage**, ejecutándose por completo en el navegador del usuario a través de WebAssembly y Canvas 2D sin depender de almacenamiento en bases de datos ni recopilación de información.

---

## 🌐 Enlaces Oficiales

- **Aplicación Web en Vivo**: 👉 **[https://pdf-editor-suite-lyart.vercel.app](https://pdf-editor-suite-lyart.vercel.app)**
- **Repositorio en GitHub**: 👉 **[https://github.com/NeoFao/pdf-editor-suite](https://github.com/NeoFao/pdf-editor-suite)**

*Desplegado en la red global de Vercel con HTTPS, cabeceras de seguridad activas y procesamiento 100% en el cliente.*

---

## 🔒 Políticas de Contribución y Seguridad
Todas las contribuciones externas están sujetas a revisión obligatoria por el propietario (@NeoFao). La rama `main` cuenta con reglas estrictas de protección:
- Se prohíbe el `git push` directo a `main`.
- Toda aportación debe realizarse mediante **Pull Request** cumpliendo con la [Guía de Contribución](CONTRIBUTING.md) y la [Política de Seguridad](SECURITY.md).

---

## 🚀 Características Principales

### 📂 1. Organizador y Gestor de Páginas
- **Fusión de Múltiples PDFs**: Carga múltiples archivos y compón un nuevo documento único.
- **División por Rangos**: Especifica rangos numéricos (ej. `1-3, 5, 8-12`) para extraer páginas específicas.
- **Reordenación Visual Interactiva**: Miniaturas con soporte drag-and-drop en tiempo real (SortableJS).
- **Manipulación de Páginas**: Rotación a 90°/180° horaria y antihoraria, duplicado de páginas y eliminación individual o en bloque.

### ✍️ 2. Editor de Anotaciones y Firma Digital
- **Herramientas de Dibujo**: Pluma a mano alzada con grosor y selector de color dinámico.
- **Resaltador Fluorescente**: Resaltado translúcido que preserva la legibilidad del texto subyacente.
- **Inserción de Texto Libre**: Posicionamiento y personalización de notas tipográficas.
- **Firma Digital**:
  - Pad de dibujo con curvas Bézier suaves.
  - Subida de imágenes de firmas en PNG/JPG con eliminación automática de fondo blanco a transparencia total.
  - Sello interactivo redimensionable y desplazable sobre cualquier página.
- **Quemado Vectorial Directo**: Incrustación física y permanente en el PDF generado mediante `pdf-lib`.

### 📄 3. Compresor y Optimizador en Memoria
- Reducción de escala y recompresión JPEG adaptativa de alta eficiencia.
- Control granular de calidad (20% a 95%) y factor de resolución DPI (0.8x a 1.2x).
- Visualización de métricas de ahorro en tiempo real (ej. `-62% de tamaño`) antes de descargar.

### 🔍 4. Escáner OCR & Filtros Fotográficos
- **Filtros de Procesamiento 2D en Canvas** (estilo CamScanner):
  - *Magic Color*: Aclara fondos a blanco puro e intensifica los contrastes de tinta conservando colores.
  - *Blanco y Negro*: Umbralización binaria de alto contraste para documentos fotocopiados.
  - *Escala de Grises*: Desaturación luminosa calibrada.
- **Motor OCR WebAssembly (Tesseract.js)**:
  - Barra de progreso interactiva por etapas (inicialización, descarga de datos entrenados, reconocimiento de caracteres).
  - Soporte multiidioma (Español `spa`, Inglés `eng`, o bilingüe).
  - **Regla de Oro**: Inspección previa de capas de texto nativo con `pdf.js` para evitar ejecutar OCR redundante en documentos digitales vectoriales.
  - Exportación a `.txt` o PDF escaneado con preservación de filtros.

### 🔄 5. Conversor Multiformato de Alta Fidelidad
- **Word (.docx) a PDF**: Renderizado exacto mediante `docx-preview` (`docx.renderAsync`) respetando tipografías, márgenes y tablas de OpenXML (sin recurrir a librerías degradantes como mammoth.js).
- **Imágenes a PDF**: Conversor por lotes para JPG, PNG y WebP con márgenes configurables.
- **PDF a Markdown (.md)**: Extracción geométrica 2D analizando coordenadas `x`, `y` y tamaños relativos de fuentes para reconstruir títulos jerárquicos (`#`, `##`, `###`) y tablas estructuradas en Markdown (`| Col1 | Col2 |`).
- **Markdown (.md) a PDF**: Editor Markdown en tiempo real con soporte de fórmulas matemáticas KaTeX ($\LaTeX$) y resaltado de código sintáctico (`highlight.js`).

---

## 🛡️ Estándares de Seguridad y Privacidad

- **Zero-Data Storage**: Todo el procesamiento se realiza en la memoria RAM del navegador (`Uint8Array`, `ArrayBuffer`, `Blob`). Cero datos enviados a servidores.
- **Aislamiento Seguro**: Las vistas previas en iframes emplean estrictamente el atributo `sandbox="allow-scripts allow-same-origin"`.
- **Cabeceras HTTP de Seguridad**:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - Deshabilitación de `X-Powered-By`
- **Sin BOM**: Todos los archivos de código están generados en formato UTF-8 estricto sin BOM.

---

## 💻 Instalación y Ejecución Local

### Prerrequisitos
- Node.js versión 18 o superior.

### Pasos:
1. Clonar o abrir el directorio del proyecto:
   ```bash
   cd "PDF Editor"
   ```

2. Instalar dependencias del servidor:
   ```bash
   npm install
   ```

3. Iniciar el servidor local:
   ```bash
   npm start
   ```

4. Abrir en el navegador:
   ```
   http://localhost:3000
   ```

*(También puede abrirse directamente `index.html` con cualquier servidor estático local o Live Server).*

---

## ☁️ Despliegue en Vercel

Desde el cutover de despliegue (2026-09-29), `vercel.json` compila y publica la
**app nueva** (`src/`, Vite + TypeScript + PDFium) como página principal. La
app vieja (este `index.html` + `js/` + `css/` documentados arriba) se sigue
sirviendo, completa y sin cambios funcionales, en `/legacy/` — para quien la
necesite mientras la app nueva alcanza paridad completa. No se ha borrado
nada: es un cutover reversible, no una migración destructiva.

`vercel.json`:
- `buildCommand: npm run build:deploy` → `scripts/construir-despliegue.mjs`
  construye la app nueva con Vite y copia la app vieja completa a
  `legacy/`, leyendo `index.html` (y el `workerSrc` inline de pdf.js) para
  saber qué copiar en vez de mantener una lista a mano.
- `outputDirectory: dist-deploy` → lo que ese script produce.
- Cabeceras de seguridad (CSP, HSTS, etc.) **idénticas** a las de antes,
  aplicadas a todo el árbol (`/legacy/` incluido). Los assets de Vite en
  `/assets/*` llevan hash de contenido en el nombre, así que se cachean
  `immutable`; el resto sigue con `must-revalidate` como antes.

Para desplegar:
```bash
npx vercel
```
El proyecto se despliega sin configuración adicional: Vercel ejecuta
`npm run build:deploy` y publica `dist-deploy/`.

### Construir el despliegue en local

```bash
npm run build:deploy    # genera dist-deploy/ (gitignored)
npm run preview:deploy  # lo sirve en http://127.0.0.1:4174
```

`tests/e2e/deploy/*.spec.ts` (proyecto `deploy` de Playwright, incluido en
`npm run verify`) es el smoke de ese árbol: `/` abre la app nueva y un PDF,
`/legacy/` carga la app vieja sin 404 de recursos locales, y el enlace
"Versión anterior" (en el diálogo de ayuda `?` de la app nueva) lleva a
`/legacy/`.

---

## 🛠️ Tecnologías Empleadas

| Librería | Versión | Propósito |
|---|---|---|
| `pdf-lib` | 1.17.1 | Composición, división, rotación y sellado vectorial de PDF |
| `pdf.js` | 3.11.174 | Renderizado visual en Canvas y extracción de texto geométrico |
| `docx-preview` | 0.3.3 | Renderizado de alta fidelidad de archivos Word OpenXML |
| `Tesseract.js` | 5.x WASM | Motor de Reconocimiento Óptico de Caracteres |
| `html2pdf.js` | 0.10.1 | Compilación HTML/CSS a PDF imprimible |
| `JSZip` | 3.10.1 | Manejo de descargas comprimidas |
| `SortableJS` | 1.15.2 | Reordenación fluida mediante drag-and-drop |
| `KaTeX` | 0.16.9 | Renderizado de ecuaciones matemáticas $\LaTeX$ |
| `highlight.js` | 11.9.0 | Resaltado sintáctico de fragmentos de código |
| `Tailwind CSS` | 3.x | Framework de utilidades y estilos Glassmorphism |
