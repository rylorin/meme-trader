import { IConfig } from "config";
import { gLogger, LogLevel } from "./logger";

export class MyTradingBotApp {
  private readonly config: IConfig;
  private readonly api: KuCoinApi;
  private readonly traders: Record<string, MemeTrader> = {};

  constructor(config: IConfig) {
    this.config = config;
    this.api = new KuCoinApi(this.config);
  }

  public async start(): Promise<void> {
    await this.api.start();
    await this.refreshSymbols();
  }

  private async refreshSymbols(): Promise<void> {
    console.info("refreshSymbols");
    await this.api.getSymbolsList("USDS").then((symbols: SymbolDesc[]) => {
      symbols
        .filter((item) => item.enableTrading && item.quoteCurrency == "USDT")
        .forEach((item) => {
          if (!this.traders[item.symbol]) {
            this.traders[item.symbol] = new MemeTrader(item);
            const delay = 5 * 60 * 1000 * Math.random();
            setTimeout(() => this.traders[item.symbol].start(), delay);
            console.info(Object.keys(this.traders).length, "traders");
          }
        });
    });
  }
}

import config from "config";
import dotenv from "dotenv";
import { KuCoinApi, SymbolDesc } from "./kucoin-api";
import { MemeTrader } from "./trader";
dotenv.config(); // eslint-disable-line @typescript-eslint/no-var-requires,@typescript-eslint/no-unsafe-call

console.log("NODE_ENV", process.env["NODE_ENV"]);
const app = new MyTradingBotApp(config);
app
  .start()
  .catch((err: Error) => gLogger.log(LogLevel.Fatal, "main", undefined, err));
