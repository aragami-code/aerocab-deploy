"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mock_email_provider_1 = require("./providers/mock-email.provider");
const sendgrid_email_provider_1 = require("./providers/sendgrid-email.provider");
const smtp_email_provider_1 = require("./providers/smtp-email.provider");
const email_router_service_1 = require("./email-router.service");
const settings_module_1 = require("../settings/settings.module");
let EmailModule = class EmailModule {
};
exports.EmailModule = EmailModule;
exports.EmailModule = EmailModule = __decorate([
    (0, common_1.Module)({
        imports: [config_1.ConfigModule, settings_module_1.SettingsModule],
        providers: [
            mock_email_provider_1.MockEmailProvider,
            sendgrid_email_provider_1.SendgridEmailProvider,
            smtp_email_provider_1.SmtpEmailProvider,
            email_router_service_1.EmailRouterService,
        ],
        exports: [email_router_service_1.EmailRouterService],
    })
], EmailModule);
//# sourceMappingURL=email.module.js.map