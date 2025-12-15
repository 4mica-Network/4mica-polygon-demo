import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  normalizeAddress,
  normalizePrivateKey,
  parseU256,
  serializeU256,
  validateUrl,
} from '../src/utils';

describe('utils', () => {
  it('validateUrl rejects bad input', () => {
    expect(() => validateUrl('not-a-url')).toThrow(ValidationError);
  });

  it('normalizePrivateKey strips prefix and lowercases', () => {
    const key = normalizePrivateKey('0xABCDEF' + '0'.repeat(58));
    expect(key).toBe('0xabcdef' + '0'.repeat(58));
  });

  it('parseU256 accepts hex strings and serializes back', () => {
    const value = parseU256('0x10');
    expect(value).toBe(16n);
    expect(serializeU256(value)).toBe('0x10');
  });

  it('normalizeAddress round trips checksum', () => {
    const addr = '0x0000000000000000000000000000000000000001';
    expect(normalizeAddress(addr)).toBe('0x0000000000000000000000000000000000000001');
  });

  it('parseU256 rejects negatives', () => {
    expect(() => parseU256(-1)).toThrow(ValidationError);
  });
});
