"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var MockEmailProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockEmailProvider = void 0;
const common_1 = require("@nestjs/common");
let MockEmailProvider = MockEmailProvider_1 = class MockEmailProvider {
    constructor() {
        this.name = 'mock';
        this.logger = new common_1.Logger(MockEmailProvider_1.name);
    }
    async send(to, subject, html) {
        this.logger.log(`[MockEmail] To: ${to} | Subject: ${subject} | ${html.slice(0, 80)}...`);
        return true;
    }
};
exports.MockEmailProvider = MockEmailProvider;
exports.MockEmailProvider = MockEmailProvider = MockEmailProvider_1 = __decorate([
    (0, common_1.Injectable)()
], MockEmailProvider);
//# sourceMappingURL=mock-email.provider.js.map