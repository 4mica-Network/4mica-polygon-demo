import { describe, expect, it } from 'vitest';
import { PaymentSignature, SigningScheme } from '../src/models';
import { PaymentRequirements, TabResponse, X402Flow } from '../src/x402';
import type { FetchFn } from '../src/rpc';
import { X402Error } from '../src/errors';

class StubSigner {
  async signPayment() {
    return { signature: 'deadbeef', scheme: SigningScheme.EIP712 } as PaymentSignature;
  }
}

class StubX402Flow extends X402Flow {
  protected async requestTab(): Promise<TabResponse> {
    return new TabResponse('2', '0x0000000000000000000000000000000000000001');
  }
}

describe('X402Flow', () => {
  it('rejects invalid scheme', async () => {
    const flow = new StubX402Flow(new StubSigner());
    const requirements = new PaymentRequirements(
      'http+pay',
      'testnet',
      '1',
      '0x0000000000000000000000000000000000000003',
      '0x0000000000000000000000000000000000000000',
      { tabEndpoint: 'https://example.com' }
    );
    await expect(
      flow.signPayment(requirements, '0x0000000000000000000000000000000000000001')
    ).rejects.toThrow(X402Error);
  });

  it('builds header and payload', async () => {
    const flow = new StubX402Flow(new StubSigner());
    const requirements = new PaymentRequirements(
      '4mica+pay',
      'testnet',
      '5',
      '0x0000000000000000000000000000000000000003',
      '0x0000000000000000000000000000000000000000',
      { tabEndpoint: 'https://example.com' }
    );
    const userAddress = '0x0000000000000000000000000000000000000001';
    const signed = await flow.signPayment(requirements, userAddress);
    const decoded = Buffer.from(signed.header, 'base64').toString('utf8');
    const envelope = JSON.parse(decoded);
    expect(envelope.x402Version).toBe(1);
    expect(envelope.scheme).toBe('4mica+pay');
    expect(envelope.payload.claims.tab_id).toBe('0x2');
    expect(signed.claims.tabId).toBe(2n);
    expect(signed.claims.amount).toBe(5n);
  });

  it('settles payment through facilitator', async () => {
    const userAddress = '0x0000000000000000000000000000000000000009';
    const tabEndpoint = 'http://facilitator.test/tab';
    const facilitatorUrl = 'http://facilitator.test';
    const requirements = new PaymentRequirements(
      '4mica+pay',
      'testnet',
      '5',
      '0x00000000000000000000000000000000000000ff',
      '0x0000000000000000000000000000000000000000',
      { tabEndpoint }
    );

    const fetch = async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.pathname === '/tab') {
        const body = JSON.parse(init?.body as string);
        expect(body.userAddress).toBe(userAddress);
        return new Response(JSON.stringify({ tabId: '0x1234', userAddress }), { status: 200 });
      }
      if (u.pathname === '/settle') {
        const payload = JSON.parse(init?.body as string);
        expect(payload.paymentRequirements.payTo).toBe(requirements.payTo);
        return new Response(JSON.stringify({ settled: true, networkId: requirements.network }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    };

    const flow = new X402Flow(new StubSigner(), fetch as FetchFn);
    const payment = await flow.signPayment(requirements, userAddress);
    expect(payment.claims.tabId).toBe(0x1234n);

    const settled = await flow.settlePayment(payment, requirements, facilitatorUrl);
    expect(settled.settlement.settled).toBe(true);
    expect(settled.settlement.networkId).toBe(requirements.network);
    expect(settled.payment.claims.recipientAddress).toBe(requirements.payTo);
  });
});
