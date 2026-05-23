"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotController = void 0;
const common_1 = require("@nestjs/common");
const bot_service_1 = require("./bot.service");
const chat_message_dto_1 = require("./dto/chat-message.dto");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../auth/decorators/current-user.decorator");
let BotController = class BotController {
    constructor(botService) {
        this.botService = botService;
    }
    async sendMessage(userId, body) {
        var _a;
        return this.botService.chat(userId, body.message, (_a = body.history) !== null && _a !== void 0 ? _a : []);
    }
};
exports.BotController = BotController;
__decorate([
    (0, common_1.Post)('message'),
    __param(0, (0, current_user_decorator_1.CurrentUser)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, chat_message_dto_1.SendBotMessageDto]),
    __metadata("design:returntype", Promise)
], BotController.prototype, "sendMessage", null);
exports.BotController = BotController = __decorate([
    (0, common_1.Controller)('bot'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [bot_service_1.BotService])
], BotController);
//# sourceMappingURL=bot.controller.js.map