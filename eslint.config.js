import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'packages/telamon/test/fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts in the examples: flat config carries no eslint-env comments,
    // so the handful of globals they use are declared here.
    files: ['examples/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    // The embed example's page script, which runs in a browser.
    files: ['examples/embed/**/*.js'],
    languageOptions: {
      globals: {
        Intl: 'readonly',
        URL: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
);
