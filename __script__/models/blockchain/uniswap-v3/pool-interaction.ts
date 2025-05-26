import { getEthWallet_1 } from "../../../../src/hooks/useSetup";
import { UniswapV3Factory, UniswapV3Pool, TickInfo, FeeAmount } from "../../../../src/models/blockchain/uniswap-v3";
import { ChainType } from "../../../../src/config/chain-config";
import { ethers } from "ethers";

export async function poolInteraction() {
  const wallet = getEthWallet_1();
  const factory = new UniswapV3Factory(ChainType.ETH);

  const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

  const pool = await factory.getPool(wallet, DAI_ADDRESS, WETH_ADDRESS, FeeAmount.MEDIUM);

  const liquidity = await pool.getLiquidity();
  const slot0 = await pool.getSlot0();

  const currentTick: bigint = slot0.tick;
  const currentTickNumber = Number(currentTick);
  const tickSpacing = await pool.getTickSpacing();

  console.log(`Current Tick: ${currentTick}`);
  console.log(`Tick Spacing: ${tickSpacing}`);

  /**
   * const tickInfo = await pool.getTickInfo(currentTickNumber);
   * -73890
   * -> (0, 0, 0, 0, 0, 0, 0, false)
   *
   * The reason the tick is not initialized (no info in tickBitmap) is because the tick is not a multiple of the tick spacing.
   * To find the closest multiple of the tick spacing, we can use floor division of the current tick and the tick spacing.
   * Then we multiply the result by the tick spacing to get the closest multiple of the tick spacing (initiliazed tick).
   *
   */

  const tickBelow = Math.floor(currentTickNumber / tickSpacing) * tickSpacing;
  // Math.floor() is used to round down to the nearest integer.
  // division by tickspace of current tick gives us a decimal value -> Math.floor() rounds it down to the nearest integer. (=closest initialized tick below current tick)
  const tickAbove = tickBelow + tickSpacing;
  const twoTicksAbove = tickBelow + tickSpacing * 2;

  console.log(`${tickBelow} < ${currentTick} (current tick) < ${tickAbove} < ${twoTicksAbove}`);
  console.log("--------------------------------");
  console.log(`Liquidity: ${ethers.formatEther(liquidity)}`);
  console.log("--------------------------------");
  const tickBelowInfo: TickInfo = await pool.getTickInfo(tickBelow);
  console.log(`Tick below ${tickBelow} Info:`);
  console.log(`\tliquidityNet: ${ethers.formatEther(tickBelowInfo.liquidityNet)}`);
  console.log(`\tinitialized: ${tickBelowInfo.initialized}`);

  const tickAboveInfo: TickInfo = await pool.getTickInfo(tickAbove);
  console.log(`Tick above ${tickAbove} Info:`);
  console.log(`\tliquidityNet: ${ethers.formatEther(tickAboveInfo.liquidityNet)}`);
  console.log(`\tinitialized: ${tickAboveInfo.initialized}`);

  const twoTicksAboveInfo: TickInfo = await pool.getTickInfo(twoTicksAbove);
  console.log(`Tick two ticks above ${twoTicksAbove} Info:`);
  console.log(`\tliquidityNet: ${ethers.formatEther(twoTicksAboveInfo.liquidityNet)}`);
  console.log(`\tinitialized: ${twoTicksAboveInfo.initialized}`);
  console.log("--------------------------------");

  console.log("Price increasing... (tick moving to the right)");
  const newTick = Number(currentTick) + tickSpacing;
  console.log(`${tickBelow} < ${tickAbove} < ${newTick} (current tick) < ${twoTicksAbove}`);
  console.log("We add the net liquidity of the tick we cross to the liquidity");
  console.log(`crossed tick: ${tickAbove} with net liquidity: ${ethers.formatEther(tickAboveInfo.liquidityNet)}`);

  /**
   * LiuquidityNet summary:
   *      Positive liquidityNet = increase in tick/price -> liquidity increases
   *      Positive liquidityNet = decrease in tick/price -> liquidity decreases
   *      Negative liquidityNet = increase in tick/price -> liquidity decreases
   *      Negative liquidityNet = decrease in tick/price -> liquidity increases
   */
  const l_nextTick = BigInt(liquidity) + BigInt(tickAboveInfo.liquidityNet);
  console.log("--------------------------------");
  console.log(`Liquidity in next tick: ${ethers.formatEther(l_nextTick)}`);
  console.log("--------------------------------");
}

if (require.main === module) {
  poolInteraction().catch(console.error);
}
