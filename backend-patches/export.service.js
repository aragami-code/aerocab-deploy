"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportService = void 0;
const common_1 = require("@nestjs/common");
let ExportService = class ExportService {
    async buildPdf(title, subtitle, headers, rows) {
        return Buffer.from('%PDF-1.4\n%%EOF\n');
    }
    async buildXlsx(title, headers, rows) {
        return Buffer.from('');
    }
    toCsv(headers, rows) {
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
    }
};
exports.ExportService = ExportService;
exports.ExportService = ExportService = __decorate([
    (0, common_1.Injectable)()
], ExportService);
