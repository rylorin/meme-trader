import { IConfig } from "config";

export class MyTradingBotApp {
  protected config: IConfig;
  protected api: KuCoinApi;
  constructor(config: IConfig) {
    this.config = config;
    this.api = new KuCoinApi(config);
  }

  public start(): void {
    this.api.start();
  }
}

import config from "config";
import dotenv from "dotenv";
import { KuCoinApi } from "./kucoin-api";
dotenv.config(); // eslint-disable-line @typescript-eslint/no-var-requires,@typescript-eslint/no-unsafe-call

console.log("NODE_ENV", process.env["NODE_ENV"]);
const app = new MyTradingBotApp(config);
app.start();
