/**
 * AES-256-GCM encryption for Google OAuth tokens.
 * Uses ENCRYPTION_KEY from env (must be 32+ chars).
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

function getKey(): Buffer {
    const raw = process.env.ENCRYPTION_KEY || '';
    if (!raw || raw.length < 16) {
        throw new Error('ENCRYPTION_KEY must be set (min 16 chars)');
    }
    // Derive a 32-byte key via SHA-256
    return createHash('sha256').update(raw).digest();
}

/**
 * Encrypt plaintext → "aes:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
export function encryptToken(plaintext: string): string {
    const key = getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `aes:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt "aes:<iv_hex>:<authTag_hex>:<ciphertext_hex>" → plaintext
 */
export function decryptToken(encrypted: string): string {
    if (!encrypted.startsWith('aes:')) {
        throw new Error('Invalid encrypted token format');
    }
    const parts = encrypted.split(':');
    if (parts.length !== 4) {
        throw new Error('Invalid encrypted token format');
    }
    const key = getKey();
    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const ciphertext = Buffer.from(parts[3], 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}
