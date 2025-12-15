import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConfigBuilder } from '../src/config';
import { ConfigError } from '../src/errors';

describe('ConfigBuilder', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('reads from env', () => {
    process.env['4MICA_RPC_URL'] = 'https://example.com';
    process.env['4MICA_WALLET_PRIVATE_KEY'] = '11'.repeat(32);
    const cfg = new ConfigBuilder().fromEnv().build();
    expect(cfg.rpcUrl).toBe('https://example.com');
    expect(cfg.walletPrivateKey.startsWith('0x11')).toBe(true);
  });

  it('requires private key', () => {
    delete process.env['4MICA_WALLET_PRIVATE_KEY'];
    const builder = new ConfigBuilder().fromEnv();
    expect(() => builder.build()).toThrow(ConfigError);
  });

  it('rejects invalid private key', () => {
    const builder = new ConfigBuilder().walletPrivateKey('0x1234');
    expect(() => builder.build()).toThrow(ConfigError);
  });
});
