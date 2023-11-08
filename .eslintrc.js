module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true
  },
  extends: 'standard-with-typescript',
  parserOptions: {
    ecmaVersion: 'latest',
    project: ['tsconfig.json', 'tsconfig.dev.json'],
    sourceType: 'module'
  },
  rules: {
    'import/no-unresolved': 0,
    indent: ['error', 2]
  }
}
