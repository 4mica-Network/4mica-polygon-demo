import {
  Contract,
  InterfaceAbi,
  JsonRpcProvider,
  Wallet,
  getBytes,
  hexlify,
  toBeHex,
} from 'ethers';
import core4micaAbi from './abi/core4mica.json';
import erc20Abi from './abi/erc20.json';
import { ContractError } from './errors';
import { parseU256 } from './utils';

type ContractFactory = (address: string, abi: unknown, signer: Wallet) => Contract;

export class ContractGateway {
  readonly provider: JsonRpcProvider;
  readonly wallet: Wallet;
  readonly contract: Contract;
  private erc20Cache: Map<string, Contract> = new Map();

  constructor(
    ethRpcUrl: string,
    privateKey: string,
    contractAddress: string,
    chainId: number | bigint,
    provider?: JsonRpcProvider,
    contractFactory?: ContractFactory
  ) {
    const parsedChainId = Number(chainId);
    if (!Number.isFinite(parsedChainId)) {
      throw new ContractError(`invalid chain id: ${chainId}`);
    }
    const networkish = { chainId: parsedChainId, name: `chain-${parsedChainId}` };
    this.provider = provider ?? new JsonRpcProvider(ethRpcUrl, networkish);
    this.wallet = new Wallet(privateKey, this.provider);
    const factory: ContractFactory =
      contractFactory ??
      ((addr, abi, signer) => {
        const resolvedAbi = (abi as { abi?: InterfaceAbi }).abi ?? (abi as InterfaceAbi);
        return new Contract(addr, resolvedAbi as InterfaceAbi, signer);
      });
    this.contract = factory(contractAddress, core4micaAbi, this.wallet);
  }

  async getChainId(): Promise<number> {
    const network = await this.provider.getNetwork();
    return Number(network.chainId);
  }

  private erc20(address: string): Contract {
    const checksum = address;
    if (!this.erc20Cache.has(checksum)) {
      this.erc20Cache.set(checksum, new Contract(checksum, erc20Abi.abi ?? erc20Abi, this.wallet));
    }
    return this.erc20Cache.get(checksum)!;
  }

  private async send<T>(promise: Promise<unknown>): Promise<T> {
    try {
      const tx = await promise;
      if (typeof (tx as { wait?: unknown }).wait === 'function') {
        return await (tx as { wait: () => Promise<T> }).wait();
      }
      return tx as T;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ContractError(message);
    }
  }

  async getGuaranteeDomain(): Promise<string> {
    return this.send<string>(this.contract.guaranteeDomainSeparator());
  }

  async approveErc20(token: string, amount: number | bigint | string): Promise<unknown> {
    const erc20 = this.erc20(token);
    const { target, address } = this.contract as { target?: string; address?: string };
    const spender = target ?? address ?? token;
    return this.send(erc20.approve(spender, parseU256(amount)));
  }

  async deposit(amount: number | bigint | string, erc20Token?: string): Promise<unknown> {
    if (erc20Token) {
      return this.send(this.contract.depositStablecoin(erc20Token, parseU256(amount)));
    }
    return this.send(
      this.contract.deposit({
        value: parseU256(amount),
      })
    );
  }

  async getUserAssets(): Promise<
    {
      asset: string;
      collateral: bigint;
      withdrawal_request_timestamp: bigint;
      withdrawal_request_amount: bigint;
    }[]
  > {
    try {
      const result = await this.contract.getUserAllAssets(this.wallet.address);
      return (
        result as Array<
          [string, number | bigint | string, number | bigint | string, number | bigint | string]
        >
      ).map((asset) => ({
        asset: asset[0],
        collateral: parseU256(asset[1]),
        withdrawal_request_timestamp: parseU256(asset[2]),
        withdrawal_request_amount: parseU256(asset[3]),
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ContractError(message);
    }
  }

  async getPaymentStatus(tabId: number | bigint): Promise<{
    paid: bigint;
    remunerated: boolean;
    asset: string;
  }> {
    try {
      const [paid, remunerated, asset] = await this.contract.getPaymentStatus(parseU256(tabId));
      return {
        paid: parseU256(paid),
        remunerated: Boolean(remunerated),
        asset,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ContractError(message);
    }
  }

  async payTabEth(
    tabId: number | bigint,
    reqId: number | bigint,
    amount: number | bigint | string,
    recipient: string
  ): Promise<unknown> {
    const data = Buffer.from(
      `tab_id:${toBeHex(parseU256(tabId))};req_id:${toBeHex(parseU256(reqId))}`
    );
    const tx = {
      to: recipient,
      value: parseU256(amount),
      data: hexlify(data),
    };
    return this.send(this.wallet.sendTransaction(tx));
  }

  async payTabErc20(
    tabId: number | bigint,
    amount: number | bigint | string,
    erc20Token: string,
    recipient: string
  ): Promise<unknown> {
    return this.send(
      this.contract.payTabInERC20Token(parseU256(tabId), erc20Token, parseU256(amount), recipient)
    );
  }

  async requestWithdrawal(amount: number | bigint | string, erc20Token?: string): Promise<unknown> {
    if (erc20Token) {
      return this.send(this.contract.requestWithdrawal(erc20Token, parseU256(amount)));
    }
    return this.send(this.contract.requestWithdrawal(parseU256(amount)));
  }

  async cancelWithdrawal(erc20Token?: string): Promise<unknown> {
    if (erc20Token) {
      return this.send(this.contract.cancelWithdrawal(erc20Token));
    }
    return this.send(this.contract.cancelWithdrawal());
  }

  async finalizeWithdrawal(erc20Token?: string): Promise<unknown> {
    if (erc20Token) {
      return this.send(this.contract.finalizeWithdrawal(erc20Token));
    }
    return this.send(this.contract.finalizeWithdrawal());
  }

  async remunerate(claimsBlob: Uint8Array, signatureWords: Uint8Array[]): Promise<unknown> {
    const sigStruct = signatureWords.map((word) => hexlify(getBytes(word)));
    return this.send(this.contract.remunerate(hexlify(claimsBlob), sigStruct));
  }
}
