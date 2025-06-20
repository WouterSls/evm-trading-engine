import { ethers, TransactionRequest, Wallet } from "ethers";
import { ChainType, getChainConfig } from "../../../config/chain-config";

import { FeeAmount, FeeToTickSpacing, PoolKey } from "../../smartcontracts/uniswap-v4/uniswap-v4-types";
import {
  ensureInfiniteApproval,
  ensureStandardApproval,
  ensurePermit2Approval,
} from "../../../lib/approval-strategies";

import { ITradingStrategy } from "../ITradingStrategy";
import { BuyTradeCreationDto, SellTradeCreationDto, Quote, InputType, Route } from "../types/_index";
import { createMinimalErc20 } from "../../smartcontracts/ERC/erc-utils";
import { validateNetwork } from "../../../lib/utils";
import { TRADING_CONFIG } from "../../../config/trading-config";
import { UniswapV4Quoter } from "../../smartcontracts/uniswap-v4/UniswapV4Quoter";
import {
  UniswapV4Router,
  SwapExactInputSingleParams,
  SettleAllParams,
  TakeAllParams,
} from "../../smartcontracts/uniswap-v4/UniswapV4Router";
import { UniversalRouter } from "../../smartcontracts/universal-router/UniversalRouter";
import {
  CommandType,
  V4PoolAction,
  V4PoolActionConstants,
} from "../../smartcontracts/universal-router/universal-router-types";
import { encodeSettleParams, encodeTakeParams } from "../../smartcontracts/universal-router/universal-router-utils";
import { RouteOptimizer } from "../../routing/RouteOptimizer";

export class UniswapV4Strategy implements ITradingStrategy {
  private quoter: UniswapV4Quoter;
  private uniswapV4router: UniswapV4Router;
  private universalRouter: UniversalRouter;

  private routeOptimzer: RouteOptimizer;

  private WETH_ADDRESS: string;
  private USDC_ADDRESS: string;

  private WETH_DECIMALS = 18;
  private USDC_DECIMALS = 6;

  constructor(
    private strategyName: string,
    private chain: ChainType,
  ) {
    const chainConfig = getChainConfig(chain);

    this.WETH_ADDRESS = chainConfig.tokenAddresses.weth;
    this.USDC_ADDRESS = chainConfig.tokenAddresses.usdc;

    this.quoter = new UniswapV4Quoter(chain);
    this.uniswapV4router = new UniswapV4Router();
    this.universalRouter = new UniversalRouter(chain);

    this.routeOptimzer = new RouteOptimizer(chain);
  }

  /**
   * Gets the name of this trading strategy
   * @returns The strategy name
   */
  getName = (): string => this.strategyName;

  /**
   * Ensures token approval for trading operations
   * @param wallet Connected wallet to use for approval
   * @param tokenAddress Address of the token to approve
   * @param amount Amount to approve (threshold validation or standard approval calculation )
   * @returns gas cost of approval if needed , null if already approved
   */
  async ensureTokenApproval(wallet: Wallet, tokenAddress: string, amount: string): Promise<string | null> {
    await validateNetwork(wallet, this.chain);
    const spender = this.universalRouter.getRouterAddress();
    if (TRADING_CONFIG.INFINITE_APPROVAL) {
      return await ensureInfiniteApproval(wallet, tokenAddress, amount, spender);
    } else {
      return await ensureStandardApproval(wallet, tokenAddress, amount, spender);
    }
  }

  /**
   * Gets the current ETH price in USDC
   * @param wallet Connected wallet to query the price
   * @returns ETH price in USDC as a string
   */
  async getEthUsdcPrice(wallet: Wallet): Promise<string> {
    await validateNetwork(wallet, this.chain);

    const tokenIn = ethers.ZeroAddress;
    const tokenOut = this.USDC_ADDRESS;
    const fee = FeeAmount.LOW;
    const tickSpacing = FeeToTickSpacing.get(fee)!;

    const poolKey: PoolKey = {
      currency0: tokenIn,
      currency1: tokenOut,
      fee: fee,
      tickSpacing: tickSpacing,
      hooks: ethers.ZeroAddress,
    };
    const zeroForOne = true;
    const exactAmount = ethers.parseEther("1");
    const hookData = ethers.ZeroAddress;

    const { amountOut, gasEstimate } = await this.quoter.quoteExactInputSingle(
      wallet,
      poolKey,
      zeroForOne,
      exactAmount,
      hookData,
    );

    const formattedAmountOut = ethers.formatUnits(amountOut, this.USDC_DECIMALS);

    return formattedAmountOut;
  }

