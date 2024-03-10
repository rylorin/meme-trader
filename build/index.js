"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MyTradingBotApp = void 0;
class MyTradingBotApp {
    constructor(config) {
        this.config = config;
        this.api = new kucoin_api_1.KuCoinApi(config);
    }
    start() { }
}
exports.MyTradingBotApp = MyTradingBotApp;
const config_1 = __importDefault(require("config"));
const dotenv_1 = __importDefault(require("dotenv"));
const kucoin_api_1 = require("./kucoin-api");
dotenv_1.default.config(); // eslint-disable-line @typescript-eslint/no-var-requires,@typescript-eslint/no-unsafe-call
console.log("NODE_ENV", process.env["NODE_ENV"]);
const app = new MyTradingBotApp(config_1.default);
app.start();
