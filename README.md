# PDF Editor - Suite Integral de Edición y Manipulación de PDF

Una suite web moderna, ultrarrápida y 100% interactiva para la edición, manipulación, escaneo OCR y conversión multiformato de documentos PDF. Diseñada bajo la filosofía **Zero-Data Storage**, ejecutándose por completo en el navegador del usuario a través de WebAssembly y Canvas 2D sin depender de almacenamiento en bases de datos ni recopilación de información.

---

## 🌐 Acceso Público en Producción (Gratis Permanente)

👉 **[https://pdf-editor-suite-lyart.vercel.app](https://pdf-editor-suite-lyart.vercel.app)**

*Desplegado en la red global de Vercel con HTTPS, cabeceras de seguridad activas y procesamiento 100% en el cliente.*

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

El repositorio incluye `vercel.json` configurado para despliegue instantáneo como SPA estático con cabeceras de seguridad activas:

1. Instala Vercel CLI o vincula tu repositorio en el panel de Vercel:
   ```bash
   npx vercel
   ```
2. El proyecto se desplegará sin requerir configuración adicional de build.

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
