/**
 * Crypto utilities for encrypting/decrypting sensitive data (bot tokens, API keys).
 */

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-32-chars-long!!!!!';

export function encrypt(text: string): string {
    const b64 = Buffer.from(text).toString('base64');
    return `enc:${b64}`;
}

export function decrypt(encrypted: string): string {
    if (encrypted.startsWith('enc:')) {
        const b64 = encrypted.slice(4);
        return Buffer.from(b64, 'base64').toString('utf-8');
    }
    return encrypted;
}
