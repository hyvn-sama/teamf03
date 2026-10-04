// 로그인 입력 검증 (브라우저·서버 공용). 비밀번호 해시는 서버 전용 api/_auth.js
import { InputError } from './ops.js';

export function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('82')) d = `0${d.slice(2)}`;
  if (!/^01[016789]\d{7,8}$/.test(d)) throw new InputError('휴대폰 번호를 확인해주세요. (예: 010-1234-5678)');
  return d;
}

export function formatPhone(d) {
  return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

export function cleanPassword(raw) {
  const p = String(raw ?? '');
  if (p.length < 4 || p.length > 30) throw new InputError('비밀번호는 4~30자로 입력해주세요.');
  return p;
}

export function cleanSignup(raw) {
  const name = String(raw.name ?? '').trim();
  if (!name || name.length > 20) throw new InputError('이름을 1~20자로 입력해주세요.');
  return { phone: normalizePhone(raw.phone), name, password: cleanPassword(raw.password) };
}
