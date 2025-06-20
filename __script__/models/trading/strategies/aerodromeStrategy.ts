import { ethers, Wallet } from "ethers";
import {
  BuyTradeCreationDto,
  InputType,
  OutputType,
  SellTradeCreationDto,
} from "../../../../src/models/trading/types/_index";
import { getBaseWallet_1, getHardhatWallet_1 } from "../../../../src/hooks/useSetup";
import { ChainType, getChainConfig } from "../../../../src/config/chain-config";
import { createMinimalErc20 } from "../../../../src/models/smartcontracts/ERC/erc-utils";
import { AerodromeStrategy } from "../../../../src/models/trading/strategies/AerodromeStrategy";

async function aerodromeStrategyInteraction(
  chain: ChainType,
  wallet: Wallet,
  buyTrade?: BuyTradeCreationDto,
  sellTrade?: SellTradeCreationDto,
) {
  const chainConfig = getChainConfig(chain);

  const aeroStrat = new AerodromeStrategy(`Aerodrome-${chain}`, chain);

  const usdcAddress = chainConfig.tokenAddresses.usdc;
  const wethAddress = chainConfig.tokenAddresses.weth;
  const usdc = await createMinimalErc20(usdcAddress, wallet.provider!);
  const weth = await createMinimalErc20(wethAddress, wallet.provider!);

  const usdcBalance = await usdc.getFormattedTokenBalance(wallet.address);
  const wethBalance = await weth.getFormattedTokenBalance(wallet.address);
  const ethBalance = await wallet.provider!.getBalance(wallet.address);

  console.log("--------------------------------");
  console.log("Chain", chain);
  console.log("--------------------------------");
  console.log("Wallet Info:");
  console.log("\twallet address", wallet.address);
  console.log("\tETH balance", ethers.formatEther(ethBalance));
  console.log(`\t${usdc.getSymbol()} balance: ${usdcBalance}`);
  console.log(`\t${weth.getSymbol()} balance: ${wethBalance}`);
  console.log();

  //console.log("Buy Trade:", JSON.stringify(buyTrade, null, 2));
  //console.log();

  const ethUsdcPrice = await aeroStrat.getEthUsdcPrice(wallet);
  console.log("Strat:", aeroStrat.getName());
  console.log("ETH/USDC price:", ethUsdcPrice);

  //console.log("quoting trade...");
  //console.log("Input type: ", buyTrade?.inputType);
  //console.log("Input token: ", buyTrade?.inputToken);
  //console.log("Input amount: ", buyTrade?.inputAmount);
  //const tradeQuote = await strat.getBuyTradeQuote(wallet, buyTrade!);
  //console.log("Trade Quote:", JSON.stringify(tradeQuote, null, 2));
}

if (require.main === module) {
  const chain = ChainType.BASE;
  const chainConfig = getChainConfig(chain);
  const wallet = getBaseWallet_1();

  const inputType = InputType.ETH;
  const tokenA = ethers.ZeroAddress;
  const amountA = "1";

  const tokenB = chainConfig.tokenAddresses.usdc;
  const amountB = "100";
  const tpPrice = "1";

  const buyTrade: BuyTradeCreationDto = {
    tradeType: "BUY",
    chain: chain,
    inputType: inputType,
    inputToken: tokenA,
    inputAmount: amountA.toString(),
    outputToken: tokenB,
  };

  const sellTrade: SellTradeCreationDto = {
    tradeType: "SELL",
    chain: chain,
    inputToken: tokenB,
    inputAmount: amountB.toString(),
    outputType: OutputType.ETH,
    outputToken: ethers.ZeroAddress,
    tradingPointPrice: tpPrice,
  };

  aerodromeStrategyInteraction(chain, wallet, buyTrade, sellTrade).catch(console.error);
}
