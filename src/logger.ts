import { IConfig, default as config } from "config";
import stringify from "json-stringify-safe";
import { Telegraf, Telegram } from "telegraf";
import {
  Logger as WinstonLogger,
  createLogger,
  format,
  transports,
  default as winston,
} from "winston";
import Transport from "winston-transport";

export const LogLevel = {
  Fatal: 0,
  Error: 1,
  Warning: 2,
  Info: 3,
  Debug: 4,
  Trace: 5,
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

// from colors.js library https://github.com/Marak/colors.js/blob/master/lib/styles.js
// const bold = [1, 22];
// const brightRed = [91, 39];
// const brightYellow = [93, 39];
// const brightBlue = [94, 39];
//

// Inherit from `winston-transport` so you can take advantage
// of the base functionality and `.exceptions.handle()`.
//
class CustomTransport extends Transport {
  private readonly telegram: Telegram;
  private readonly chatId: number | undefined;

  constructor(config: IConfig, opts?: Record<string, any>) {
    super(opts);

    //
    // Consume any custom options here. e.g.:
    // - Connection information for databases
    // - Authentication information for APIs (e.g. loggly, papertrail,
    //   logentries, etc.).
    //
    this.telegram = new Telegram(config.get("telegram.apiKey"));
    if (config.has("telegram.console"))
      this.chatId = config.get("telegram.console");
  }

  log(info: any, callback: () => void): void {
    // Perform the writing to the remote service
    if (this.chatId) {
      this.telegram
        .sendMessage(this.chatId, info[Symbol.for("message")] as string)
        .then(() => callback())
        .catch((error: Error) => console.error(error));
    } else {
      callback();
    }
  }
}

/**
 * Logger facility class
 */
export class Logger {
  private readonly config: IConfig;
  private readonly telegram: Telegraf;
  private loggers: WinstonLogger;

  constructor(config: IConfig) {
    this.config = config;
    // create default logger
    this.loggers = this.createLogger(this.config);
    this.telegram = new Telegraf(this.config.get("telegram.apiKey"));
  }

  private createLogger(config: IConfig): winston.Logger {
    return createLogger({
      transports: [
        new CustomTransport(config, {
          level: this.config.get("gLogger.telegram"),
          format: format.printf(({ level, message, asset }) => {
            const asset_text = asset ? ` (${asset})` : "";
            return `[${level}]${asset_text} ${message}`;
          }),
        }),
        new transports.File({
          dirname: "./logs",
          filename: "default.csv",
          level: this.config.get("gLogger.default"),
          tailable: true,
          format: format.combine(
            format.timestamp(),
            format.printf(({ timestamp, level, message, service, asset }) => {
              return `${timestamp};${level};${service};${asset};${message}`;
            }),
          ),
          maxsize: 1 * 1024 * 1024, // 1Mb
          maxFiles: 3,
        }),
        new transports.Console({
          level: this.config.get("gLogger.console"),
          format: format.combine(
            format.colorize(),
            format.timestamp(),
            format.printf(({ timestamp, level, message, service, asset }) => {
              const service_text = service ? ` [${service}]` : "";
              const asset_text = asset ? ` (${asset})` : "";
              return `[${timestamp}] ${level}${service_text}${asset_text} ${message}`;
            }),
          ),
        }),
      ],
      // exceptionHandlers: [
      //   new transports.Console(),
      //   new transports.File({ dirname: app.getPath('logs'), filename: 'exceptions.log' }),
      // ],
      // rejectionHandlers: [
      //   new transports.Console(),
      //   new transports.File({ dirname: app.getPath('logs'), filename: 'rejections.log' }),
      // ],
      exitOnError: false,
    });
  }

  static level2string(level: LogLevel): string {
    let result: string;
    switch (level) {
      case LogLevel.Fatal:
        result = "error";
        break;
      case LogLevel.Error:
        result = "error";
        break;
      case LogLevel.Warning:
        result = "warn";
        break;
      case LogLevel.Info:
        result = "info";
        break;
      case LogLevel.Debug:
        result = "debug";
        break;
      case LogLevel.Trace:
        result = "silly";
        break;
      default:
        result = "undefined";
    }
    return result;
  }

  // Apply some color styles
  // private static bold(s: string): string {
  //   return '\u001b[' + bold[0] + 'm' + s + '\u001b[' + bold[1] + 'm';
  // }
  // private static red(s: string): string {
  //   return '\u001b[' + brightRed[0] + 'm' + s + '\u001b[' + brightRed[1] + 'm';
  // }
  // private static yellow(s: string): string {
  //   return '\u001b[' + brightYellow[0] + 'm' + s + '\u001b[' + brightYellow[1] + 'm';
  // }
  // private static blue(s: string): string {
  //   return '\u001b[' + brightBlue[0] + 'm' + s + '\u001b[' + brightBlue[1] + 'm';
  // }

  /**
   * Log one line
   * @param level level of message
   * @param module module issuing message
   * @param assetString asset related to message
   * @param args message (strings) to log
   */
  public log(
    level: LogLevel,
    module: string,
    asset?: string | undefined,
    ...args: any[]
  ): void {
    let assetString: string;
    if (asset == undefined) assetString = "";
    else if (typeof asset == "string") assetString = asset;
    else assetString = typeof asset;
    const message: string = args
      .map((value) => {
        if (value === undefined) return "undefined";
        else if (value === null) return "null";
        else if (typeof value === "string")
          return value.replaceAll("\n", "\\n");
        else if (typeof value === "number") return String(value);
        else return stringify(value);
      })
      .join(", ");
    this.loggers.log({
      level: Logger.level2string(level),
      message,
      service: module,
      asset: assetString,
    });
    if (level === LogLevel.Fatal) process.exit(-1);
  }

  /**
   * Display an error notification (and log it)
   * @param title title of the notification
   * @param description content of the notification
   */
  public error(title: string, description: string): void {
    this.log(LogLevel.Error, title, undefined, description);
  }

  /**
   * Display a warning notification (and log it)
   * @param title title of the notification
   * @param description content of the notification
   */
  public warn(title: string, description: string): void {
    this.log(LogLevel.Warning, title, undefined, description);
  }

  /**
   * Display an info notification (and log it)
   * @param title title of the notification
   * @param description content of the notification
   */
  public info(title: string, description: string): void {
    this.log(LogLevel.Info, title, undefined, description);
  }

  /**
   * Display a debug notification (and log it)
   * @param title title of the notification
   * @param description content of the notification
   */
  public debug(title: string, description: string): void {
    this.log(LogLevel.Debug, title, undefined, description);
  }

  /**
   * Display a debug notification (and log it)
   * @param trace title of the notification
   * @param description content of the notification
   */
  public trace(title: string, description: string): void {
    this.log(LogLevel.Trace, title, undefined, description);
  }
}

/** singleton instance of Logger */
export const gLogger = new Logger(config);
