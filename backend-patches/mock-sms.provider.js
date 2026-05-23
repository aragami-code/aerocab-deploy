"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var MockSmsProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockSmsProvider = void 0;
const common_1 = require("@nestjs/common");
let MockSmsProvider = MockSmsProvider_1 = class MockSmsProvider {
    constructor() {
        this.name = 'mock';
        this.logger = new common_1.Logger(MockSmsProvider_1.name);
    }
    async send(to, message) {
        this.logger.log(`[MockSMS] To: ${to} | Message: ${message}`);
        // Visible dans Render logs même avec filtre
        console.log(`\n${'='.repeat(60)}\n[MOCK-SMS] DESTINATAIRE: ${to}\n[MOCK-SMS] MESSAGE: ${message}\n${'='.repeat(60)}\n`);
        return true;
    }
};
exports.MockSmsProvider = MockSmsProvider;
exports.MockSmsProvider = MockSmsProvider = MockSmsProvider_1 = __decorate([
    (0, common_1.Injectable)()
], MockSmsProvider);
//# sourceMappingURL=mock-sms.provider.js.map