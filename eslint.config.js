// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Regras de segurança aplicadas a todo o código (seção 3 da especificação). */
const securityRules = {
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-restricted-properties': [
    'error',
    {
      property: 'innerHTML',
      message: 'Use textContent ou JSX (texto é escapado automaticamente).',
    },
    { property: 'outerHTML', message: 'Não monte HTML com strings.' },
    { property: 'insertAdjacentHTML', message: 'Não monte HTML com strings.' },
    { object: 'document', property: 'write', message: 'Não use document.write.' },
    { object: 'document', property: 'writeln', message: 'Não use document.writeln.' },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
      message: 'Proibido: dados de arquivo nunca viram HTML.',
    },
  ],
  'no-console': ['error', { allow: ['warn', 'error'] }],
};

export default tseslint.config(
  {
    ignores: ['dist/', 'dev-dist/', 'coverage/', 'playwright-report/', 'test-results/', 'vendor/'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'no-unsanitized': noUnsanitized },
    rules: {
      ...securityRules,
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // `() => fazAlgo()` é idiomático em callbacks e testes.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/workers/**/*.ts'],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ['*.config.{js,ts}', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
