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
import { KuCoinApi, Order, Stats, SymbolDesc } from "./kucoin-api";
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
              ctx.reply(this.traders[key]?.toString()).then(() => undefined),
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

  private updateStats(): Promise<void> {
    gLogger.trace("MyTradingBotApp.updateStats", "run");
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
        gLogger.debug("MyTradingBotApp.updateStats", `${symbols.length} items`);
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
        gLogger.error("MyTradingBotApp.updateStats", error.message),
      );
  }

  private createTraders(): Promise<void> {
    gLogger.trace("MyTradingBotApp.createTraders", "run");
    // Wait for stats being available
    if (!this.statsLoaded) return Promise.resolve();
    const _now = Date.now() / 1000;
    // return (
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
      // Only symbols that are up for some % in the last 24 hours
      .filter((item) => item.changeRate >= this.minChange)
      // Check each symbol
      .filter((item) => {
        if (!this.traders[item.symbol]) {
          // Create trader that doesn't exist
          this.traders[item.symbol] = new MemeTrader(
            this.config,
            this.api,
            item.symbol,
          );
          gLogger.info(
            "MyTradingBotApp.createTraders",
            `${Object.keys(this.traders).length} trader(s)`,
          );
        }
        return !this.traders[item.symbol].isRunning();
      })
      .reduce(
        (p, item) => p.then(() => this.traders[item.symbol].start()),
        Promise.resolve(),
      )
      .catch((error: Error) =>
        gLogger.error("MyTradingBotApp.createTraders", error.message),
      );
    return Promise.resolve();
  }

  private runTraders(): Promise<void> {
    return Object.keys(this.traders)
      .filter((key) => this.traders[key].isRunning())
      .reduce(
        (p, key) => p.then(() => this.traders[key].check()),
        Promise.resolve(),
      );
  }

  private async check(): Promise<void> {
    gLogger.trace("MyTradingBotApp.refreshTraders", "check");
    await this.updateStats();
    await this.createTraders();

    let orders = (await this.api.getOrdersList()).items;
    // Extract last order for each symbol
    orders = orders.reduce((p: Order[], order: Order): Order[] => {
      if (p.findIndex((item) => item.symbol == order.symbol) < 0) p.push(order);
      return p;
    }, [] as Order[]);
    // console.log(orders);
    await orders
      .filter((order) => {
        // Only consider non active (completed) orders
        if (order!.side == "buy") {
          // If buy order then we consider that we have an open position and therefore we need to manage it
          if (!this.traders[order.symbol]) {
            // Create trader that doesn't exist
            this.traders[order.symbol] = new MemeTrader(
              this.config,
              this.api,
              order.symbol,
            );
          }
          // Propagate info
          this.traders[order.symbol].setOrder(order!);
          // Start a non running trader
          return !this.traders[order.symbol].isRunning();
        } else if (order!.side == "sell") {
          // If sell order then we only need to propagate info
          if (this.traders[order.symbol])
            this.traders[order.symbol].setOrder(order!);
          // we don't need to start/stop trader
          return false;
        }
      })
      .reduce(
        (p, order) => p.then(() => this.traders[order.symbol].start()),
        Promise.resolve(),
      );

    await this.runTraders();
  }
}

gLogger.info("main", `NODE_ENV=${process.env["NODE_ENV"]}`);
const app = new MyTradingBotApp(config);
app
  .start()
  .catch((err: Error) => gLogger.log(LogLevel.Fatal, "main", undefined, err));
