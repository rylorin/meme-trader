import { IConfig } from "config";
import { LogLevel, gtpLogger } from "./logger";

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

  async start() {
    const getTimestampRl = await this.api.rest.Others.getTimestamp();
    console.log(getTimestampRl.data);
  }
}
