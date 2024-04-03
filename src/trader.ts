/*
  KuCoin Cryto trader for one symbol
  Implementing https://altfins.com/knowledge-base/macd-line-and-macd-signal-line/
*/
import { macd } from "@rylorin/technicalindicators";
import { IConfig } from "config";
import { Telegraf } from "telegraf";
import { v4 as uuid } from "uuid";
import { BarSize, KuCoinApi } from "./kucoin-api";
import { LogLevel, gLogger } from "./logger";

type Point = {
  time: number;
  open: number;
  close: number;
  high: number;
  low: number;
};

export const Signal = {
  None: undefined,
  BUY: "BUY",
  SELL: "SELL",
} as const;
export type Signal = (typeof Signal)[keyof typeof Signal];

export const State = {
  Idle: undefined,
  BUYING: "Buying",
  POSITION: "Position",
  SELLING: "Selling",
} as const;
export type State = (typeof State)[keyof typeof State];

const timeframe2secs = (timeframe: string): number => {
  switch (timeframe) {
    case BarSize.MINUTES_FIVE:
      return 5 * 60;
    case BarSize.MINUTES_FIFTEEN:
      return 15 * 60;
    case BarSize.MINUTES_THIRTY:
      return 30 * 60;
    case BarSize.HOUR_ONE:
      return 3600;
    default:
      throw Error(`Unimplemented timeframe: ${timeframe}`);
  }
};

const kuCoin2point = (candle: string[]): Point => ({
  time: parseInt(candle[0]),
  open: parseFloat(candle[1]),
  close: parseFloat(candle[2]),
  high: parseFloat(candle[3]),
  low: parseFloat(candle[4]),
});

export class MemeTrader {
  private readonly config: IConfig;
  private readonly api: KuCoinApi;

  private timer: NodeJS.Timeout | undefined;

  private readonly symbol: string;
  private readonly timeframe: BarSize;
  private readonly macdParams: {
    SimpleMAOscillator: boolean;
    SimpleMASignal: boolean;
    fastPeriod: number;
    slowPeriod: number;
    signalPeriod: number;
    confirmPeriods: number;
  };
  private candles: Point[] | undefined;

  private lastSignal: Signal;
  private tradeBudget: number;
  private state: State;
  // private buy_orderId:string;

  constructor(config: IConfig, api: KuCoinApi, symbol: string) {
    gLogger.log(
      LogLevel.Info,
      "MemeTrader.constructor",
      symbol,
      "New instance",
    );
    this.config = config;
    this.api = api;
    this.symbol = symbol;
    this.timeframe = this.config.get("trader.timeframe") || BarSize.HOUR_ONE;
    this.macdParams = {
      SimpleMAOscillator: false,
      SimpleMASignal: false,
      fastPeriod: parseInt(this.config.get("trader.fastPeriod")),
      slowPeriod: parseInt(this.config.get("trader.slowPeriod")),
      signalPeriod: parseInt(this.config.get("trader.signalPeriod")),
      confirmPeriods: parseInt(this.config.get("trader.confirmPeriods")) || 1,
    };
    this.lastSignal = Signal.None;
    this.tradeBudget = parseInt(this.config.get("trader.tradeBudget"));
  }

  public toString(): string {
    return `
symbol: ${this.symbol}
isRunning: ${this.isRunning()}
confirmPeriods: ${this.macdParams.confirmPeriods}
lastSignal: ${this.lastSignal}
`;
  }

  public isRunning(): boolean {
    return !!this.timer;
  }

  public start(): Promise<void> {
    gLogger.log(
      LogLevel.Info,
      "MemeTrader.start",
      this.symbol,
      "Starting trader",
    );
    const now = Math.floor(Date.now() / 1000);
    this.timer = setInterval(
      () => this.check(),
      (timeframe2secs(this.timeframe) * 1000) / 2,
    );
    return this.api
      .getMarketCandles(
        this.symbol,
        this.timeframe,
        Math.floor(
          now -
            (2 * this.macdParams.slowPeriod + 1) *
              timeframe2secs(this.timeframe),
        ),
      )
      .then((candles) => candles.map(kuCoin2point))
      .then((candles) => {
        this.candles = candles;
      })
      .catch((err: Error) =>
        gLogger.log(LogLevel.Error, "MemeTrader.start", this.symbol, err),
      );
  }

  private computeSignal(candles: Point[]): Signal {
    const macdArg = {
      ...this.macdParams,
      values: candles.map((item) => item.close),
    };
    const result = macd(macdArg);
    // console.log(macdArg, result);
    if (result.length >= macdArg.slowPeriod) {
      // using n last indicator values
      const samples = result.slice(-(this.macdParams.confirmPeriods + 1));
      let testBuySignal = true;
      let testSellSignal = true;
      for (let i = 0; i < samples.length - 1; i++) {
        if (samples[i + 1].histogram! < samples[i].histogram!)
          testBuySignal = false; // if next sample not higher then don't buy
        if (samples[i + 1].histogram! > samples[i].histogram!)
          testSellSignal = false; // if next sample not higher then don't sell
      }
      gLogger.log(
        LogLevel.Trace,
        "MemeTrader.computeSignal",
        this.symbol,
        samples,
        testBuySignal,
        testSellSignal,
      );
      if (testBuySignal) return Signal.BUY;
      else if (testSellSignal) return Signal.SELL;
      else return Signal.None;
    }
  }

  public check(): void {
    gLogger.log(LogLevel.Trace, "MemeTrader.check", this.symbol, "run");
    const now = Math.floor(Date.now() / 1000);
    this.api
      .getMarketCandles(
        this.symbol,
        this.timeframe,
        Math.floor(now - 3 * timeframe2secs(this.timeframe)),
      )
      .then((candles) => candles.map(kuCoin2point))
      .then((candles) => {
        candles.forEach((candle) => {
          const idx = this.candles!.findIndex(
            (item) => item.time == candle.time,
          );
          if (idx < 0) {
            // Add non existing candle
            this.candles!.push(candle);
          }
        });
        return this.computeSignal(this.candles!);
      })
      .then((signal) => {
        if (this.lastSignal != Signal.BUY && signal == Signal.BUY) {
          // Issue a buy signal
          gLogger.log(LogLevel.Warning, "MemeTrader.check", this.symbol, "BUY");
          this.lastSignal = signal;
          // Telegraf.reply("BUY " + this.symbol);
          // this.bot.context.reply("text")
          return this.api.placeMarketOrder(
            uuid(),
            "buy",
            this.symbol,
            this.tradeBudget,
          );
        }
        if (this.lastSignal != Signal.SELL && signal == Signal.SELL) {
          // Issue a sell signal
          gLogger.log(
            LogLevel.Warning,
            "MemeTrader.check",
            this.symbol,
            "SELL",
          );
          Telegraf.reply("SELL " + this.symbol);
          this.lastSignal = Signal.SELL;
        }
      })
      .catch((err: Error) => {
        console.error(err);
        gLogger.log(
          LogLevel.Error,
          "MemeTrader.check",
          this.symbol,
          err.message,
        );
      });
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
