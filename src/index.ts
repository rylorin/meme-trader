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
  private readonly bot: Telegraf;
  private readonly traders: Record<string, MemeTrader> = {};
  private readonly stats: Record<string, Stats> = {};
  private timer: NodeJS.Timeout | undefined;

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
    this.minPrice = parseFloat(this.config.get("stats.minPrice"));
    this.minChange = parseFloat(this.config.get("stats.minChange")) || 0.1;
    this.maxAge = parseInt(this.config.get("stats.maxAge")) || 60;

    // Create telegram bot to control application
    this.bot = new Telegraf(this.config.get("telegram.apiKey"));
    this.bot.start((ctx) => ctx.reply("Welcome"));
    this.bot.help((ctx) => ctx.reply("Send me a sticker"));
    this.bot.on(message("sticker"), (ctx) => ctx.reply("👍"));
    this.bot.hears("Hi", (ctx) => ctx.reply("Hey there"));
    this.bot.command("echo", (ctx) => ctx.reply(ctx.payload));
    this.bot.command("symbol", (ctx) => this.handleSymbolCommand(ctx));
    this.bot.command("trader", (ctx) => this.handleTraderCommand(ctx));
  }

  public start(): Promise<void> {
    this.api.start();

    this.timer = setInterval(
      () => {
        this.check().catch((err: Error) => {
          console.log(err);
          gLogger.error("MyTradingBotApp.check", err.message);
        });
      },
      1 * 60 * 1000,
    ); // run checks every 1 min

    return this.bot.launch();
  }

  /**
   * Print an object (JSON formatted) to console.
   */
  formatObject(obj: unknown): string {
    return `${JSON.stringify(obj, jsonReplacer, 2)}`;
  }

  private async handleSymbolCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    let keys: string[];
    gLogger.debug("MyTradingBotApp.handleSymbol", "Handle 'symbol' command");
    try {
      if (ctx.payload) {
        keys = ctx.payload
          .trim()
          .replaceAll("  ", " ")
          .toUpperCase()
          .split(" ");
        await ctx.reply(`${keys.length} symbol(s):`);
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
        // console.log(keys);
        if (keys.length) {
          await ctx.reply(`${keys.length} symbol(s):`);
          for (let i = 0; i < keys.length; i = i + 35) {
            // Previously 35 (and working)
            const slice = keys.slice(i, i + 35);
            if (slice.length) {
              await ctx
                .reply(slice.join(" "))
                .catch((err: Error) =>
                  gLogger.error("MyTradingBotApp.handleSymbol", err.message),
                );
            }
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

  private async handleTraderCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    let keys: string[];
    gLogger.debug("MyTradingBotApp.handleTrader", "Handle 'trader' command");
    try {
      if (ctx.payload) {
        keys = ctx.payload
          .trim()
          .replaceAll("  ", " ")
          .toUpperCase()
          .split(" ");
        await ctx.reply(`${keys.length} symbol(s):`);
        await keys.reduce(
          (p, key) =>
            p.then(() =>
              ctx.reply(this.traders[key].toString()).then(() => undefined),
            ),
          Promise.resolve(),
        );
      } else {
        keys = Object.keys(this.traders).sort((a, b) => a.localeCompare(b));
        // console.log(keys);
        if (keys.length) {
          await ctx.reply(`${keys.length} symbol(s):`);
          // Previously 25 (and working)
          for (let i = 0; i < keys.length; i = i + 30) {
            const slice = keys.slice(i, i + 30);
            if (slice.length) {
              await ctx
                .reply(slice.join(" "))
                .catch((err: Error) =>
                  gLogger.error("MyTradingBotApp.handleTrader", err.message),
                );
            }
          }
        } else
          await ctx
            .reply("none")
            .catch((err: Error) =>
              gLogger.error("MyTradingBotApp.handleTrader", err.message),
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

  private refreshSymbols(): Promise<void> {
    gLogger.trace("MyTradingBotApp.refreshSymbols", "run");
    const now = Date.now();
    return this.api
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
                    this.stats[item.symbol] = stats;
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

  private refreshTraders(): Promise<void> {
    gLogger.trace("MyTradingBotApp.refreshTraders", "run");
    // Wait for stats being available
    if (!this.statsLoaded) return Promise.resolve();
    const _now = Date.now() / 1000;
    return (
      Object.keys(this.stats)
        .map((key) => this.stats[key])
        // If trader not yet running
        .filter(
          (item) =>
            !this.traders[item.symbol] ||
            !this.traders[item.symbol].isRunning(),
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
        .map((item) => {
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
            // const delay = 5 * 60 * 1000 * Math.random();
            // setTimeout(() => this.traders[item.symbol].start(), delay);
          }
          return item;
        })
        .reduce(
          (p, item) => p.then(() => this.traders[item.symbol].start()),
          Promise.resolve(),
        )
        .catch((error: Error) =>
          gLogger.error("MyTradingBotApp.refreshTraders", error.message),
        )
    );
  }

  private async check(): Promise<void> {
    gLogger.trace("MyTradingBotApp.refreshTraders", "check");
    await this.refreshSymbols();
    await this.refreshTraders();
    // const fills = await this.api.getFillsList();
    // fills.items.forEach((item) => console.log(item));
    // const orders = await this.api.getOrdersList();
    // orders.items.forEach((item) => console.log(item));
    // const positions = await this.api.getPositionsList();
    // console.log(positions);
    // const position = await this.api.getPositionDetails();
    // console.log(position);
  }
}

gLogger.info("main", `NODE_ENV=${process.env["NODE_ENV"]}`);
const app = new MyTradingBotApp(config);
app
  .start()
  .catch((err: Error) => gLogger.log(LogLevel.Fatal, "main", undefined, err));
