module.exports = {
  root: true,
  ignorePatterns: ['**/dist/**', '**/lib/**', '**/coverage/**', '**/*.d.ts'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  env: {
    es2022: true,
    node: true,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
  },
  overrides: [
    {
      files: ['frontend/src/**/*.{ts,tsx}'],
      plugins: ['react-hooks', 'react-refresh'],
      extends: ['plugin:react-hooks/recommended'],
      env: {
        browser: true,
      },
      rules: {
        'react-refresh/only-export-components': 'off',
      },
    },
  ],
};
