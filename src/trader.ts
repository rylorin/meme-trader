/*
  KuCoin Cryto trader for one symbol
  Implementing https://altfins.com/knowledge-base/macd-line-and-macd-signal-line/
*/
import { macd } from "@rylorin/technicalindicators";
import { IConfig } from "config";
import { v4 as uuid } from "uuid";
import { BarSize, KuCoinApi, Order } from "./kucoin-api";
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
  private running: boolean;

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
  private readonly candles: Point[];

  private lastSignal: Signal;
  private tradeBudget: number;
  private state: State;
  private orderId: string | undefined;
  private position: number;

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
    this.tradeBudget = parseInt(this.config.get("trader.tradeBudget")) || 1;
    this.lastSignal = Signal.None;
    this.state = State.Idle;
    this.position = 0;
    this.running = false;
    this.candles = [];
  }

  public toString(): string {
    return `
symbol: ${this.symbol}
isRunning: ${this.isRunning()}
confirmPeriods: ${this.macdParams.confirmPeriods}
lastSignal: ${this.lastSignal}
state: ${this.state}
position: ${this.position}
`;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public start(): Promise<void> {
    gLogger.log(
      LogLevel.Info,
      "MemeTrader.start",
      this.symbol,
      "Starting trader",
    );
    if (this.running) {
      gLogger.log(
        LogLevel.Warning,
        "MemeTrader.start",
        this.symbol,
        "Trying to start an already running trader",
      );
      return Promise.resolve();
    }
    this.running = true;
    // this.timer = setInterval(
    //   () => this.check(),
    //   (timeframe2secs(this.timeframe) * 1000) / 2,
    // );
    return this.updateCandles()
      .then(() => undefined)
      .catch((err: Error) =>
        gLogger.log(LogLevel.Error, "MemeTrader.start", this.symbol, err),
      );
  }

  private updateCandles(): Promise<Point[]> {
    const now = Math.floor(Date.now() / 1000);
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
        candles.forEach((candle) => {
          const idx = this.candles!.findIndex(
            (item) => item.time == candle.time,
          );
          if (idx < 0) {
            // Add non existing candle
            this.candles!.push(candle);
          }
        });
        return this.candles;
      });
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

  private handleSignal(signal: Signal): Promise<void> {
    if (
      this.lastSignal != Signal.BUY &&
      signal == Signal.BUY &&
      this.state == State.Idle
    ) {
      // Issue a buy signal
      gLogger.log(
        LogLevel.Warning,
        "MemeTrader.handleSignal",
        this.symbol,
        "BUY",
      );
      return this.api
        .placeMarketOrder(uuid(), "buy", this.symbol, {
          funds: this.tradeBudget,
        })
        .then((orderId) => {
          this.state = State.BUYING;
          this.lastSignal = signal;
          this.orderId = orderId;
        });
    }
    if (
      this.lastSignal != Signal.SELL &&
      signal == Signal.SELL &&
      this.state == State.POSITION
    ) {
      // Issue a sell signal
      gLogger.log(
        LogLevel.Warning,
        "MemeTrader.handleSignal",
        this.symbol,
        "SELL",
      );
      return this.api
        .placeMarketOrder(uuid(), "sell", this.symbol, { size: this.position })
        .then((orderId) => {
          this.state = State.SELLING;
          this.lastSignal = signal;
          this.orderId = orderId;
        });
    }
    return Promise.resolve();
  }

  public check(): Promise<void> {
    gLogger.log(LogLevel.Trace, "MemeTrader.check", this.symbol, "run");
    return this.updateCandles()
      .then((candles) => this.computeSignal(candles))
      .then((signal) => this.handleSignal(signal))
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

  public setOrder(order: Order): void {
    gLogger.log(LogLevel.Trace, "MemeTrader.setOrder", this.symbol, order);
    if (order.side == "sell") {
      if (order.isActive) this.state = State.SELLING;
      else {
        this.state = State.Idle;
        this.position = 0;
      }
    } else if (order.side == "buy") {
      if (order.isActive) this.state = State.BUYING;
      else {
        this.state = State.POSITION;
        this.position = order.dealSize;
      }
    }
  }

  public stop(): void {
    gLogger.log(
      LogLevel.Info,
      "MemeTrader.stop",
      this.symbol,
      "Stopping trader",
    );
    if (this.running) {
      gLogger.log(
        LogLevel.Warning,
        "MemeTrader.start",
        this.symbol,
        "Trying to stop a non running trader",
      );
    }
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
