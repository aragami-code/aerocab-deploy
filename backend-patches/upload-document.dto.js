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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadDocumentDto = exports.DocumentTypeEnum = void 0;
const class_validator_1 = require("class-validator");
var DocumentTypeEnum;
(function (DocumentTypeEnum) {
    DocumentTypeEnum["CNI_FRONT"] = "cni_front";
    DocumentTypeEnum["CNI_BACK"] = "cni_back";
    DocumentTypeEnum["LICENSE"] = "license";
    DocumentTypeEnum["REGISTRATION"] = "registration";
    DocumentTypeEnum["VEHICLE_PHOTO"] = "vehicle_photo";
})(DocumentTypeEnum || (exports.DocumentTypeEnum = DocumentTypeEnum = {}));
class UploadDocumentDto {
}
exports.UploadDocumentDto = UploadDocumentDto;
__decorate([
    (0, class_validator_1.IsEnum)(DocumentTypeEnum, {
        message: 'Type de document invalide. Valeurs acceptees: cni_front, cni_back, license, registration, vehicle_photo',
    }),
    __metadata("design:type", String)
], UploadDocumentDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UploadDocumentDto.prototype, "fileUrl", void 0);
//# sourceMappingURL=upload-document.dto.js.map