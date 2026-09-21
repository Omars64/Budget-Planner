import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

const browserGlobals = Object.fromEntries([
  'AbortController','AbortSignal','Blob','CustomEvent','DOMException','Event','HTMLDialogElement',
  'MutationObserver','TextEncoder','atob','btoa','clearInterval','clearTimeout','console','confirm',
  'crypto','document','fetch','FormData','getComputedStyle','Headers','history','Intl','localStorage',
  'location','navigator','sessionStorage','setInterval','setTimeout','URL','URLSearchParams','window',
].map(name => [name, 'readonly']))

export default [
  { ignores: ['dist/**', 'node_modules/**', 'android/**', 'ios/**', '.verification/**', 'pytest-cache-files-*/**'] },
  {
    files: ['src/**/*.{js,jsx}', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: browserGlobals,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  { files: ['vite.config.js'], languageOptions: { globals: { process: 'readonly' } } },
]
