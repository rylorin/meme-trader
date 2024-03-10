import { IConfig } from "config";

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
          if (!this.traders[item.baseCurrency]) {
            this.traders[item.baseCurrency] = new MemeTrader(item);
            this.traders[item.baseCurrency].start();
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
app.start();
