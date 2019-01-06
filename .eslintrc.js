module.exports = {
  extends: 'airbnb-base',
  env: { browser: false, node: true },
  rules: {
    'no-console': 'off',
    'no-debugger': 'off',
  },
  overrides: {
    files: ['**/*.spec.js'],
    rules: {
      'global-require': 'off',
    },
    env: {
      jest: true,
    },
  },
};
