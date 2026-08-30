import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { sourceType: 'module', ecmaVersion: 2023 },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      // --- Money safety (Module 1, acceptance criterion 5) ---
      // All monetary amounts are Decimal. Binary floating point must never
      // touch a money value.
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message: 'Use Decimal (decimal.js / Prisma.Decimal) for monetary values.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Number',
          property: 'parseFloat',
          message: 'Use Decimal (decimal.js / Prisma.Decimal) for monetary values.',
        },
      ],
    },
  },
];