  async getBuyTradeQuote(wallet: Wallet, trade: BuyTradeCreationDto): Promise<Quote> {
    await validateNetwork(wallet, this.chain);

    const outputToken = await createMinimalErc20(trade.outputToken, wallet.provider!);

    let outputAmount = "0";
    let priceImpact = 0;
    let route: Route = {
      path: [],
      fees: [],
      encodedPath: null,
      poolKey: null,
    };

    const isETHInputETHAmount = trade.inputType === InputType.ETH && trade.inputToken === ethers.ZeroAddress;
    const isETHInputUSDAmount = trade.inputType === InputType.USD && trade.inputToken === ethers.ZeroAddress;
    const isTOKENInputTOKENAmount = trade.inputType === InputType.TOKEN && trade.inputToken !== ethers.ZeroAddress;

    if (isETHInputETHAmount) {
      const amountIn = ethers.parseEther(trade.inputAmount);
      const hookData = ethers.ZeroAddress;

      route = await this.routeOptimzer.uniV4GetOptimizedRoute(trade.inputToken, outputToken.getTokenAddress());

      if (!route.poolKey) {
        return {
          outputAmount,
          priceImpact,
          route,
        };
      }

      const isZeroForOne = route.poolKey.currency0 === trade.inputToken;

      const { amountOut, gasEstimate } = await this.quoter.quoteExactInputSingle(
        wallet,
        route.poolKey,
        isZeroForOne,
        amountIn,
        hookData,
      );

      outputAmount = ethers.formatUnits(amountOut, outputToken.getDecimals());
    }

    if (isETHInputUSDAmount) {
    }

    if (isTOKENInputTOKENAmount) {
    }

    return {
      outputAmount,
      priceImpact,
      route,
    };
  }

  async getSellTradeQuote(wallet: Wallet, trade: SellTradeCreationDto): Promise<Quote> {
    throw new Error("Not implemented");
  }

  async createBuyTransaction(wallet: Wallet, trade: BuyTradeCreationDto): Promise<TransactionRequest> {
    await validateNetwork(wallet, this.chain);

    const outputToken = await createMinimalErc20(trade.outputToken, wallet.provider!);

    const recipient = wallet.address;
    const deadline = TRADING_CONFIG.DEADLINE;

    let tx: TransactionRequest = {};

    const isETHInputETHAmount = trade.inputType === InputType.ETH && trade.inputToken === ethers.ZeroAddress;
    const isETHInputUSDAmount = trade.inputType === InputType.USD && trade.inputToken === ethers.ZeroAddress;
    const isTOKENInputTOKENAmount = trade.inputType === InputType.TOKEN && trade.inputToken !== ethers.ZeroAddress;

    if (isETHInputETHAmount) {
      const tokenIn = trade.inputToken;
      const tokenOut = outputToken.getTokenAddress();

      const route = await this.routeOptimzer.uniV4GetOptimizedRoute(tokenIn, tokenOut);
      const poolKey = route.poolKey;
      const hookData = ethers.ZeroAddress;

      const zeroForOne = poolKey!.currency0 === tokenIn;

      const amountIn = ethers.parseEther(trade.inputAmount);
      const minOutputAmount = 0n;

      const isSingleHop = route.path.length === 2 && route.poolKey;
      const isMultiHop = route.path.length > 2 && route.poolKey;

      if (isSingleHop) {
        const actions = ethers.concat([V4PoolAction.SWAP_EXACT_IN_SINGLE, V4PoolAction.SETTLE, V4PoolAction.TAKE]);

        const swapParams: SwapExactInputSingleParams = [
          route.poolKey!,
          zeroForOne,
          amountIn,
          minOutputAmount,
          hookData,
        ];
        const swapData = this.uniswapV4router.encodePoolAction(V4PoolAction.SWAP_EXACT_IN_SINGLE, swapParams);

        const inputCurrency = zeroForOne ? route.poolKey!.currency0 : route.poolKey!.currency1;
        const settleParams = { inputCurrency, amountIn, bool: zeroForOne };
        const settleData = encodeSettleParams(settleParams);

        const outputCurrency = zeroForOne ? route.poolKey!.currency1 : route.poolKey!.currency0;
        const takeParams = { outputCurrency, recipient, amount: V4PoolActionConstants.OPEN_DELTA };
        const takeData = encodeTakeParams(takeParams);

        const command: CommandType = CommandType.V4_SWAP;
        const v4SwapInput = this.uniswapV4router.encodeV4SwapCommandInput(actions, [swapData, settleData, takeData]);

        tx = this.universalRouter.createExecuteTransaction(command, [v4SwapInput], deadline);
        tx.value = amountIn;
        return tx;
      }

      if (isMultiHop) {
      }
    }

    if (isETHInputUSDAmount) {
      const ethUsdcPrice = await this.getEthUsdcPrice(wallet);
      const ethValue = parseFloat(trade.inputAmount) / parseFloat(ethUsdcPrice);
      const ethValueFixed = ethValue.toFixed(18);
      const amountIn = ethers.parseEther(ethValueFixed);
    }

    if (isTOKENInputTOKENAmount) {
      const tokenIn = await createMinimalErc20(trade.inputToken, wallet.provider!);
      const amountIn = ethers.parseUnits(trade.inputAmount, tokenIn.getDecimals());
    }

    return tx;
  }

  async createSellTransaction(wallet: Wallet, trade: SellTradeCreationDto): Promise<TransactionRequest> {
    return new Promise((resolve, reject) => {
      reject(new Error("Not implemented"));
    });
  }
}
