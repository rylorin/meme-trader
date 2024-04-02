/*
  MyTradingBotApp
*/
import { Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";

// Load env vars
import dotenv from "dotenv";
dotenv.config(); // eslint-disable-line @typescript-eslint/no-var-requires,@typescript-eslint/no-unsafe-call

// Load config
import { default as config, IConfig } from "config";

// The following are relying on env var and config
import { Message, Update } from "telegraf/typings/core/types/typegram";
import { CommandContextExtn } from "telegraf/typings/telegram-types";
import { KuCoinApi, Stats, SymbolDesc } from "./kucoin-api";
import { gLogger, LogLevel } from "./logger";
import { MemeTrader } from "./trader";

/**
 * @internal
 *
 * JSON replace function to convert ES6 Maps to tuple arrays.
 */
function jsonReplacer(key: string, value: any): any {
  if (value instanceof Map) {
    const tuples: [unknown, unknown][] = [];
    value.forEach((v, k) => {
      tuples.push([k, v]);
    });
    return tuples;
  } else {
    return value;
  }
}

export class MyTradingBotApp {
  private readonly config: IConfig;
  private readonly api: KuCoinApi;
  private readonly traders: Record<string, MemeTrader> = {};
  private readonly stats: Record<string, Stats> = {};

  private statsLoaded = false;
  private readonly minVolume: number;
  private readonly maxVolume: number;
  private readonly minPrice: number;
  private readonly minChange: number;
  private readonly maxAge: number;

  constructor(config: IConfig) {
    this.config = config;
    this.api = new KuCoinApi(this.config);
    this.minVolume = parseFloat(this.config.get("stats.minVolume")) * 1000000;
    this.maxVolume =
      parseFloat(this.config.get("stats.maxVolume")) * 1000000 || 9999999999;
    this.minPrice = parseFloat(this.config.get("stats.minPrice")) || 1;
    this.minChange = parseFloat(this.config.get("stats.minChange")) || 0.1;
    this.maxAge = parseInt(this.config.get("stats.maxAge")) || 60;
  }

  public start(): Promise<void> {
    this.api.start();

    setInterval(() => this.refreshSymbols(), 1 * 60 * 1000); // update symbols every 1 min
    setInterval(() => this.refreshTraders(), 1 * 60 * 1000); // update traders every 1 min

    // Start telegram bot to control application
    const bot = new Telegraf(this.config.get("telegram.apiKey"));
    bot.start((ctx) => ctx.reply("Welcome"));
    bot.help((ctx) => ctx.reply("Send me a sticker"));
    bot.on(message("sticker"), (ctx) => ctx.reply("👍"));
    bot.hears("Hi", (ctx) => ctx.reply("Hey there"));
    bot.command("oldschool", (ctx) => ctx.reply("Hello"));
    bot.command("hipster", Telegraf.reply("λ"));
    bot.command("echo", (ctx) => ctx.reply(ctx.payload));
    bot.command("symbol", (ctx) => this.handleSymbol(ctx));
    return bot.launch();
  }

  /**
   * Print an object (JSON formatted) to console.
   */
  formatObject(obj: unknown): string {
    return `${JSON.stringify(obj, jsonReplacer, 2)}`;
  }

  private async handleSymbol(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    let keys: string[];
    gLogger.debug("MyTradingBotApp.handleSymbol", "Handle command");
    try {
      if (ctx.payload) {
        keys = ctx.payload.split(" ");
        await keys.reduce(
          (p, key) =>
            p.then(() =>
              ctx
                .reply(this.formatObject(this.stats[key]))
                .then(() => undefined),
            ),
          Promise.resolve(),
        );
      } else {
        keys = Object.keys(this.stats).sort((a, b) => a.localeCompare(b));
        console.log(keys);
        if (keys.length) {
          for (let i = 0; i < keys.length; i = i + 20) {
            const slice = keys.slice(i, i + 20);
            if (slice.length)
              await ctx
                .reply(slice.join(" "))
                .catch((err: Error) =>
                  gLogger.error("MyTradingBotApp.handleSymbol", err.message),
                );
          }
        } else
          await ctx
            .reply("none")
            .catch((err: Error) =>
              gLogger.error("MyTradingBotApp.handleSymbol", err.message),
            );
      }
    } catch (err: any) {
      await ctx
        .reply(err.message) // eslint-disable-line @typescript-eslint/no-unsafe-argument
        .catch((err: Error) =>
          gLogger.error("MyTradingBotApp.handleSymbol", err.message),
        );
    }
  }

  private refreshSymbols(): void {
    gLogger.trace("MyTradingBotApp.refreshSymbols", "run");
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
              now - this.stats[item.symbol].time > this.maxAge * 60 * 1000,
          );
        // If no symbol left then our list has been completed
        if (!this.statsLoaded) this.statsLoaded = symbols.length == 0;
        gLogger.debug(
          "MyTradingBotApp.refreshSymbols",
          `${symbols.length} items`,
        );
        return (
          symbols
            // Keep only n symbols, giving the opportunity to revisit stats twice during maxAge
            .slice(0, Math.ceil(universe_size / this.maxAge) * 2)
            .reduce(
              (p, item) =>
                p.then(() =>
                  this.api.get24hrStats(item.symbol).then((stats: Stats) => {
                    if (!this.stats[item.symbol]) {
                      this.stats[item.symbol] = stats;
                      gLogger.log(
                        LogLevel.Info,
                        "MyTradingBotApp.refreshSymbols",
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
        gLogger.error("MyTradingBotApp.refreshSymbols", error.message),
      );
  }

  private refreshTraders(): void {
    gLogger.trace("MyTradingBotApp.refreshTraders", "run");
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
          item.volValue >= this.minVolume && item.volValue <= this.maxVolume,
      )
      // Filter on price
      .filter((item) => item.last >= this.minPrice)
      // Only symbols that are up in the last 24 hours
      .filter((item) => item.changeRate >= this.minChange)
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
app
  .start()
  .catch((err: Error) => gLogger.log(LogLevel.Fatal, "main", undefined, err));
