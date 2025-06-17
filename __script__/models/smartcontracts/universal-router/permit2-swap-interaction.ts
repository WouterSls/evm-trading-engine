import {  ethers, Wallet } from "ethers";
import { getHardhatWallet_1 } from "../../../../src/hooks/useSetup";
import { ChainConfig, ChainType, getChainConfig } from "../../../../src/config/chain-config";
import { UniversalRouter } from "../../../../src/models/smartcontracts/universal-router/UniversalRouter";
import {
  CommandType,
  IPermitSingle,
  IPermitTransferFrom,
} from "../../../../src/models/smartcontracts/universal-router/universal-router-types";
import { OutputType, SellTradeCreationDto } from "../../../../src/models/trading/types/_index";
import { decodeLogs } from "../../../../src/lib/utils";
import { UniswapV2RouterV2 } from "../../../../src/models/smartcontracts/uniswap-v2/UniswapV2RouterV2";
import { getLowPoolKey } from "../../../../src/models/smartcontracts/uniswap-v4/uniswap-v4-utils";
import {
  encodePermitSingleInput,
  encodePermitTransferFromInput,
} from "../../../../src/models/smartcontracts/universal-router/universal-router-utils";
import { Permit2 } from "../../../../src/models/smartcontracts/permit2/Permit2";
import { ERC20, createMinimalErc20 } from "../../../../src/models/smartcontracts/ERC/_index";

async function verifyOrGrantMaxUnitAllowance(wallet: Wallet, token: ERC20, spender: string) {
  const permit2Allowance = await token.getRawAllowance(wallet.address, spender);
  console.log("Permit2 Allowance: ", permit2Allowance);
  if (permit2Allowance <= 0n) {
    console.log("Approving...");
    const approveTx = await token.createApproveTransaction(spender, ethers.MaxUint256);
    const approveTxResponse = await wallet.sendTransaction(approveTx);
    const approveTxReceipt = await approveTxResponse.wait();
    if (!approveTxReceipt) {
      throw new Error("Approve tx failed");
    }
    console.log("Approved!");
  }
}

async function testPermit2TransferFrom(wallet: Wallet, chain: ChainType) {
  const chainConfig = getChainConfig(chain);
  const router = new UniversalRouter(chain);

  const usdcInputAmount = ethers.parseUnits("50", 6);
  const usdcAddress = chainConfig.tokenAddresses.usdc;

  const permitTransferFrom: IPermitTransferFrom = {
    //from: wallet.address,
    token: usdcAddress,
    recipient: router.getRouterAddress(),
    amount: usdcInputAmount,
  };

  const command = CommandType.PERMIT2_TRANSFER_FROM;
  console.log("transfer command:", command);
  const input = encodePermitTransferFromInput(permitTransferFrom);

  const tx = await router.createExecuteTransaction(command, [input]);
  const res = await wallet.sendTransaction(tx);
  const receipt = await res.wait();
  if (!receipt) throw new Error("Trasnaction failed");
  console.log("transfer from transaction passed");
}

export async function v4SwapInteraction(wallet: Wallet, tradeCreationDto: SellTradeCreationDto) {
  const chain: ChainType = tradeCreationDto.chain as ChainType;
  const chainConfig: ChainConfig = getChainConfig(chain);
  const outputTokenAddress = tradeCreationDto.outputToken;

  const router = new UniversalRouter(chain);
  const v2Router = new UniswapV2RouterV2(chain);
  const permit2 = new Permit2(chain);

  const usdcAddress = chainConfig.tokenAddresses.usdc;
  const wethAddress = chainConfig.tokenAddresses.weth;
  const usdc = await createMinimalErc20(usdcAddress, wallet.provider!);
  const weth = await createMinimalErc20(wethAddress, wallet.provider!);

  //console.log("Swapping ETH for USDC...");
  //await v2Router.swapEthInUsdForToken(wallet, usdc, 200);

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

  // Preconditions
  const deadline = Math.floor(Date.now() / 1000) + 1200;

  await verifyOrGrantMaxUnitAllowance(wallet, usdc, permit2.getPermit2Address());

  //await testPermit2TransferFrom(wallet, chain);

  // Permit2 Permit -> Permit router contract
  const nonce = await permit2.getPermit2Nonce(
    wallet,
    wallet.address,
    usdc.getTokenAddress(),
    router.getRouterAddress(),
  );
  const permitSingle: IPermitSingle = {
    details: {
      token: usdc.getTokenAddress(),
      amount: BigInt(tradeCreationDto.inputAmount),
      expiration: deadline,
      nonce: nonce,
    },
    spender: router.getRouterAddress(),
    sigDeadline: deadline,
  };
  const signature = await permit2.getPermitSingleSignature(wallet, permitSingle);

  const permit2PermitCommand = CommandType.PERMIT2_PERMIT;
  const permit2Input = encodePermitSingleInput(permitSingle, signature);

  // Permit2 Transfer From -> Move tokens to router contract
  const permitTransferFrom: IPermitTransferFrom = {
    token: usdc.getTokenAddress(),
    recipient: router.getRouterAddress(),
    amount: BigInt(tradeCreationDto.inputAmount),
  };

  const permit2TransferFromCommand = CommandType.PERMIT2_TRANSFER_FROM;
  const permit2TransferFromInput = encodePermitTransferFromInput(permitTransferFrom);

  // V4 Swap
  const poolKey = getLowPoolKey(tradeCreationDto.inputToken, outputTokenAddress);
  const isZeroForOne = poolKey.currency0 === tradeCreationDto.inputToken;
  const minOutputAmount = 0n;

  const swapCommand = CommandType.V4_SWAP;
  const swapInput = router.encodeV4SwapInput(
    poolKey,
    isZeroForOne,
    tradeCreationDto.inputAmount,
    minOutputAmount,
    wallet.address,
  );

  const commands = ethers.concat([permit2PermitCommand, permit2TransferFromCommand, swapCommand]);
  console.log("commands", commands);
  const txRequest = await router.createExecuteTransaction(
    commands,
    [permit2Input, permit2TransferFromInput, swapInput],
    deadline,
  );
  //const txRequest = await router.createExecuteTransaction(wallet, swapCommand, [swapInput]);

  const txResponse = await wallet.sendTransaction(txRequest);
  console.log("txResponse:", txResponse.hash);
  const receipt = await txResponse.wait();
  if (!receipt) throw new Error("Transaction failed");
  console.log("txReceipt:", receipt.hash);

  // Decode logs
  console.log("Decoding logs...");
  if (receipt) {
    const decodedLogs = decodeLogs(receipt.logs);
    console.log("decodedLogs:", decodedLogs);
  }
}

if (require.main === module) {
  const wallet = getHardhatWallet_1();
  const chain = ChainType.ETH;
  const chainConfig = getChainConfig(chain);
  const usdcAddress = chainConfig.tokenAddresses.usdc;

  const usdcInputAmount = ethers.parseUnits("50", 6);

  const tradeCreationDto: SellTradeCreationDto = {
    chain: chain,
    inputToken: usdcAddress,
    inputAmount: usdcInputAmount.toString(),
    outputType: OutputType.ETH,
    outputToken: ethers.ZeroAddress,
    tradingPointPrice: "0",
    tradeType: "SELL",
  };
  v4SwapInteraction(wallet, tradeCreationDto).catch(console.error);
}
