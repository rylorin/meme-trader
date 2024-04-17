/* eslint-disable @typescript-eslint/no-unsafe-call */
import { IConfig } from "config";
import { LogLevel, gLogger } from "./logger";

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

export type Fill = {
  symbol: string; //symbol
  tradeId: string; //trade id
  orderId: string; //order id
  counterOrderId: string; //counter order id
  side: "buy" | "sell"; //transaction direction,include buy and sell
  liquidity: "taker" | "maker"; //include taker and maker
  forceTaker: boolean; //forced to become taker
  price: number; //order price
  size: number; //order quantity
  funds: number; //order funds
  fee: number; //fee
  feeRate: number; //fee rate
  feeCurrency: string; // charge fee currency
  stop: string; // stop type
  type: string; // order type,e.g. limit,market,stop_limit.
  createdAt: number; //time
  tradeType: "TRADE" | "MARGIN_TRADE";
};

export type Order = {
  id: string; //orderid
  symbol: string; //symbol
  opType: "DEAL"; // operation type: DEAL
  type: string; // order type,e.g. limit,market,stop_limit.
  side: "buy" | "sell"; // transaction direction,include buy and sell
  price: number; // order price
  size: number; // order quantity
  funds: number; // order funds
  dealFunds: number; // deal funds
  dealSize: number; // deal quantity
  fee: number; // fee
  feeCurrency: string; // charge fee currency
  stp: string; // self trade prevention,include CN,CO,DC,CB
  stop: string; // stop type
  stopTriggered: boolean; // stop order is triggered
  stopPrice: number; // stop price
  timeInForce: string; // time InForce,include GTC,GTT,IOC,FOK
  postOnly: boolean; // postOnly
  hidden: boolean; // hidden order
  iceberg: boolean; // iceberg order
  visibleSize: number; // display quantity for iceberg order
  cancelAfter: number; // cancel orders time，requires timeInForce to be GTT
  channel: string; // order source
  clientOid: string; // user-entered order unique mark
  remark: string; // remark
  tags: string; // tag order source
  isActive: boolean; // status before unfilled or uncancelled
  cancelExist: boolean; // order cancellation transaction record
  createdAt: number; // create time
  tradeType: "TRADE";
};

/**
 * KuCoin API wrapper
 */
export class KuCoinApi {
  protected config: IConfig;
  private readonly api: any;
  private readonly datafeed: any;

  constructor(config: IConfig) {
    gLogger.debug("KuCoinApi.constructor", "new instance");
    this.config = config;
    this.api = require("kucoin-node-sdk");
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
    gLogger.debug("KuCoinApi.start", "start API");
    // this.datafeed.connectSocket(); // should await
    // /* const callbackId1 = */ this.datafeed.subscribe(
    //   "/market/candles:BTC-USDT_1hour",
    //   (_message: any) => {
    //     // console.log("BTC-USDT_1hour", message);
    //   },
    // );
    // /*  const callbackId2 = */ this.datafeed.subscribe(
    //   "/spotMarket/tradeOrdersV2",
    //   (message: any) => {
    //     console.log("tradeOrdersV2", message);
    //   },
    // );
    // /*  const callbackId3 = */ this.datafeed.subscribe(
    //   "/spotMarket/tradeOrders",
    //   (message: any) => {
    //     console.log("tradeOrdersV2", message);
    //   },
    // );
  }

  public stop(): void {
    // Nothing to do for the moment
  }

  public heartBeat(): void {
    this.api.rest.Others.getTimestamp().then(
      (getTimestampRl: { code: number; data: number }) => {
        console.log("getTimestampRl", getTimestampRl.data);
        // Check connection every minute
        setTimeout(() => this.heartBeat(), 60 * 1000);
      },
    );
  }

  public async getSymbolsList(market: string): Promise<SymbolDesc[]> {
    const result = (await this.api.rest.Market.Symbols.getSymbolsList({
      market,
    })) as { code: number; msg: string; data: SymbolDesc[] };
    if (result.code != 200000) throw Error(result.msg);
    return result.data;
  }

  public async get24hrStats(symbol: string): Promise<Stats> {
    const result = (await this.api.rest.Market.Symbols.get24hrStats(
      symbol,
    )) as { code: number; msg: string; data: Stats };
    if (result.code != 200000) throw Error(result.msg);
    return result.data;
  }

  public async getMarketCandles(
    symbol: string,
    type: BarSize,
    startAt = 0,
    endAt = 0,
  ): Promise<string[][]> {
    const result = (await this.api.rest.Market.Histories.getMarketCandles(
      symbol,
      type,
      { startAt, endAt },
    )) as { code: number; msg: string; data: string[][] };
    if (result.code != 200000) throw Error(result.msg);
    return result.data.reverse();
  }

  public async placeMarketOrder(
    clientOid: string,
    side: "buy" | "sell",
    symbol: string,
    opts: { funds?: number; size?: number },
  ): Promise<string> {
    const result = (await this.api.rest.Trade.Orders.postOrder(
      { clientOid, type: "market", side, symbol },
      { funds: opts.funds, size: opts.size },
    )) as { code: number; msg: string; data: { orderId: string } };
    if (result.code != 200000) {
      gLogger.log(
        LogLevel.Error,
        "KuCoinApi.placeMarketOrder",
        symbol,
        result.code,
        result.msg,
        { clientOid, type: "market", side, symbol },
        { funds: opts.funds, size: opts.size },
      );
      throw Error(`#${result.code}: ${result.msg}`);
    }
    return result.data.orderId;
  }

  public async getFillsList(): Promise<{
    currentPage: number;
    pageSize: number;
    totalNum: number;
    totalPage: number;
    items: Fill[];
  }> {
    const result = (await this.api.rest.Trade.Fills.getFillsList(
      "TRADE",
      {},
    )) as {
      code: number;
      msg: string;
      data: {
        currentPage: number;
        pageSize: number;
        totalNum: number;
        totalPage: number;
        items: Fill[];
      };
    };
    if (result.code != 200000) throw Error(result.msg);
    return result.data;
  }

  public async getOrdersList(): Promise<{
    currentPage: number;
    pageSize: number;
    totalNum: number;
    totalPage: number;
    items: Order[];
  }> {
    const result = (await this.api.rest.Trade.Orders.getOrdersList(
      "TRADE",
      {},
    )) as {
      code: number;
      msg: string;
      data: {
        currentPage: number;
        pageSize: number;
        totalNum: number;
        totalPage: number;
        items: Order[];
      };
    };
    if (result.code != 200000) throw Error(result.msg);
    // console.log(result);
    return result.data;
  }

  /*
  public async getPositionDetails(): Promise<any> {
    console.log("getPositionDetails");
    const result = (await this.api.rest.Trade.Positions.getPositionDetails(
      "BTC-USDT",
    )) as {
      code: number;
      msg: string;
      data: any;
    };
    if (result.code != 200000) throw Error(result.msg);
    // console.log(result);
    return result.data;
  }

  public async getPositionsList(): Promise<any> {
    console.log("getPositionsList");
    const result = (await this.api.rest.Trade.Positions.getPositionsList()) as {
      code: number;
      msg: string;
      data: any;
    };
    if (result.code != 200000) throw Error(result.msg);
    // console.log(result);
    return result.data;
  }
  */
}
