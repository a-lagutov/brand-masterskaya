import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/'] },
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
    // Cloudflare Worker: fetch, Request, Response and URL are globals there.
    files: ['worker/**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.serviceworker },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
];
