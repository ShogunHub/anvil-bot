import { bot } from "../bot";
import { apiSwap } from "./swap";
import config from "../config.json";
import swapInfoController from "../controller/swap";
import depositController from "../controller/deposit";
import { convertTokenAmount } from "../service/getTokenPrice";
import { checkSolBalance, checkSplTokenBalance } from "../service/getBalance";
import { depositTraker } from "../service";

const cron = require("node-cron");
let timeAmount = 0;

export const startSwapProcess = async () => {
  timeAmount = 0;
  cron.schedule("*/1 * * * *", () => {
    processSwap(1);
  });
};

const executeSwap = async (userList: any) => {
  const {
    amount,
    baseDecimal,
    quoteDecimal,
    baseSymbol,
    quoteSymbol,
    baseToken,
    quoteToken,
    swapDetails,
    userId,
    buy,
    sell,
    buyProgress,
    sellProgress,
    flag,
    isBalance,
    priorityFee,
  } = userList;
  try {
    if (buyProgress < buy && flag) {
      if (baseToken === config.solTokenAddress) {
        const currentSolBalance = (await checkSolBalance(
          swapDetails[0].publicKey
        )) as any;
        if (currentSolBalance === undefined) return;
        if (currentSolBalance >= amount + config.networkFee) {
          await depositTraker(userId, true);
          const result = await apiSwap(
            Number(amount),
            baseDecimal,
            baseToken,
            quoteToken,
            swapDetails[0].privateKey,
            priorityFee
          );
          if (result?.status == 200 && result?.txId) {
            bot.sendMessage(
              userId,
              `
You bought the token.\n 
Swap for ${Number(amount)} ${baseSymbol} -> ${quoteSymbol}
<a href="${config.solScanUrl}/${result.txId}"><i>View on Solscan</i></a>`,
              { parse_mode: "HTML" }
            );
            const depositToken = {
              userId: userId,
              tokenInfo: quoteToken,
            };
            await depositController.create(depositToken);

            const newBuyProgress = buyProgress + 1;
            let swapInfoUpdate = null;
            if (buy == newBuyProgress) {
              swapInfoUpdate = {
                userId: userId,
                buyProgress: 0,
                flag: false,
                isBalance: true,
              };
            } else {
              swapInfoUpdate = {
                userId: userId,
                buyProgress: newBuyProgress,
                flag: true,
                isBalance: true,
              };
            }
            await swapInfoController.updateOne(swapInfoUpdate);
          } else {
            return;
          }
        } else {
          if (isBalance) {
            const value = amount + config.networkFee - currentSolBalance;
            await inputTokenCheck(userId, baseToken, baseSymbol, value);
            const swapInfoUpdate = {
              userId: userId,
              isBalance: false,
            };
            await swapInfoController.updateOne(swapInfoUpdate);
          } else {
            return;
          }
        }
      } else {
        const currentTokenBalance = (await checkSplTokenBalance(
          baseToken,
          swapDetails[0].publicKey
        )) as any;
        if (currentTokenBalance === undefined) return;
        if (currentTokenBalance >= amount) {
          await depositTraker(userId, true);

          const result = await apiSwap(
            Number(amount),
            baseDecimal,
            baseToken,
            quoteToken,
            swapDetails[0].privateKey,
            priorityFee
          );
          if (result?.status == 200 && result?.txId) {
            bot.sendMessage(
              userId,
              `
You bought the token.\n
Reserve Swap for ${Number(amount)} ${baseSymbol} -> ${quoteSymbol}
<a href="${config.solScanUrl}/${result.txId}"><i>View on Solscan</i></a>`,
              { parse_mode: "HTML" }
            );
            const depositToken = {
              userId: userId,
              tokenInfo: quoteToken,
            };
            await depositController.create(depositToken);
            const newBuyProgress = buyProgress + 1;
            let swapInfoUpdate = null;
            if (buy == newBuyProgress) {
              swapInfoUpdate = {
                userId: userId,
                buyProgress: 0,
                flag: false,
                isBalance: true,
              };
            } else {
              swapInfoUpdate = {
                userId: userId,
                buyProgress: newBuyProgress,
                flag: true,
                isBalance: true,
              };
            }
            await swapInfoController.updateOne(swapInfoUpdate);
          } else {
            return;
          }
        } else {
          if (isBalance) {
            const value = amount - currentTokenBalance;
            await inputTokenCheck(userId, baseToken, baseSymbol, value);
            const swapInfoUpdate = {
              userId: userId,
              isBalance: false,
            };
            await swapInfoController.updateOne(swapInfoUpdate);
          } else {
            return;
          }
        }
      }
    } else if (sellProgress < sell && !flag) {
      const currentTokenBalance = (await checkSplTokenBalance(
        quoteToken,
        swapDetails[0].publicKey
      )) as any;
      if (currentTokenBalance === undefined) return;
      const amount1 = (await convertTokenAmount(
        amount,
        baseToken,
        quoteToken
      )) as any;

      if (amount1 === undefined) return;
      if (amount1 > currentTokenBalance || currentTokenBalance == 0) {
        if (isBalance) {
          const realAmount = Math.floor(amount1);
          const value = realAmount - currentTokenBalance;
          await inputTokenCheck(userId, quoteToken, quoteSymbol, value);
          const swapInfoUpdate = {
            userId: userId,
            isBalance: false,
          };
          await swapInfoController.updateOne(swapInfoUpdate);
        } else {
          return;
        }
      } else {
        await depositTraker(userId, true);
        const result = await apiSwap(
          Number(parseFloat(amount1.toString()).toFixed(4)),
          quoteDecimal,
          quoteToken,
          baseToken,
          swapDetails[0].privateKey,
          priorityFee
        );
        if (result?.status == 200 && result?.txId) {
          bot.sendMessage(
            userId,
            `
You sold the token.
Reverse swap for ${Number(
              parseFloat(amount1.toString()).toFixed(4)
            )} ${quoteSymbol} -> ${baseSymbol}
<a href="${config.solScanUrl}/${result.txId}">View on Solscan</a>`,
            { parse_mode: "HTML" }
          );
          const newSellProgress = sellProgress + 1;
          let swapInfoUpdate = null;
          if (sell == newSellProgress) {
            swapInfoUpdate = {
              userId: userId,
              sellProgress: 0,
              flag: true,
              isBalance: true,
            };
          } else {
            swapInfoUpdate = {
              userId: userId,
              sellProgress: newSellProgress,
              flag: false,
              isBalance: true,
            };
          }
          await swapInfoController.updateOne(swapInfoUpdate);
        } else {
          return;
        }
      }
    } else {
      return;
    }
  } catch (error) {
    console.error("Error executing swap:", error);
  }
};

const processSwap = async (interval: number) => {
  try {
    if (timeAmount > 1440) {
      timeAmount = 0;
    }
    timeAmount += interval;
    const swapInfo = await swapInfoController.swapInfo();
    if (swapInfo?.data.length > 0) {
      for (let i = 0; i < swapInfo.data.length; i++) {
        if (
          swapInfo.data[i].active &&
          timeAmount % swapInfo.data[i].loopTime == 0
        ) {
          await executeSwap(swapInfo.data[i]);
        }
      }
    } else {
      return;
    }
  } catch (error) {
    console.error("Error fetching swap info:", error);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
};

const inputTokenCheck = async (
  userId: number,
  tokenAddress: any,
  Symbol: string,
  miniAmount: number
) => {
  bot.sendMessage(
    userId,
    `
You have not the ${Symbol} token amount enough.
<b>Required Minimum ${Symbol} Amount: </b> ${miniAmount}
Command Line:  /deposit
`,
    { parse_mode: "HTML" }
  );
};
