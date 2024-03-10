import axios, { AxiosError, AxiosInstance } from "axios";
import { IConfig } from "config";
import https from "https";
import { Subject } from "rxjs";
import { v4 as uuid } from "uuid";
import WebSocket from "ws";
import { LogLevel, gtpLogger } from "./logger";

enum IbCwpEndpointTypes {
  Status,
  Tickle,
  getAccounts,
  Stocks,
  Search,
  getOrders,
  placeOrder,
  cancelOrder,
  getPositions,
  getHistorycalData,
  getStrikes,
  getInfo,
  getAccountSummary,
}

interface IbCwpEndpoint {
  method: "get" | "post" | "del" | "put";
  url: string;
}

const endpoints: Record<IbCwpEndpointTypes, IbCwpEndpoint> = {
  [IbCwpEndpointTypes.Status]: {
    method: "get",
    url: "/v1/api/iserver/auth/status",
  },
  [IbCwpEndpointTypes.Tickle]: {
    method: "get",
    url: "/v1/api/tickle",
  },
  [IbCwpEndpointTypes.getAccounts]: {
    method: "get",
    url: "/v1/api/portfolio/accounts",
  },
  [IbCwpEndpointTypes.Stocks]: {
    method: "get",
    url: "/v1/api/trsrv/stocks?symbols={symbols}",
  },
  [IbCwpEndpointTypes.Search]: {
    method: "post",
    url: "/v1/api/iserver/secdef/search",
  },
  [IbCwpEndpointTypes.getOrders]: {
    method: "get",
    url: "/v1/api/iserver/account/orders",
  },
  [IbCwpEndpointTypes.placeOrder]: {
    method: "post",
    url: "/v1/api/iserver/account/{accountId}/orders",
  },
  [IbCwpEndpointTypes.cancelOrder]: {
    method: "del",
    url: "/v1/api/iserver/account/{accountId}/order/{orderId}",
  },
  [IbCwpEndpointTypes.getPositions]: {
    method: "get",
    url: "/v1/api/portfolio/{accountId}/positions/{pageId}",
  },
  [IbCwpEndpointTypes.getHistorycalData]: {
    method: "get",
    url: "/v1/api/iserver/marketdata/history?conid={conid}&period={period}&bar=5min&outsideRth=true",
    // url: '/v1/api/hmds/history?conid=265598&period=1h&bar=5m&outsideRth=true',
  },
  [IbCwpEndpointTypes.getStrikes]: {
    method: "get",
    url: "/v1/api/iserver/secdef/strikes?conid={conid}&sectype={sectype}&month={month}",
  },
  [IbCwpEndpointTypes.getInfo]: {
    method: "get",
    url: "/v1/api/iserver/secdef/info?conid={conid}&sectype={sectype}&month={month}&strike={strike}&right={right}",
  },
  [IbCwpEndpointTypes.getAccountSummary]: {
    method: "get",
    url: "/v1/api/portfolio/{accountId}/summary",
  },
};

export class KuCoinApi {
  protected config: IConfig;
  private readonly api: AxiosInstance;
  private keepalive: NodeJS.Timer | undefined;
  private ws: WebSocket | undefined;
  private keepaliveWs: NodeJS.Timer | undefined;
  private historyCallsLeft = 2;

