import { IConfig } from "config";
import { LogLevel, gtpLogger } from "./logger";

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

export class KuCoinApi {
  protected config: IConfig;
  private readonly api: any;

  constructor(config: IConfig) {
    gtpLogger.log(LogLevel.Debug, "IbWcpConnection.constructor", undefined);
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
  }

  public async start(): Promise<void> {
    const getTimestampRl = await this.api.rest.Others.getTimestamp();
    console.log(getTimestampRl.data);
  }

  public async getSymbolsList(market: string): Promise<SymbolDesc[]> {
    const result = await this.api.rest.Market.Symbols.getSymbolsList({
      market,
    });
    // console.log(result);
    return result.data;
  }
}
