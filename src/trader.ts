/*
  KuCoin Cryto trader for one symbol
  Implementing https://altfins.com/knowledge-base/macd-line-and-macd-signal-line/
*/
import { macd } from "@rylorin/technicalindicators";
import { MACDOutput } from "@rylorin/technicalindicators/declarations/moving_averages/MACD";
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
  };
  private readonly upConfirmations: number;
  private readonly downConfirmations: number;
  private readonly candles: Point[];

  private lastSignal: Signal;
  private tradeBudget: number;
  private state: State;
  private position: number;

  // For debugging
  private lastOrder: Order | undefined;
  private lastPlots: Point[] | undefined;
  private samples: MACDOutput[] | undefined;

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
    };
    (this.upConfirmations = parseInt(
      this.config.get("trader.upConfirmations"),
    )),
      (this.downConfirmations = parseInt(
        this.config.get("trader.downConfirmations"),
      )),
      (this.tradeBudget =
        parseFloat(this.config.get("trader.tradeBudget")) || 1);
    this.lastSignal = Signal.None;
    this.state = State.Idle;
    this.position = 0;
    this.running = false;
    this.candles = [];
  }

  public toString(): string {
    return `
symbol: ${this.symbol}
tradeBudget: ${this.tradeBudget}
isRunning: ${this.isRunning()}
candles: ${this.candles.length} item(s)
lastPlots: ${JSON.stringify(this.lastPlots)}
lastSamples: ${JSON.stringify(this.samples)}
upConfirmations: ${this.upConfirmations}
downConfirmations: ${this.downConfirmations}
lastSignal: ${this.lastSignal}
state: ${this.state}
position: ${this.position}
order: ${JSON.stringify(this.lastOrder)}
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
            // console.log("MemeTrader.updateCandles", candle);
            // Add non existing candle
            this.candles.push(candle);
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
    if (result.length > macdArg.slowPeriod) {
      this.lastPlots = candles.slice(-3);
      this.samples = result.slice(-3);
      // using n last indicator values
      const upSamples = result.slice(-(this.upConfirmations + 1));
      let testBuySignal = true;
      for (let i = 0; i < upSamples.length - 1; i++) {
        if (upSamples[i + 1].histogram! < upSamples[i].histogram!)
          testBuySignal = false; // if next sample not higher then don't buy
      }
      // using n last indicator values
      const downSamples = result.slice(-(this.downConfirmations + 1));
      let testSellSignal = true;
      for (let i = 0; i < downSamples.length - 1; i++) {
        if (downSamples[i + 1].histogram! > downSamples[i].histogram!)
          testSellSignal = false; // if next sample not higher then don't sell
      }
      gLogger.log(
        LogLevel.Trace,
        "MemeTrader.computeSignal",
        this.symbol,
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
      gLogger.log(LogLevel.Info, "MemeTrader.handleSignal", this.symbol, "BUY");
      return this.api
        .placeMarketOrder(uuid(), "buy", this.symbol, {
          funds: this.tradeBudget,
        })
        .then((orderId) => {
          this.state = State.BUYING;
          this.lastSignal = signal;
          gLogger.log(
            LogLevel.Info,
            "MemeTrader.handleSignal",
            this.symbol,
            "BUY order placed with id",
            orderId,
          );
        });
    }
    if (
      this.lastSignal != Signal.SELL &&
      signal == Signal.SELL &&
      this.state == State.POSITION
    ) {
      // Issue a sell signal
      gLogger.log(
        LogLevel.Info,
        "MemeTrader.handleSignal",
        this.symbol,
        "SELL",
      );
      return this.api
        .placeMarketOrder(uuid(), "sell", this.symbol, { size: this.position })
        .then((orderId) => {
          this.state = State.SELLING;
          this.lastSignal = signal;
          gLogger.log(
            LogLevel.Info,
            "MemeTrader.handleSignal",
            this.symbol,
            "SELL order placed with id",
            orderId,
          );
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
    this.lastOrder = order;
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
