module.exports = {
  env: {
    browser: true,
    es2020: true,
  },
  extends: [
    'eslint:recommended',
    '@typescript-eslint/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // Emoji ban rule
    'no-restricted-syntax': [
      'error',
      {
        selector: 'Literal[value=/[\\u{1F600}-\\u{1F6FF}\\u{1F300}-\\u{1F5FF}\\u{1F680}-\\u{1F6FF}\\u{2600}-\\u{26FF}\\u{2700}-\\u{27BF}]/u]',
        message: 'Emojis are not allowed in source code. Use text alternatives or professional icons.',
      },
      {
        selector: 'TemplateLiteral *[value=/:.*:/]',
        message: 'Emoji shortcodes (:emoji:) are not allowed in source code.',
      },
    ],
  },
};