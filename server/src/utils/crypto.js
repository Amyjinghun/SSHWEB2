const crypto = require('crypto');
const config = require('../config');

const CBC_ALGORITHM = 'aes-256-cbc';
const GCM_ALGORITHM = 'aes-256-gcm';
const KEY = crypto.createHash('sha256').update(config.encryptionKey).digest();

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, KEY, iv);
  let encrypted = cipher.update(String(text), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `v2:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptGcm(encryptedText) {
  const parts = encryptedText.split(':');
  if (parts.length !== 4 || parts[0] !== 'v2') throw new Error('密文格式不正确');
  const iv = Buffer.from(parts[1], 'hex');
  const authTag = Buffer.from(parts[2], 'hex');
  const encrypted = parts[3];
  const decipher = crypto.createDecipheriv(GCM_ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function decryptLegacyCbc(encryptedText) {
  const parts = encryptedText.split(':');
  if (parts.length < 2) throw new Error('密文格式不正确');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv(CBC_ALGORITHM, KEY, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function decrypt(encryptedText) {
  if (!encryptedText) return null;
  const text = String(encryptedText);
  if (text.startsWith('v2:')) return decryptGcm(text);
  return decryptLegacyCbc(text);
}

module.exports = { encrypt, decrypt };
