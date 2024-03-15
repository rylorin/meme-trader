import { SymbolDesc } from "./kucoin-api";

export class MemeTrader {
  private readonly symbol: SymbolDesc;
  private timer: NodeJS.Timeout | undefined;

  constructor(symbol: SymbolDesc) {
    console.info("Creating trader for:", symbol.symbol);
    this.symbol = symbol;
  }

  public start(): void {
    console.info("Starting trader for:", this.symbol.symbol);
    this.timer = setInterval(() => this.check(), 5 * 60 * 1000);
  }

  public check(): void {
    console.info("Checking trader for:", this.symbol.symbol);
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
