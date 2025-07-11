export const TRADING_CONFIG = {
  //PROFIT_MARGIN: 1.21,
  //STOP_LOSS_MARGIN: 0.9,
  SLIPPAGE_TOLERANCE: 0.02,
  MAX_PRICE_IMPACT_PERCENTAGE: 5,
  MAX_RETRIES: 3,
  DEADLINE: Math.floor(Date.now() / 1000) + 1200, // 20 minutes from now
  INFINITE_APPROVAL: true,
  PRICE_IMPACT_AMOUNT_IN: "0.000001", // Used for price impact calculation
};
