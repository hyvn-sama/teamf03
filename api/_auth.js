// 비밀번호 해시 (scrypt + 사용자별 salt). 서버 전용
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const KEYLEN = 32;
const derive = (pw, salt) => new Promise((resolve, reject) => {
  scrypt(pw, salt, KEYLEN, (err, key) => (err ? reject(err) : resolve(key)));
});

export async function hashPassword(pw, salt = randomBytes(16).toString('hex')) {
  return { hash: (await derive(pw, salt)).toString('hex'), salt };
}

export async function verifyPassword(pw, user) {
  const key = await derive(pw, user.salt);
  const stored = Buffer.from(user.passHash, 'hex');
  return stored.length === key.length && timingSafeEqual(stored, key);
}
