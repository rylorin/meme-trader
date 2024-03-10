import { SymbolDesc } from "./kucoin-api";

export class MemeTrader {
  private readonly symbol: SymbolDesc;

  constructor(symbol: SymbolDesc) {
    this.symbol = symbol;
    console.info("starting trader for:", this.symbol);
  }

  public start(): void {}
}
