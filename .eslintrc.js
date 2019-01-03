module.exports = {
  extends: 'airbnb-base',
  env: { browser: false, node: true },
  rules: {
    'no-console': 'off',
  },
  overrides: {
    files: ['**/*.spec.js'],
    env: {
      jest: true,
    },
  },
};
