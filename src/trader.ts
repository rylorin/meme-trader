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

type OchlData = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
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

const kuCoin2point = (candle: string[]): OchlData => ({
  time: parseInt(candle[0]),
  open: parseFloat(candle[1]),
  high: parseFloat(candle[3]),
  low: parseFloat(candle[4]),
  close: parseFloat(candle[2]),
});

/**
 * Trade (monitor candles, detect signals, place orders) one symbol on KuCoin
 */
export class MemeTrader {
  private readonly config: IConfig;
  private readonly api: KuCoinApi;

  private timer: NodeJS.Timeout | undefined;
  private running: boolean;
  private drainMode: boolean;

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
  private readonly candles: OchlData[];

  private lastSignal: Signal;
  private tradeBudget: number;
  private state: State;
  private position: number;
  private lastUpdate: number;

  // For debugging
  private lastOrder: Order | undefined;
  private lastPlots: OchlData[] | undefined;
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
    this.drainMode = false;
    this.lastUpdate = 0;
  }

  public toString(): string {
    return `
symbol: ${this.symbol}
timeframe: ${this.timeframe}
drain: ${this.drainMode}
tradeBudget: ${this.tradeBudget}
isRunning: ${this.isRunning()}
candles: ${this.candles.length} item(s)
${JSON.stringify(this.candles.slice(-Math.max(this.upConfirmations, this.downConfirmations) - 1))}
indicator: ${this.samples?.length} item(s)
${JSON.stringify(this.samples?.slice(-Math.max(this.upConfirmations, this.downConfirmations) - 1))}
upConfirmations: ${this.upConfirmations}
downConfirmations: ${this.downConfirmations}
lastSignal: ${this.lastSignal}
state: ${this.state}
position: ${this.position}
order: ${JSON.stringify(this.lastOrder)}
`;
  }

  setDrainMode(drainMode: boolean): void {
    this.drainMode = drainMode;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getCandles(): OchlData[] {
    return this.candles || [];
  }

  public getIndicator(): MACDOutput[] {
    return this.samples || [];
  }

  public start(): void {
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
      return;
    }
    this.running = true;
  }

  private updateCandles(): Promise<OchlData[]> {
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
            this.candles.push(candle);
          }
        });
        return this.candles;
      });
  }

  /**
   * Compute a signal from candles
   * @param candles OCHL data
   * @returns dectected signal if any
   */
  private computeSignal(candles: OchlData[]): Signal {
    const macdArg = {
      ...this.macdParams,
      values: candles.map((item) => item.close),
    };
    this.samples = macd(macdArg);
    if (this.samples.length > macdArg.slowPeriod) {
      // console.log(this.symbol, "values", candles, "MACD", this.samples);
      // using n last indicator values
      const upSamples = this.samples.slice(-(this.upConfirmations + 1));
      let testBuySignal = true;
      for (let i = 0; i < upSamples.length - 1; i++) {
        if (upSamples[i + 1].histogram! < upSamples[i].histogram!)
          testBuySignal = false; // if next sample not higher then don't buy
      }
      // using n last indicator values
      const downSamples = this.samples.slice(-(this.downConfirmations + 1));
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
      this.state == State.Idle &&
      !this.drainMode
    ) {
      // Handle a buy signal
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
      // Handle a sell signal
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
    const now = Date.now();
    // Randomly run to reduce API load. Min delay 0.5 time frame, max 1.5
    const run =
      now >
      this.lastUpdate +
        (Math.random() + 0.5) * timeframe2secs(this.timeframe) * 1000;
    gLogger.log(LogLevel.Trace, "MemeTrader.check", this.symbol, run);
    if (!run) return Promise.resolve();
    this.lastUpdate = now;
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
