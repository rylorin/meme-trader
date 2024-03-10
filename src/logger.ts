import stringify from "json-stringify-safe";
import {
  Logger as WinstonLogger,
  createLogger,
  format,
  transports,
  default as winston,
} from "winston";

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

const level =
  (parseInt(process.env.LOG_LEVEL as string) as LogLevel) || LogLevel.Info; // Default to info
const log_modules: string[] = ((process.env.LOG_MODULES as string) || "").split(
  ","
);
const log_console: string[] = ((process.env.LOG_CONSOLE as string) || "").split(
  ","
);

/**
 * Logger facility class
 */
export class Logger {
  private loggers: Record<string, WinstonLogger> = {};

  constructor() {
    // this.log_debug_console = (process.env.LOG_DEBUG_CONSOLE as string) == 'true';
    // const logFilePath = join(app.getPath('logs'), logFile ?? 'backend_log.csv');

    // create default logger
    this.loggers["default"] = this.createLogger("backend_log");
    // create other loggers
    log_modules.forEach((item) => {
      this.loggers[item] = this.createLogger(item);
    });
  }

  private createLogger(module: string): winston.Logger {
    const to_console: boolean =
      log_console.findIndex((item) => item == module) >= 0;
    return createLogger({
      transports: [
        new transports.File({
          dirname: "./logs",
          filename: module + ".csv",
          level: Logger.level2string(level),
          tailable: true,
          format: format.combine(
            format.timestamp(),
            format.printf(({ timestamp, level, message, service, asset }) => {
              return `${timestamp};${level};${service};${asset};${message}`;
            })
          ),
          maxsize: 2 * 1024 * 1024, // 2Mb
          maxFiles: 5,
        }),
        new transports.Console({
          level: to_console ? "debug" : "info",
          format: format.combine(
            format.colorize(),
            format.timestamp(),
            format.printf(({ timestamp, level, message, service, asset }) => {
              const service_text = service ? ` [${service}]` : "";
              const asset_text = asset ? ` (${asset})` : "";
              return `[${timestamp}] ${level}${service_text}${asset_text} ${message}`;
            })
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
    let mainmodule: string;
    let submodule: string;
    let assetString: string;
    if (asset == undefined) assetString = "";
    else if (typeof asset == "string") assetString = asset;
    const [s0, s1] = module.split(".");
    if (s1) {
      mainmodule = s0;
      submodule = s1;
    } else {
      mainmodule = "default";
      submodule = s0;
    }
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
    if (this.loggers[mainmodule])
      this.loggers[mainmodule].log({
        level: Logger.level2string(level),
        message,
        service: submodule,
        asset: "assetString",
      });
    this.loggers["default"].log({
      level: Logger.level2string(level),
      message,
      service: module,
      asset: "assetString",
    });
    if (level === LogLevel.Fatal) process.exit(-1);
  }

  /**
   * Display an error notification (and log it)
   * @param title title of the notification
   * @param description content of the notification
   * @param id an id for this notification to prevent duplicates
   */
  public error(title: string, description: string, id: string) {
    this.log(LogLevel.Error, title, undefined, description);
  }

  /**
   * Display a warning notification (and log it)
   * @param title title of the notification
   * @param description content of the notification
   * @param id an id for this notification to prevent duplicates
   */
  public warn(title: string, description: string, id: string) {
    this.log(LogLevel.Warning, title, undefined, description);
  }

  /**
   * Display an info notification (and log it)
   * @param title title of the notification
   * @param description content of the notification
   * @param id an id for this notification to prevent duplicates
   */
  public info(title: string, description: string, id: string) {
    this.log(LogLevel.Info, title, undefined, description);
  }
}

/** singleton instance of Logger */
export const gtpLogger = new Logger();
