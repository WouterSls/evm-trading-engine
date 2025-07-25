import { ethers, Wallet } from "ethers";
import { InputType, TradeConfirmation } from "../../src/trading/types/_index";
import { getEthWallet_1, getHardhatWallet_1 } from "../../src/hooks/useSetup";
import { ChainType, getChainConfig } from "../../src/config/chain-config";
import { createMinimalErc20 } from "../../src/smartcontracts/ERC/erc-utils";
import { TraderFactory } from "../../src/trading/TraderFactory";
import { ITradingStrategy } from "../../src/trading/ITradingStrategy";
import { TradeCreationDto } from "../../src/trading/types/dto/TradeCreationDto";
import { displayTrade } from "../../src/lib/utils";

const PEPE_ADDRESS = "0x6982508145454Ce325dDbE47a25d4ec3d2311933";

async function ethTraderTesting(chain: ChainType, wallet: Wallet) {
  const chainConfig = getChainConfig(chain);

  const blockNumber = await wallet.provider!.getBlockNumber();

  const usdc = await createMinimalErc20(chainConfig.tokenAddresses.usdc, wallet.provider!);
  const weth = await createMinimalErc20(chainConfig.tokenAddresses.weth, wallet.provider!);
  const pepe = await createMinimalErc20(PEPE_ADDRESS, wallet.provider!);
  const usdt = await createMinimalErc20(chainConfig.tokenAddresses.usdt, wallet.provider!);
  const wbtc = await createMinimalErc20(chainConfig.tokenAddresses.wbtc, wallet.provider!);
  const arb = await createMinimalErc20(chainConfig.tokenAddresses.arb, wallet.provider!);

  if (!usdc || !weth || !pepe || !usdt || !wbtc || !arb) throw new Error("Error in ERC20 token setup");

  const usdcBalance = await usdc.getFormattedTokenBalance(wallet.address);
  const wethBalance = await weth.getFormattedTokenBalance(wallet.address);
  const pepeBalance = await pepe.getFormattedTokenBalance(wallet.address);
  const usdtBalance = await usdt.getFormattedTokenBalance(wallet.address);
  const wbtcBalance = await wbtc.getFormattedTokenBalance(wallet.address);
  const arbBalance = await arb.getFormattedTokenBalance(wallet.address);
  const ethBalance = await wallet.provider!.getBalance(wallet.address);

  const trader = await TraderFactory.createTrader(wallet);

  console.log("--------------------------------");
  console.log("Chain", chain);
  console.log("--------------------------------");
  console.log("Block:", blockNumber);
  console.log("Wallet Info:");
  console.log("\twallet address", wallet.address);
  console.log("\tETH balance", ethers.formatEther(ethBalance));
  console.log(`\t${usdc.getSymbol()} (${usdc.getTokenAddress()}) balance: ${usdcBalance}`);
  console.log(`\t${weth.getSymbol()} (${weth.getTokenAddress()}) balance: ${wethBalance}`);
  console.log(`\t${pepe.getSymbol()} (${pepe.getTokenAddress()}) balance: ${pepeBalance}`);
  console.log(`\t${usdt.getSymbol()} (${usdt.getTokenAddress()}) balance: ${usdtBalance}`);
  console.log(`\t${wbtc.getSymbol()} (${wbtc.getTokenAddress()}) balance: ${wbtcBalance}`);
  console.log(`\t${arb.getSymbol()} (${arb.getTokenAddress()}) balance: ${arbBalance}`);
  console.log();

  const multiHopTrade: TradeCreationDto = {
    chain: chain,
    inputType: InputType.TOKEN,
    inputToken: pepe.getTokenAddress(),
    inputAmount: "1000",
    outputToken: arb.getTokenAddress(),
  };

  const singleHopTrade = {
    chain: chain,
    inputType: InputType.TOKEN,
    inputToken: pepe.getTokenAddress(),
    inputAmount: "20000",
    outputToken: wbtc.getTokenAddress(),
  };

  const buyPepe = {
    chain: chain,
    inputType: InputType.USD,
    inputToken: ethers.ZeroAddress,
    inputAmount: "500",
    outputToken: pepe.getTokenAddress(),
  };

  const sellPepeToEth: TradeCreationDto = {
    chain: chain,
    inputType: InputType.TOKEN,
    inputToken: pepe.getTokenAddress(),
    inputAmount: "5000000",
    outputToken: ethers.ZeroAddress,
  };

  /**
  const quote = await trader.quote(multiHopTrade);
  console.log("QUOTE:");
  console.log(quote);
 */

  await displayTrade(singleHopTrade);
  const tradeConfirmation: TradeConfirmation = await trader.trade(multiHopTrade);
  console.log("--------------------------------");
  console.log("Trade Confirmation");
  console.log("--------------------------------");
  console.log("\tStrategy", tradeConfirmation.quote.strategy);
  console.log("\tRoute: ", tradeConfirmation.quote.route.path);
  console.log("\tGas Spent:", tradeConfirmation.gasCost);
  console.log("\tETH Spent:", tradeConfirmation.ethSpentFormatted);
  console.log("\tETH Received:", tradeConfirmation.ethReceivedFormatted);
  console.log("\tTokens Spent:", tradeConfirmation.tokensSpentFormatted);
  console.log("\tTokens Received:", tradeConfirmation.tokensReceivedFormatted);
  console.log("\tTransaction Hash:", tradeConfirmation.transactionHash);
  console.log();

  //const strategies = trader.getStrategies();
  //const uniV2 = strategies.filter((strat) => strat.getName().toLowerCase().includes("uniswapv2"))[0];
  //const uniV3 = strategies.filter((strat) => strat.getName().toLowerCase().includes("uniswapv3"))[0];
  //const uniV4 = strategies.filter((strat) => strat.getName().toLowerCase().includes("uniswapv4"))[0];
  //await strategyTest([singleHopTrade], uniV3, wallet);
}

async function strategyTest(trades: TradeCreationDto[], strat: ITradingStrategy, wallet: Wallet) {
  if (!strat) throw new Error("NO TRADING STRAT SUPPLIED");

  for (const trade of trades) {
    console.log();
    console.log("QUOTE");
    console.log("----------------");
    const quote = await strat.getQuote(trade, wallet);
    console.log(quote);
    console.log();

    await strat.ensureTokenApproval(trade.inputToken, trade.inputAmount, wallet);

    console.log();
    console.log("TX");
    console.log("----------------");
    const tx = await strat.createTransaction(trade, wallet);
    console.log(tx);

    console.log("SENDING...");
    const response = await wallet.sendTransaction(tx);
    const receipt = await response.wait();

    if (!receipt || receipt!.status !== 1) {
      console.log("ERROR DURING TRANSACTION");
    } else {
      console.log("TRANSACTION CONFIRMED");
    }
  }
}

if (require.main === module) {
  const chain = ChainType.ETH;

  const wallet = getHardhatWallet_1();
  const ethWallet = getEthWallet_1();

  ethTraderTesting(chain, wallet).catch(console.error);
}
