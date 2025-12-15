import { getAddress, isAddress } from 'ethers';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!url.protocol || !url.host) {
      throw new Error('missing parts');
    }
    return raw;
  } catch {
    throw new ValidationError(`invalid URL: ${raw}`);
  }
}

export function normalizePrivateKey(raw: string): string {
  const key = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new ValidationError('invalid private key (expected 32 byte hex)');
  }
  return `0x${key.toLowerCase()}`;
}

export function normalizeAddress(raw: string): string {
  const candidate: string = String(raw);
  if (isAddress(candidate)) {
    return getAddress(candidate);
  }
  const lower: string = (candidate as string).toLowerCase();
  if (isAddress(lower)) {
    return getAddress(lower);
  }
  throw new ValidationError(`invalid address: ${raw}`);
}

function parseNumericString(raw: string): bigint {
  const text = raw.trim();
  const n = BigInt(text);
  if (n < 0n) {
    throw new ValidationError('u256 cannot be negative');
  }
  return n;
}

export function parseU256(value: number | bigint | string): bigint {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError('invalid integer');
    }
    if (value < 0) {
      throw new ValidationError('u256 cannot be negative');
    }
    return BigInt(value);
  }
  if (typeof value === 'bigint') {
    if (value < 0) {
      throw new ValidationError('u256 cannot be negative');
    }
    return value;
  }
  if (typeof value === 'string') {
    return parseNumericString(value);
  }
  throw new ValidationError(`unsupported numeric type: ${typeof value}`);
}

export function serializeU256(value: number | bigint | string): string {
  return `0x${parseU256(value).toString(16)}`;
}