  constructor(config: IConfig) {
    gtpLogger.log(LogLevel.Debug, "IbWcpConnection.constructor", undefined);
    this.config = config;
    this.api = axios.create({
      baseURL: "params.url",
      headers: {
        Accept: "application/json",
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
      }),
    });
  }

  private process_ws_message(msg: any) {
    if ("error" in msg) {
      gtpLogger.log(
        LogLevel.Error,
        "IbWcpConnection.process_ws_message",
        undefined,
        msg.topic,
        msg.error
      );
    } else if (msg.topic == "system") {
      // console.log('system message:', msg);
    } else if (msg.topic == "tic") {
      // console.log('tic message:', msg);
    } else if (msg.topic == "sor") {
      this.processSorMessage(msg.args);
    } else if (msg.topic == "act") {
      // console.log('act message:', msg);
    } else if (msg.topic == "sts") {
      // console.log('sts message:', msg);
    } else if (msg.topic == "ntf") {
      this.processNtfMessage(msg.args);
    } else if (msg.topic == "blt") {
      this.processBltMessage(msg.args);
    } else if ((msg.topic as string).startsWith("smd+")) {
      this.processStreamMessage(msg); // Stream market data
    } else if ((msg.topic as string).startsWith("smh+")) {
      this.processHistoryMessage(msg);
    } else {
      gtpLogger.log(
        LogLevel.Error,
        "IbWcpConnection.process_ws_message",
        undefined,
        "unimplemented message:",
        msg
      );
    }
  }

  private ws_connect(session: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const url =
        "(this.params as IbWcpAccount).url".replace("https:", "wss:") +
        "/v1/api/ws";
      this.ws = new WebSocket(url, { rejectUnauthorized: false })
        .once("open", () => {
          gtpLogger.log(
            LogLevel.Info,
            "IbWcpConnection.websocket",
            undefined,
            "IbWcpConnection stream Connected"
          );
          this.ws!.send(JSON.stringify({ session }));
          this.ws!.send("tic"); // Ping session
          this.ws!.send("spl+{}"); // Profit & Loss Updates
          this.ws!.send("str+{}"); // Trades
          this.keepaliveWs = setInterval(() => this.ws?.send("tic"), 60 * 1000);
        })
        .on("message", (data: Buffer) => {
          if (!resolved) {
            resolved = true;
            gtpLogger.log(
              LogLevel.Info,
              "IbWcpConnection.websocket",
              undefined,
              "Connection is Up"
            );
            resolve();
          }
          this.process_ws_message(JSON.parse(data.toString()));
        })
        .once("close", (data: any) => {
          gtpLogger.log(
            LogLevel.Error,
            "IbWcpConnection.websocket",
            undefined,
            "close",
            data
          );
          this.ws = undefined;
          if (!resolved) {
            resolved = true;
            reject();
          }
        })
        .on("error", (data: any) => {
          gtpLogger.log(
            LogLevel.Error,
            "IbWcpConnection.websocket",
            undefined,
            "error",
            data
          );
          if (!resolved) {
            resolved = true;
            reject();
          }
        });
    });
  }

  public connect(): Promise<void> {
    gtpLogger.info(
      "IbWcpConnection.connect",
      "connecting",
      "tradier-datafeed-connecting"
    );
    this.keepalive = setInterval(
      () =>
        this.tickle()
          .then((response) => {
            gtpLogger.log(
              LogLevel.Debug,
              "IbWcpConnection.keepalive",
              undefined,
              response
            );
          })
          .catch(() => {
            // Silently ignore error for the moment
          }),
      60 * 1000
    );
    return this.status().then(() =>
      this.tickle().then((response) => {
        gtpLogger.log(
          LogLevel.Debug,
          "IbWcpConnection.connect",
          undefined,
          response
        );
        return this.ws_connect(response.session);
      })
    );
  }

  public disconnect() {
    if (this.keepaliveWs) clearInterval(this.keepaliveWs);
    this.keepaliveWs = undefined;
    this.ws?.close();
    delete this.ws;
    this.ws = undefined;
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = undefined;
  }

  private submit_request(
    api: IbCwpEndpointTypes,
    params?: any
  ): Promise<Response> {
    let url: string = endpoints[api].url.replace(
      "{accountId}",
      this.params.accountName
    );
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url = url.replace(
          "{" + key + "}",
          value !== undefined ? (value as string) : ""
        );
      }
    }
    switch (endpoints[api].method) {
      case "post":
        return this.api.post(url, params, {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        });
      case "get":
        return this.api.get(url);
      case "del":
        return this.api.delete(url);
      case "put":
        return this.api.put(url, params);
      default:
        throw Error("IbWcpConnection.call: method not implemented!");
    }
  }

  private call(
    api: IbCwpEndpointTypes,
    params?: any
  ): Promise<Record<string, any>> {
    return this.submit_request(api, params)
      .then((response) => {
        if (response.status == 200) {
          if ((response as any).error) {
            throw Error((response as any).error);
          } else {
            return (response as any).data;
          }
        } else {
          gtpLogger.log(
            LogLevel.Error,
            "IbWcpConnection.call",
            undefined,
            response.statusText
          );
          gtpLogger.log(
            LogLevel.Debug,
            "IbWcpConnection.call",
            undefined,
            response
          );
          throw Error(response.statusText);
        }
      })
      .catch((error: AxiosError) => {
        gtpLogger.log(
          LogLevel.Error,
          "IbWcpConnection.call",
          undefined,
          error.message
        );
        gtpLogger.log(LogLevel.Debug, "IbWcpConnection.call", undefined, error);
        throw error;
      });
  }

  private status(): Promise<Record<string, any>> {
    return this.call(IbCwpEndpointTypes.Status);
  }

  private tickle(): Promise<Record<string, any>> {
    return this.call(IbCwpEndpointTypes.Tickle);
  }

  private stocks(symbols: string): Promise<Record<string, any>> {
    return this.call(IbCwpEndpointTypes.Stocks, { symbols });
  }

  private search(
    symbol: string,
    secType: "STK" = "STK"
  ): Promise<Record<string, any>> {
    return this.call(IbCwpEndpointTypes.Search, { symbol, secType });
  }

  private strikes(
    conid: number,
    month: string,
    sectype: "OPT" = "OPT"
  ): Promise<{ call: number[]; put: number[] }> {
    return this.call(IbCwpEndpointTypes.getStrikes, {
      conid,
      sectype,
      month,
    }).then((response) => {
      return { call: response.call, put: response.put };
    });
  }

  private info(
    conid: number,
    month: string,
    strike: number | undefined,
    right?: "P" | "C",
    sectype: "OPT" = "OPT"
  ): Promise<Record<string, any>> {
    return this.call(IbCwpEndpointTypes.getInfo, {
      conid,
      sectype,
      month,
      strike,
      right,
    });
  }

  /** ConId cache. Key is assetKey */
  private contractId: Record<string, number> = {};
  /** Asset cache. Key is conId */
  private contractIdRev: Record<number, AssetData> = {};

  public findContract = (asset: AssetData): Promise<number> => {
    const assetKey = getAssetKey(asset);
    const symbol = getAssetSymbol(asset);
    gtpLogger.log(
      LogLevel.Debug,
      "IbWcpConnection.findContract",
      assetKey,
      asset,
      symbol
    );
    if (this.contractId[assetKey]) {
      return Promise.resolve(this.contractId[assetKey] as number);
    } else {
      switch (asset.type) {
        case "equity":
          return this.stocks(symbol).then((response) => {
            if (response[symbol].length) {
              if (response[symbol][0].contracts.length) {
                const conId = response[symbol][0].contracts[0].conid;
                this.contractId[assetKey] = conId;
                this.contractIdRev[conId] = asset;
                return conId;
              }
            }
          });
        case "option":
          return this.search(symbol)
            .then((response) => {
              // console.log('search:', response);
              if (response.length) {
                const conId = parseInt(response[0].conid);
                this.contractId[assetKey] = conId;
                this.contractIdRev[conId] = asset;
                return conId;
              } else {
                gtpLogger.log(
                  LogLevel.Error,
                  "IbWcpConnection.findContract",
                  undefined,
                  "Underlying not found",
                  response
                );
                throw new Error("Underlying not found");
              }
            })
            .then((underlyningConId) => {
              return this.info(
                underlyningConId,
                asset.expiry.substring(0, 6),
                asset.strike,
                asset.optionType
              ).then((response) => {
                // console.log('info:', response);
                return response.find(
                  (item: any) => item.maturityDate === asset.expiry
                ).conid;
              });
            });
        default:
          assertNever(asset);
      }
    }
  };

  public getAccounts(): Promise<string[]> {
    return this.call(IbCwpEndpointTypes.getAccounts).then((response) =>
      response.map((item: any) => item.accountId as string)
    );
  }

  /* market data subjects registry. Key is assetKey */
  private md_registry: Record<string, md_entry> = {};

  public subscribeStream(asset: AssetData): Subject<Tape> {
    const assetKey = getAssetKey(asset);
    if (!this.md_registry[assetKey]) {
      this.md_registry[assetKey] = {
        subject: new Subject(),
        last_tape: { ingressTm: 0 },
      };
    }
    this.findContract(asset).then((conId) => {
      const cmd = `smd+${conId}+{"fields": ["31","84","86","7059","88","85"]}`;
      gtpLogger.log(
        LogLevel.Debug,
        "IbWcpConnection.subscribeStream",
        undefined,
        cmd
      );
      this.ws?.send(cmd);
    });
    return this.md_registry[assetKey].subject;
  }

  public unsubscribeStream(asset: AssetData): void {
    const assetKey = getAssetKey(asset);
    this.findContract(asset).then((conId) => {
      const cmd = `umd+${conId}+{}`;
      gtpLogger.log(
        LogLevel.Debug,
        "IbWcpConnection.unsubscribeStream",
        undefined,
        cmd
      );
      this.ws?.send(cmd);
    });
    this.md_registry[assetKey].subject.complete();
    delete this.md_registry[assetKey];
  }

  private processStreamMessage(msg: any): void {
    const conId = parseInt((msg.topic as string).substring(4));
    const assetKey = getAssetKey(this.contractIdRev[conId]);
    const asset = parseAssetKey(assetKey);

    // if (!last_tape.ingressTm) gtpLogger.log(LogLevel.Debug, 'IbWcpConnection.processStreamMessage', assetKey, msg);
    if (this.md_registry[assetKey]) {
      const last_tape = this.md_registry[assetKey].last_tape;
      last_tape.ingressTm = msg["_updated"];
      if ("31" in msg) last_tape.price = parseFloat(msg["31"]);
      if ("84" in msg) last_tape.bid = parseFloat(msg["84"]);
      if ("86" in msg) last_tape.ask = parseFloat(msg["86"]);
      if ("7059" in msg) last_tape.size = parseFloat(msg["7059"]);
      if ("88" in msg) last_tape.bid_size = parseFloat(msg["88"]);
      if ("85" in msg) last_tape.ask_size = parseFloat(msg["85"]);
      this.md_registry[assetKey].subject.next(last_tape);
    }
    if (asset.type == "option") {
      this.opt_registry.forEach((entry) => {
        const option = parseAssetKey(entry.assetKey);
        if (
          option.type == "option" &&
          asset.underlyingSymbol == option.underlyingSymbol &&
          asset.expiry == option.expiry &&
          (asset.strike == option.strike || !option.strike) &&
          (asset.optionType == option.optionType ||
            (option.optionType as unknown as string) == "*")
        ) {
          const last_tape: OptionData = {
            ingressTm: msg["_updated"],
            symbol: asset.underlyingSymbol,
            type: asset.optionType,
            expiryDate: asset.expiry,
            strike: asset.strike,
          };
          if ("84" in msg) last_tape.bid = parseFloat(msg["84"]);
          if ("86" in msg) last_tape.ask = parseFloat(msg["86"]);
          if ("88" in msg) last_tape.bidSize = parseFloat(msg["88"]);
          if ("85" in msg) last_tape.askSize = parseFloat(msg["85"]);
          // gtpLogger.log(LogLevel.Debug, 'IbWcpConnection.processStreamMessage', assetKey, last_tape);
          entry.subject.next(last_tape);
        } else {
          // gtpLogger.log(LogLevel.Debug, 'IbWcpConnection.processStreamMessage', assetKey, asset, option);
        }
      });
    }
  }

  /* market history subjects registry. */
  private mh_registry: mh_entry[] = [];

  public subscribeBarUpdates(
    asset: AssetData,
    resolution: BarSize
  ): Subject<Bar> {
    const assetKey = getAssetKey(asset);
    let cache = this.mh_registry.find((item) => item.assetKey == assetKey);
    if (!cache) {
      cache = {
        subject: new Subject(),
        assetKey,
        resolution,
        serverId: undefined,
      };
      this.mh_registry.push(cache);
    }
    this.findContract(asset).then((conId) => {
      const cmd = `smh+${conId}+{"bar":"${resolution}","outsideRth":true}`;
      gtpLogger.log(
        LogLevel.Debug,
        "IbWcpConnection.subscribeBarUpdates",
        undefined,
        cmd
      );
      this.ws?.send(cmd);
    });
    return cache.subject;
  }

  public unsubscribeBarUpdates(asset: AssetData): void {
    const assetKey = getAssetKey(asset);
    this.findContract(asset).then((conId) => {
      const cmd = `umd+${conId}+{}`;
      gtpLogger.log(
        LogLevel.Debug,
        "IbWcpConnection.unsubscribeBarUpdates",
        undefined,
        cmd
      );
      this.ws?.send(cmd);
    });
    this.md_registry[assetKey].subject.complete();
    delete this.md_registry[assetKey];
  }

  private processHistoryMessage(msg: any): void {
    const conId = parseInt((msg.topic as string).substring(4));
    const assetKey = getAssetKey(this.contractIdRev[conId]);
    if (this.md_registry[assetKey]) {
      const last_tape = this.md_registry[assetKey].last_tape;
      last_tape.ingressTm = msg["_updated"];
      if ("31" in msg) last_tape.price = parseFloat(msg["31"]);
      if ("84" in msg) last_tape.bid = parseFloat(msg["84"]);
      if ("86" in msg) last_tape.ask = parseFloat(msg["86"]);
      if ("7059" in msg) last_tape.size = parseFloat(msg["7059"]);
      if ("88" in msg) last_tape.bid_size = parseFloat(msg["88"]);
      if ("85" in msg) last_tape.ask_size = parseFloat(msg["85"]);
      // console.log('processStreamMessage', conId, last_tape);
      this.md_registry[assetKey].subject.next(last_tape);
    } else {
      gtpLogger.log(
        LogLevel.Error,
        "IbWcpConnection.processStreamMessage",
        assetKey,
        "cache not found",
        conId,
        msg
      );
      // console.log('md_registry');
      // Object.entries(this.md_registry).forEach(([k, v]) => {
      //   console.log(k, v);
      // });
    }
  }

  public XgetOptionChain(
    symbol: string,
    expiry: string,
    strike: number | undefined
  ): Promise<OptionAssetDataX[]> {
    const asset: AssetData = { type: "equity", symbol };
    // const assetKey = getAssetKey(asset);
    return this.findContract(asset).then((underlyningConId) => {
      return (
        strike
          ? Promise.resolve({ call: [strike], put: [strike] })
          : this.strikes(underlyningConId, expiry)
      ).then((strikes) => {
        return strikes.call.reduce(
          (p, strike: number) => {
            return p.then((calls: OptionAssetDataX[]) => {
              return this.info(underlyningConId, expiry, strike, "C").then(
                (response) => {
                  const option: OptionAssetDataX = {
                    type: "option",
                    conid: response.conid,
                    underlyingSymbol: symbol,
                    expiry,
                    strike,
                    optionType: OptionType.Call,
                  };
                  calls.push(option);
                  return calls;
                }
              );
            });
          },
          Promise.resolve([] as OptionAssetDataX[])
        );
      });
    });
  }

  public getOptionChain(
    asset: AssetData,
    expiry: string,
    strike?: number
  ): Promise<OptionAssetDataX[]> {
    // const assetKey = getAssetKey(asset);
    gtpLogger.log(
      LogLevel.Debug,
      "IbWcpConnection.getOptionChain",
      asset,
      expiry,
      strike
    );
    return this.findContract(asset).then((underlyningConId) => {
      return this.info(underlyningConId, expiry.substring(0, 6), 0).then(
        (response) => {
          if (response.length > 0) {
            return response
              .filter((item: any) => item.maturityDate == expiry)
              .map((item: any) => {
                const conid: number = item.conid;
                const option: OptionAssetDataX = {
                  type: "option",
                  conid,
                  underlyingSymbol: item.symbol,
                  expiry: item.maturityDate,
                  strike: item.strike,
                  optionType: item.right as OptionType,
                };
                const optionKey = getAssetKey(option);
                gtpLogger.log(
                  LogLevel.Debug,
                  "IbWcpConnection.getOptionChain",
                  optionKey,
                  option
                );
                // Add to cache
                this.contractId[optionKey] = conid;
                this.contractIdRev[conid] = option;
                return option;
              });
          } else {
            gtpLogger.log(
              LogLevel.Error,
              "IbWcpConnection.getOptionChain",
              asset,
              response
            );
            return [];
          }
        }
      );
    });
  }

  /* options subscriptions subjects registry. */
  private opt_registry: opt_entry[] = [];

  public subscribeOptions(
    asset: AssetData,
    expiry: string,
    strike: number | undefined
  ): Subject<OptionData> {
    const option: AssetData = {
      type: "option",
      underlyingSymbol: getAssetSymbol(asset),
      expiry,
      strike: strike!,
      optionType: undefined!,
    };
    const assetKey = getAssetKey(option);
    gtpLogger.log(
      LogLevel.Debug,
      "IbWcpConnection.subscribeOptions",
      option,
      expiry,
      strike
    );
    const entry: opt_entry = { subject: new Subject(), assetKey };
    this.opt_registry.push(entry);
    this.getOptionChain(asset, expiry, strike).then((options) => {
      options.forEach((option) => {
        const cmd = `smd+${option.conid}+{"fields": ["84","86","88","85"]}`;
        gtpLogger.log(
          LogLevel.Trace,
          "IbWcpConnection.subscribeOptions",
          asset,
          cmd
        );
        this.ws?.send(cmd);
      });
    });
    return entry.subject;
  }

  public placeOrder(order: Order): Promise<string> {
    gtpLogger.log(
      LogLevel.Debug,
      "IbWcpConnection.placeOrder",
      order.asset,
      order
    );
    try {
      return this.findContract(order.asset).then((contract) => {
        const udi_id = uuid();
        const ibOrder = {
          orders: [
            {
              acctId: (this.params as IbWcpAccount).accountName,
              conid: contract,
              cOID: udi_id,
              // "parentId": "string",
              orderType: order.orderType,
              listingExchange: "SMART",
              isSingleGroup: false,
              // outsideRTH: true,
              price: order.limitPrice
                ? Math.round(order.limitPrice * 100) / 100
                : order.limitPrice,
              auxPrice: order.auxPrice
                ? Math.round(order.auxPrice * 100) / 100
                : order.auxPrice,
              side: order.action,
              // "ticker": "string",
              tif: "GTC",
              trailingAmt: 0,
              trailingType: "amt",
              referrer: "QuickTrade",
              quantity: order.quantity,
              useAdaptive: false,
              isCcyConv: false,
              // "allocationMethod": "string",
            },
          ],
        };
        const order_mapping: OrderMapping = {
          udi_id,
          client_order_id: undefined,
          server_order_id: undefined,
          order,
        };
        electronStore.dispatch(updateOrderMapping(order_mapping));
        const now = Date.now();
        const openOrder: OpenOrder = {
          permId: udi_id,
          order,
          status: OrderStatus.Inactive,
          remainingQty: order.quantity,
          createdAt: now,
          updatedAt: now,
          activeTradingAccountId: this.params.id,
        };
        electronStore.dispatch(updateOpenOrder(openOrder));
        return this.call(IbCwpEndpointTypes.placeOrder, ibOrder).then(
          (response) => {
            const client_order_id = response[0].order_id;
            // electronStore.dispatch(updateOrderMapping({ ...order_mapping, client_order_id }));
            const description = `Order successully placed with id: ${udi_id} (${client_order_id})`;
            gtpLogger.log(
              LogLevel.Info,
              "IbWcpConnection.placeOrder",
              order.asset,
              description
            );
            return udi_id;
          }
        );
      });
    } catch (err) {
      gtpLogger.log(
        LogLevel.Error,
        "IbWcpConnection.placeOrder",
        order.asset,
        err
      );
      return Promise.reject(err);
    }
  }

  public placeOptionsOrder(order: OptionsOrder): Promise<string> {
    const udi_id = uuid();
    return order.tradeLegs
      .reduce(
        (p, leg) => {
          return p.then((orders) => {
            return this.findContract({
              type: "option",
              underlyingSymbol: getAssetSymbol(order.asset),
              strike: leg.strikePrice,
              expiry: leg.expirationDate,
              optionType: leg.type,
            }).then((conid) => {
              orders.push({
                acctId: (this.params as IbWcpAccount).accountName,
                conid,
                cOID: udi_id,
                // "parentId": "string",
                orderType: order.orderType,
                listingExchange: "SMART",
                isSingleGroup: true,
                // outsideRTH: true,
                price: order.limitPrice
                  ? Math.round(order.limitPrice * 100) / 100
                  : order.limitPrice,
                auxPrice: order.auxPrice
                  ? Math.round(order.auxPrice * 100) / 100
                  : order.auxPrice,
                side: order.action,
                // "ticker": "string",
                tif: "GTC",
                trailingAmt: 0,
                trailingType: "amt",
                referrer: "QuickTrade",
                quantity: order.quantity,
                useAdaptive: false,
                isCcyConv: false,
                // "allocationMethod": "string",
              });
              return orders;
            });
          });
        },
        Promise.resolve([] as any[])
      )
      .then((orders) => {
        const order_mapping: OrderMapping = {
          udi_id,
          client_order_id: undefined,
          server_order_id: undefined,
          order,
        };
        electronStore.dispatch(updateOrderMapping(order_mapping));
        const now = Date.now();
        const openOrder: OpenOrder = {
          permId: udi_id,
          order,
          status: OrderStatus.Inactive,
          remainingQty: order.quantity,
          createdAt: now,
          updatedAt: now,
          activeTradingAccountId: this.params.id,
        };
        // electronStore.dispatch(updateOpenOrder(openOrder));

        return this.call(IbCwpEndpointTypes.placeOrder, { orders }).then(
          (response) => {
            const client_order_id = response[0].order_id;
            // electronStore.dispatch(
            //   updateOrderMapping({ ...order_mapping, client_order_id })
            // );
            const description = `Order successully placed with id: ${udi_id} (${client_order_id})`;
            gtpLogger.log(
              LogLevel.Info,
              "IbWcpConnection.placeOptionsOrder",
              order.asset,
              description
            );
            return udi_id;
          }
        );
      });
  }

  public cancelOrder(id: number): Promise<void> {
    return this.call(IbCwpEndpointTypes.cancelOrder, { orderId: id }).then(
      (result) => console.log(result)
    );
  }

  public getOrders(): Promise<any> {
    return this.call(IbCwpEndpointTypes.getOrders);
  }

  public getPositions(pageId: number = 0): Promise<any> {
    return this.call(IbCwpEndpointTypes.getPositions, { pageId });
  }

  private orderUpdatesSub$: Subject<any> | undefined;

  public subscribeOrders(): Subject<any> {
    this.orderUpdatesSub$ = new Subject();
    const cmd = `sor+{}`;
    // console.log('sending:', cmd);
    this.ws?.send(cmd);
    return this.orderUpdatesSub$;
  }

  /**
   * fetch historical bars until count match
   * @param contract IbContract to fetch data for
   * @param bar historical bars length
   * @param count total number of bars to fetch
   * @param {number} _endDateTime fetch bars before this date, undefined for fetching last available bars
   * @param outsideRth if true, fetch bars outside regular trading hours
   * @param previousBars older bars
   * @returns array of historical bars
   */
  public getLastHistoryBars(
    asset: AssetData,
    bar: BarSize,
    count: number,
    _endDateTime: number | undefined,
    outsideRth: boolean,
    previousBars: Bar[] = []
  ): Promise<Bar[]> {
    const period = computeDuration(undefined, bar, count, outsideRth);
    if (this.historyCallsLeft != 0 && period) {
      gtpLogger.log(
        LogLevel.Debug,
        "IbWcpConnection.getLastHistoryBars",
        asset,
        bar,
        count,
        period
      );
      this.historyCallsLeft -= 1;
      return this.findContract(asset)
        .then((conid) => {
          return this.call(IbCwpEndpointTypes.getHistorycalData, {
            conid,
            period,
            bar,
            outsideRth,
          }).then((result) => {});
        })
        .catch((error) => {
          gtpLogger.log(
            LogLevel.Error,
            "IbWcpConnection.getLastHistoryBars",
            asset,
            error
          );
          return [];
        });
    } else return Promise.resolve([]);
  }

  public getOptionExpiries(symbol: string): Promise<string[]> {
    gtpLogger.log(LogLevel.Debug, "IbWcpConnection.getOptionExpiries", symbol);
    return this.search(symbol).then((response) => {
      if (response.length) {
        const result = response[0].opt.split(";");
        gtpLogger.log(
          LogLevel.Debug,
          "IbWcpConnection.getOptionExpiries",
          symbol,
          result
        );
        return result;
      } else {
        gtpLogger.log(
          LogLevel.Error,
          "IbWcpConnection.getOptionExpiries",
          symbol,
          response
        );
        return [];
      }
    });
  }

  private processNtfMessage(data: any) {
    data.forEach((item: any) =>
      gtpLogger.info(
        item.title ?? "IbWcpConnection.processNtfMessage",
        item.text,
        item.id
      )
    );
  }

  private processBltMessage(data: any) {
    data.forEach((blt: any) =>
      gtpLogger.info(
        blt.processStreamM ?? "IbWcpConnection.processBltMessage",
        blt.processStreamM,
        blt.id
      )
    );
  }

  private processSorMessage(data: any) {
    this.orderUpdatesSub$?.next(data);
  }

  public getAccountSummary(previous: AccountSummary): Promise<any> {
    gtpLogger.log(LogLevel.Debug, "IbWcpConnection.getAccountSummary");
    return this.call(IbCwpEndpointTypes.getAccountSummary).then((response) => {
      gtpLogger.log(
        LogLevel.Debug,
        "IbWcpConnection.getAccountSummary",
        undefined,
        response
      );
      if ("buyingpower" in response)
        previous.buying_power = response.buyingpower.amount;
      if ("totalcashvalue" in response)
        previous.cash_balance = response.totalcashvalue.amount;
      if ("maintmarginreq" in response)
        previous.maint_margin = response.maintmarginreq.amount;
      return previous;
    });
  }
}
