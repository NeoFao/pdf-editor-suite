import globals from 'globals';

/**
 * ESLint como red complementaria a las reglas deterministas.
 *
 * Cubre lo que un linter detecta mejor que un grep: variables sin declarar,
 * casos de `switch` que se cuelan, promesas sin await. Las reglas específicas
 * del dominio viven en scripts/guards/reglas.mjs.
 */
export default [
  {
    ignores: [
      'node_modules/**',
      'css/tailwind.min.css',
      'js/pdf.min.js',
      'js/pdf.worker.min.js',
      'playwright-report/**',
      'test-results/**',
      'tests/fixtures/generados/**'
    ]
  },

  // Código de la aplicación: scripts clásicos en el navegador.
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        PDFLib: 'readonly',
        pdfjsLib: 'readonly',
        Tesseract: 'readonly',
        Sortable: 'readonly',
        html2pdf: 'readonly',
        docx: 'readonly',
        marked: 'readonly',
        katex: 'readonly',
        hljs: 'readonly',
        JSZip: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-implicit-globals': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'eqeqeq': ['error', 'smart'],
      'no-fallthrough': 'error',
      'no-dupe-class-members': 'error', // refuerzo de la regla no-miembros-duplicados (E-016)
      'no-async-promise-executor': 'error',
      'require-atomic-updates': 'error',
      'no-return-await': 'error',
      'no-constant-condition': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      // Un catch vacío esconde el fallo: exige al menos un comentario que diga por qué.
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  },

  // Scripts de herramientas y tests.
  // Los specs mezclan los dos mundos a propósito: el cuerpo del test corre en
  // Node, y los callbacks de `page.evaluate` corren dentro del navegador.
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.js', 'tests/**/*.mjs', '*.config.js', '*.config.mjs', 'server.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'eqeqeq': ['error', 'smart']
    }
  },

  // La suite E2E: bloquea desactivar tests desde el propio linter.
  {
    files: ['tests/e2e/**/*.spec.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name=/^(test|describe)$/][property.name=/^(only|skip|fixme)$/]",
          message: 'Prohibido desactivar o aislar tests: arregla el código o borra el test explicándolo en el PR (AGENTS.md §2.1).'
        }
      ]
    }
  }
];
