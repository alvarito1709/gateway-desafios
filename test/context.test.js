// Restricción opcional por curso (src/lti/context.js).
import test from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  PUBLIC_BASE_URL: 'https://especializate.bue.edu.ar',
  BASE_PATH: '/aula/desafios',
  SESSION_SECRET: 'x'.repeat(40),
});
const { isAllowedContext } = await import('../src/lti/context.js');

test('sin lista configurada no restringe', () => {
  assert.equal(isAllowedContext('7', []), true);
  assert.equal(isAllowedContext(undefined, []), true);
});

test('con lista, solo acepta los cursos incluidos (id numérico o texto)', () => {
  assert.equal(isAllowedContext('12', ['12', '15']), true);
  assert.equal(isAllowedContext(15, ['12', '15']), true);
  assert.equal(isAllowedContext('99', ['12', '15']), false);
});

test('con lista, un launch sin contexto se rechaza', () => {
  assert.equal(isAllowedContext(undefined, ['12']), false);
  assert.equal(isAllowedContext(null, ['12']), false);
  assert.equal(isAllowedContext('', ['12']), false);
});
