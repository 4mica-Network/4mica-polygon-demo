import { describe, expect, it, vi } from 'vitest';
import { RpcProxy } from '../src/rpc';
import type { FetchFn } from '../src/rpc';
import { RpcError } from '../src/errors';

describe('RpcProxy', () => {
  it('round trips public params', async () => {
    const params = {
      publicKey: [1, 2, 3],
      contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
      ethereumHttpRpcUrl: 'http://localhost:8545',
      eip712Name: '4mica',
      eip712Version: '1',
      chainId: 1337,
    };
    const fetchMock = vi.fn<FetchFn>(async (input) => {
      const url = input.toString();
      expect(url.endsWith('/core/public-params')).toBe(true);
      return new Response(JSON.stringify(params), { status: 200 });
    });

    const proxy = new RpcProxy('http://example.com', undefined, fetchMock);
    const got = await proxy.getPublicParams();
    expect(got.chainId).toBe(1337);
    expect(got.contractAddress).toBe(params.contractAddress);
    expect(got.ethereumHttpRpcUrl).toBe(params.ethereumHttpRpcUrl);
  });

  it('surfaces api errors', async () => {
    const fetchMock = vi.fn<FetchFn>(async (input) => {
      expect(input.toString()).toContain('settlementStatus=unknown');
      return new Response(JSON.stringify({ error: 'invalid settlement status: unknown' }), {
        status: 400,
      });
    });
    const proxy = new RpcProxy('http://example.com', undefined, fetchMock);
    await expect(proxy.listRecipientTabs('0xdeadbeef', ['unknown'])).rejects.toThrow(RpcError);
  });

  it('returns decode error on invalid json', async () => {
    const fetchMock = vi.fn<FetchFn>(async () => {
      return new Response('not-json', { status: 200 });
    });
    const proxy = new RpcProxy('http://example.com', undefined, fetchMock);
    await expect(proxy.getPublicParams()).rejects.toThrow(RpcError);
  });
});
