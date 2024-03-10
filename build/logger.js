"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gtpLogger = exports.Logger = exports.LogLevel = void 0;
const json_stringify_safe_1 = __importDefault(require("json-stringify-safe"));
const winston_1 = require("winston");
exports.LogLevel = {
    Fatal: 0,
    Error: 1,
    Warning: 2,
    Info: 3,
    Debug: 4,
    Trace: 5,
};
// from colors.js library https://github.com/Marak/colors.js/blob/master/lib/styles.js
// const bold = [1, 22];
// const brightRed = [91, 39];
// const brightYellow = [93, 39];
// const brightBlue = [94, 39];
const level = parseInt(process.env.LOG_LEVEL) || exports.LogLevel.Info; // Default to info
const log_modules = (process.env.LOG_MODULES || "").split(",");
const log_console = (process.env.LOG_CONSOLE || "").split(",");
/**
 * Logger facility class
 */
class Logger {
    constructor() {
        // this.log_debug_console = (process.env.LOG_DEBUG_CONSOLE as string) == 'true';
        // const logFilePath = join(app.getPath('logs'), logFile ?? 'backend_log.csv');
        this.loggers = {};
        // create default logger
        this.loggers["default"] = this.createLogger("backend_log");
        // create other loggers
        log_modules.forEach((item) => {
            this.loggers[item] = this.createLogger(item);
        });
    }
    createLogger(module) {
        const to_console = log_console.findIndex((item) => item == module) >= 0;
        return (0, winston_1.createLogger)({
            transports: [
                new winston_1.transports.File({
                    dirname: "./logs",
                    filename: module + ".csv",
                    level: Logger.level2string(level),
                    tailable: true,
                    format: winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.printf(({ timestamp, level, message, service, asset }) => {
                        return `${timestamp};${level};${service};${asset};${message}`;
                    })),
                    maxsize: 2 * 1024 * 1024, // 2Mb
                    maxFiles: 5,
                }),
                new winston_1.transports.Console({
                    level: to_console ? "debug" : "info",
                    format: winston_1.format.combine(winston_1.format.colorize(), winston_1.format.timestamp(), winston_1.format.printf(({ timestamp, level, message, service, asset }) => {
                        const service_text = service ? ` [${service}]` : "";
                        const asset_text = asset ? ` (${asset})` : "";
                        return `[${timestamp}] ${level}${service_text}${asset_text} ${message}`;
                    })),
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
    static level2string(level) {
        let result;
        switch (level) {
            case exports.LogLevel.Fatal:
                result = "error";
                break;
            case exports.LogLevel.Error:
                result = "error";
                break;
            case exports.LogLevel.Warning:
                result = "warn";
                break;
            case exports.LogLevel.Info:
                result = "info";
                break;
            case exports.LogLevel.Debug:
                result = "debug";
                break;
            case exports.LogLevel.Trace:
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
    log(level, module, asset, ...args) {
        let mainmodule;
        let submodule;
        let assetString;
        if (asset == undefined)
            assetString = "";
        else if (typeof asset == "string")
            assetString = asset;
        const [s0, s1] = module.split(".");
        if (s1) {
            mainmodule = s0;
            submodule = s1;
        }
        else {
            mainmodule = "default";
            submodule = s0;
        }
        const message = args
            .map((value) => {
            if (value === undefined)
                return "undefined";
            else if (value === null)
                return "null";
            else if (typeof value === "string")
                return value.replaceAll("\n", "\\n");
            else if (typeof value === "number")
                return String(value);
            else
                return (0, json_stringify_safe_1.default)(value);
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
        if (level === exports.LogLevel.Fatal)
            process.exit(-1);
    }
    /**
     * Display an error notification (and log it)
     * @param title title of the notification
     * @param description content of the notification
     * @param id an id for this notification to prevent duplicates
     */
    error(title, description, id) {
        this.log(exports.LogLevel.Error, title, undefined, description);
    }
    /**
     * Display a warning notification (and log it)
     * @param title title of the notification
     * @param description content of the notification
     * @param id an id for this notification to prevent duplicates
     */
    warn(title, description, id) {
        this.log(exports.LogLevel.Warning, title, undefined, description);
    }
    /**
     * Display an info notification (and log it)
     * @param title title of the notification
     * @param description content of the notification
     * @param id an id for this notification to prevent duplicates
     */
    info(title, description, id) {
        this.log(exports.LogLevel.Info, title, undefined, description);
    }
}
exports.Logger = Logger;
/** singleton instance of Logger */
exports.gtpLogger = new Logger();
