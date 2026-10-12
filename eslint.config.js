import js from '@eslint/js';
import globals from 'globals';

export default [
  // admin/ is TypeScript with its own checks (npm run typecheck there).
  { ignores: ['dist/', 'node_modules/', 'admin/'] },
  js.configs.recommended,
  {
    files: ['src/js/**/*.js'],
    // __PRICES__ is substituted from src/prices.json at build time.
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, __PRICES__: 'readonly' },
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
];
