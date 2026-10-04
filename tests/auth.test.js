import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, formatPhone, cleanSignup } from '../js/auth.js';
import { InputError } from '../js/ops.js';

test('normalizePhone: 여러 형식을 숫자만으로', () => {
  assert.equal(normalizePhone('010-1234-5678'), '01012345678');
  assert.equal(normalizePhone(' 010 1234 5678 '), '01012345678');
  assert.equal(normalizePhone('+82 10-1234-5678'), '01012345678');
  assert.equal(normalizePhone('011-123-4567'), '0111234567');
  assert.throws(() => normalizePhone('02-123-4567'), InputError);
  assert.throws(() => normalizePhone(''), InputError);
});

test('formatPhone: 보기 좋게', () => {
  assert.equal(formatPhone('01012345678'), '010-1234-5678');
  assert.equal(formatPhone('0111234567'), '011-123-4567');
});

test('cleanSignup: 이름·비밀번호 검사', () => {
  assert.deepEqual(cleanSignup({ phone: '010-1234-5678', name: ' 김민지 ', password: '1234' }), { phone: '01012345678', name: '김민지', password: '1234' });
  assert.throws(() => cleanSignup({ phone: '01012345678', name: '', password: '1234' }), InputError);
  assert.throws(() => cleanSignup({ phone: '01012345678', name: 'a', password: '123' }), InputError);
  assert.throws(() => cleanSignup({ phone: '01012345678', name: 'a', password: 'x'.repeat(31) }), InputError);
});
