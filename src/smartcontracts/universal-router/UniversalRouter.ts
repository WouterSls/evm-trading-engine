import { Contract, ethers, TransactionRequest, Wallet, AbiCoder } from "ethers";
import { ChainType, getChainConfig } from "../../config/chain-config";
import { UNIVERSAL_ROUTER_INTERFACE } from "../../lib/smartcontract-abis/_index";
import { validateNetwork } from "../../lib/utils";
import {
  CommandType,
  IV4ExactInputSingleParams,
  IV4SettleParams,
  IV4TakeParams,
  V4PoolAction,
  V4PoolActionConstants,
} from "./universal-router-types";
import { PoolKey } from "../uniswap-v4/uniswap-v4-types";
import {
  encodeExactInputSingleSwapParams,
  encodeSettleParams,
  encodeSwapCommandInput,
  encodeTakeParams,
} from "./universal-router-utils";

export class UniversalRouter {
  private routerContract: Contract;
  private routerAddress: string;

  // Contract

  constructor(private chain: ChainType) {
    const chainConfig = getChainConfig(chain);

    this.routerAddress = chainConfig.uniswap.universalRouterAddress;

    if (!this.routerAddress || this.routerAddress.trim() === "") {
      throw new Error(`Universal Router address not defined for chain: ${chainConfig.name}`);
    }

    this.routerContract = new ethers.Contract(this.routerAddress, UNIVERSAL_ROUTER_INTERFACE);
  }

  getRouterAddress = () => this.routerAddress;

  /**
   * Validates that the address is actually a Universal Router by checking if it implements the required interface
   * @param wallet Wallet instance -> blockchain provider
   * @returns true if the initialized router address is a valid Universal Router, false otherwise
   */
  async validateIsRouter(wallet: Wallet): Promise<boolean> {
    this.routerContract = this.routerContract.connect(wallet) as Contract;

    const isValid = await this._networkAndRouterCheck(wallet);
    if (!isValid) {
      throw new Error(`Address ${this.routerContract.address} is not a valid Uniswap V4 Universal Router`);
    }

    return isValid;
  }

  /**
   * Create an execute transaction
   * @param wallet The wallet to execute the commands with
   * @param commands concatenated commands to execute in order
   * @param inputs list of encoded inputs for each command
   * @returns Transaction request
   */
  createExecuteTransaction(commands: string, inputs: string[], deadline?: number): TransactionRequest {
    const dl = deadline ?? Math.floor(Date.now() / 1000) + 1200;

    const encodedData = this.routerContract.interface.encodeFunctionData("execute", [commands, inputs, dl]);

    const tx: TransactionRequest = {
      to: this.routerAddress,
      data: encodedData,
    };

    return tx;
  }

  //TODO: turn into utils function and extract ecndoing to UniswapV4 router
  /**
   * Create a bytes input for a V4_SWAP command using SWAP_EXACT_INPUT_SINGLE
   * @param poolKey The pool key for the swap
   * @param zeroForOne trade first for second token | boolean
   * @param rawInputAmount input amount parsed with tokens decimals
   * @param minOutputAmount minimum output amount wanted for the trade
   * @param recipient recipient of output tokens
   * @returns The encoded bytes input
   */
  encodeV4SwapInput(
    poolKey: PoolKey,
    zeroForOne: boolean,
    rawInputAmount: string,
    minOutputAmount: bigint,
    recipient: string,
  ): string {
    // Encode the 3 actions required to execute a V4 swap into a single input
    // 1) swap -> SWAP_EXACT_INPUT_SINGLE (0x06)
    // 2) settle -> SETTLE_ALL (0x0c)
    // 3) take -> TAKE_ALL (0x0f)

    const inputAmount = BigInt(rawInputAmount);
    const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
    const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;

    const swapAction = V4PoolAction.SWAP_EXACT_IN_SINGLE;
    const swapParams = {
      poolKey: poolKey,
      zeroForOne: zeroForOne,
      amountIn: inputAmount,
      amountOutMinimum: minOutputAmount ?? 0n,
      hookData: ethers.ZeroAddress,
    };
    const encodedSwapParams = encodeExactInputSingleSwapParams(swapParams);

    const settleAction = V4PoolAction.SETTLE;
    const settleParams = {
      inputCurrency: inputCurrency,
      amountIn: inputAmount,
      bool: zeroForOne,
    };
    const encodedSettleParams = encodeSettleParams(settleParams);

    const takeAction = V4PoolAction.TAKE;
    const takeParams = {
      outputCurrency: outputCurrency,
      recipient: recipient,
      amount: V4PoolActionConstants.OPEN_DELTA,
    };
    const encodedTakeParams = encodeTakeParams(takeParams);

    const actions = ethers.concat([swapAction, settleAction, takeAction]);
    const encodedInput = encodeSwapCommandInput(actions, encodedSwapParams, encodedSettleParams, encodedTakeParams);

    return encodedInput;
  }

  /**
   * Validates that the wallet is on the correct network and that the router address is valid
   * @param wallet Wallet instance -> blockchain provider
   * @returns true if the wallet is on the correct network and the router address is valid
   */
  private async _networkAndRouterCheck(wallet: Wallet): Promise<boolean> {
    try {
      await validateNetwork(wallet, this.chain);

      const code = await wallet.provider!.getCode(this.routerAddress);
      if (code === "0x" || code === "0x0") {
        throw new Error(`No contract found at router address: ${this.routerAddress}`);
      }

      const deadline = Math.floor(Date.now() / 1000) + 1200;
      await this.routerContract.execute.staticCall("0x", [], deadline);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      const revertDataError =
        errorMessage.includes("missing revert data") || errorMessage.includes("execution reverted");

      const functionNotFoundError =
        errorMessage.includes("function not found") ||
        errorMessage.includes("not a function") ||
        errorMessage.includes("unknown function");

      const missingProviderError =
        errorMessage.toLowerCase().includes("cannot read property") ||
        errorMessage.toLowerCase().includes("cannot read properties") ||
        errorMessage.includes("missing provider");

      if (revertDataError) {
        return true;
      }

      if (functionNotFoundError) {
        throw new Error(`Contract at ${this.routerAddress} is not a Uniswap Universal Router`);
      }

      if (missingProviderError) {
        throw new Error(`Wallet has missing provider: ${errorMessage}`);
      }

      throw new Error(`${errorMessage}`);
    }
  }
}
