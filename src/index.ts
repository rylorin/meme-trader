import { default as config } from "config";
import dotenv from "dotenv";
dotenv.config(); // eslint-disable-line @typescript-eslint/no-var-requires,@typescript-eslint/no-unsafe-call

import { IConfig } from "config";
import { gLogger, LogLevel } from "./logger";

import { KuCoinApi, Stats, SymbolDesc } from "./kucoin-api";
import { MemeTrader } from "./trader";

export class MyTradingBotApp {
  private readonly config: IConfig;
  private readonly api: KuCoinApi;
  private readonly traders: Record<string, MemeTrader> = {};
  private readonly stats: Record<string, Stats> = {};

  private statsLoaded = false;

  constructor(config: IConfig) {
    this.config = config;
    this.api = new KuCoinApi(this.config);
  }

  public start(): void {
    this.api.start();

    setInterval(() => this.refreshSymbols(), 1 * 60 * 1000); // update symbols every 1 min
    setInterval(() => this.refreshTraders(), 1 * 60 * 1000); // update traders every 1 min
  }

  private refreshSymbols(): void {
    gLogger.debug("main.refreshSymbols", "run");
    const now = Date.now();
    this.api
      .getSymbolsList("USDS")
      .then((symbols: SymbolDesc[]) => {
        symbols = symbols
          // Only trade USDT pairs that are enabled for trading
          .filter((item) => item.enableTrading && item.quoteCurrency == "USDT");
        const universe_size = symbols.length;
        symbols = symbols
          // Filter out symbol with recent stats
          .filter(
            (item) =>
              !this.stats[item.symbol] ||
              now - this.stats[item.symbol].time >
                (parseInt(this.config.get("stats.maxAge")) || 60) * 60 * 1000,
          );
        // If no symbol left then our list has been completed
        if (!this.statsLoaded) this.statsLoaded = symbols.length == 0;
        gLogger.debug("refreshSymbols", `${symbols.length} items`);
        return (
          symbols
            // Keep only n symbols, giving the opportunity to revisit stats twice during maxAge
            .slice(
              0,
              Math.ceil(
                universe_size / parseInt(this.config.get("stats.maxAge")),
              ) * 2,
            )
            .reduce(
              (p, item) =>
                p.then(() =>
                  this.api.get24hrStats(item.symbol).then((stats: Stats) => {
                    if (!this.stats[item.symbol]) {
                      this.stats[item.symbol] = stats;
                      gLogger.log(
                        LogLevel.Info,
                        "refreshSymbols",
                        item.symbol,
                        Object.keys(this.stats).length,
                        "stats",
                      );
                    } else {
                      this.stats[item.symbol] = { ...stats };
                    }
                  }),
                ),
              Promise.resolve(),
            )
        );
      })
      .catch((error: Error) =>
        gLogger.error("main.refreshSymbols", error.message),
      );
  }

  private refreshTraders(): void {
    gLogger.debug("main.refreshTraders", "run");
    // Wait for stats being available
    if (!this.statsLoaded) return;
    const _now = Date.now() / 1000;
    Object.keys(this.stats)
      .map((key) => this.stats[key])
      // If trader not yet running
      .filter(
        (item) =>
          !this.traders[item.symbol] || !this.traders[item.symbol].isRunning(),
      )
      // Filter on volume
      .filter(
        (item) =>
          item.volValue >= parseInt(this.config.get("stats.minVolume")) &&
          item.volValue <= parseInt(this.config.get("stats.maxVolume")),
      )
      // Filter on price
      .filter(
        (item) => item.last >= parseFloat(this.config.get("stats.minPrice")),
      )
      // Only symbols that are up in the last 24 hours
      .filter(
        (item) =>
          item.changeRate >= parseFloat(this.config.get("stats.minChange")),
      )
      // Check each symbol
      .forEach((item) => {
        // Check if trader already exists
        if (!this.traders[item.symbol]) {
          // Create traders
          this.traders[item.symbol] = new MemeTrader(
            this.config,
            this.api,
            item.symbol,
          );
          gLogger.info(
            "refreshTraders",
            `${Object.keys(this.traders).length} trader(s)`,
          );
          // Start it within next 5 mins
          const delay = 5 * 60 * 1000 * Math.random();
          setTimeout(() => this.traders[item.symbol].start(), delay);
        }
      });
  }
}

gLogger.info("main", `NODE_ENV=${process.env["NODE_ENV"]}`);
const app = new MyTradingBotApp(config);
app.start();
// .catch((err: Error) => gLogger.log(LogLevel.Fatal, "main", undefined, err));
