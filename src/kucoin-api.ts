/* eslint-disable @typescript-eslint/no-unsafe-call */
import { IConfig } from "config";
import { gLogger } from "./logger";

export const BarSize = {
  MINUTES_FIVE: "5min",
  MINUTES_FIFTEEN: "15min",
  MINUTES_THIRTY: "30min",
  HOUR_ONE: "1hour",
} as const;
export type BarSize = (typeof BarSize)[keyof typeof BarSize];

export type SymbolDesc = {
  symbol: string;
  name: string;
  baseCurrency: string;
  quoteCurrency: string;
  feeCurrency: string;
  market: string;
  baseMinSize: number;
  quoteMinSize: number;
  baseMaxSize: number;
  quoteMaxSize: number;
  baseIncrement: number;
  quoteIncrement: number;
  priceIncrement: number;
  priceLimitRate: number;
  minFunds: number;
  isMarginEnabled: boolean;
  enableTrading: boolean;
};

export type Stats = {
  time: number; // time
  symbol: string; // symbol
  buy: number; // bestAsk
  sell: number; // bestBid
  changeRate: number; // 24h change rate
  changePrice: number; // 24h change price
  high: number; // 24h highest price
  low: number; // 24h lowest price
  vol: number; // 24h volume，the aggregated trading volume in BTC
  volValue: number; // 24h total, the trading volume in quote currency of last 24 hours
  last: number; // last price
  averagePrice: number; // 24h average transaction price yesterday
  takerFeeRate: number; // Basic Taker Fee
  makerFeeRate: number; // Basic Maker Fee
  takerCoefficient: number; // Taker Fee Coefficient
  makerCoefficient: number; // Maker Fee Coefficient
};

export class KuCoinApi {
  protected config: IConfig;
  private readonly api: any;
  private readonly datafeed: any;

  constructor(config: IConfig) {
    gLogger.debug("KuCoinApi.constructor", "new instance");
    this.config = config;
    this.api = require("kucoin-node-sdk");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    this.api.init({
      baseUrl: config.get("kucoin-api.baseUrl"),
      apiAuth: {
        key: config.get("kucoin-api.apiAuth.key"), // KC-API-KEY
        secret: config.get("kucoin-api.apiAuth.secret"), // API-Secret
        passphrase: config.get("kucoin-api.apiAuth.passphrase"), // KC-API-PASSPHRASE
      },
      authVersion: config.get("kucoin-api.authVersion") || 2, // KC-API-KEY-VERSION. Notice: for v2 API-KEY, not required for v1 version.
    });
    this.datafeed = new this.api.websocket.Datafeed();
    this.datafeed.onClose(() => {
      console.log("ws closed, status ", this.datafeed.trustConnected);
    });
  }

  public start(): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    this.datafeed.connectSocket();
    // const callbackId = this.datafeed.subscribe(
    //   "/market/candles:BTC-USDT_1hour",
    //   (message: any) => {
    //     console.log(message.data);
    //   },
    // );
  }

  public heartBeat(): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    this.api.rest.Others.getTimestamp().then(
      (getTimestampRl: { code: number; data: number }) => {
        console.log("getTimestampRl", getTimestampRl.data);
        // Check connection every minute
        setTimeout(() => this.heartBeat(), 60 * 1000);
      },
    );
  }

  public async getSymbolsList(market: string): Promise<SymbolDesc[]> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = (await this.api.rest.Market.Symbols.getSymbolsList({
      market,
    })) as { code: number; data: SymbolDesc[] };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return result.data;
  }

  public async get24hrStats(symbol: string): Promise<Stats> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = (await this.api.rest.Market.Symbols.get24hrStats(
      symbol,
    )) as { code: number; data: Stats };
    return result.data;
  }

  public async getMarketCandles(
    symbol: string,
    type: BarSize,
    startAt = 0,
    endAt = 0,
  ): Promise<string[][]> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = (await this.api.rest.Market.Histories.getMarketCandles(
      symbol,
      type,
      { startAt, endAt },
    )) as { code: number; data: string[][] };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return result.data;
  }
}
