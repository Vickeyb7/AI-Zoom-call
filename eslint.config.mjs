import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'desktop/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
