import { createHash } from 'node:crypto';

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function shortHash(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}
