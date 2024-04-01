/*
  KuCoin Cryto trader for one symbol
  Implementing https://altfins.com/knowledge-base/macd-line-and-macd-signal-line/
*/
import { macd } from "@rylorin/technicalindicators";
import { IConfig } from "config";
import { BarSize, KuCoinApi } from "./kucoin-api";
import { LogLevel, gLogger } from "./logger";

type Point = {
  time: number;
  open: number;
  close: number;
  high: number;
  low: number;
};

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
  private readonly symbol: string;
  private readonly api: KuCoinApi;

  private timer: NodeJS.Timeout | undefined;

  private readonly timeframe: BarSize;
  private readonly macdParams: {
    SimpleMAOscillator: boolean;
    SimpleMASignal: boolean;
    fastPeriod: number;
    slowPeriod: number;
    signalPeriod: number;
  };
  private candles: Point[] | undefined;

  constructor(config: IConfig, api: KuCoinApi, symbol: string) {
    gLogger.log(LogLevel.Info, "trader.constructor", symbol, "Creating trader");
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
    };
  }

  public isRunning(): boolean {
    return !!this.timer;
  }

  public start(): void {
    gLogger.log(LogLevel.Info, "trader.start", this.symbol, "Starting trader");
    const now = Math.floor(Date.now() / 1000);
    this.api
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
        gLogger.log(LogLevel.Error, "trader.start", this.symbol, err),
      );
    this.timer = setInterval(
      () => this.check(),
      (timeframe2secs(this.timeframe) * 1000) / 2,
    );
  }

  public check(): void {
    gLogger.log(LogLevel.Debug, "trader.check", this.symbol, "Checking trader");
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
            console.log(now, candle);
            this.candles!.push(candle);
          }
        });
        const macdArg = {
          ...this.macdParams,
          values: this.candles!.map((item) => item.close),
        };
        const result = macd(macdArg);
        console.log(macdArg, result);
      })
      .catch((err: Error) =>
        gLogger.log(LogLevel.Error, "trader.check", this.symbol, err),
      );
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
