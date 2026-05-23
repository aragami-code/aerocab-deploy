"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateForfaitDto = void 0;
const mapped_types_1 = require("@nestjs/mapped-types");
const create_forfait_dto_1 = require("./create-forfait.dto");
class UpdateForfaitDto extends (0, mapped_types_1.PartialType)(create_forfait_dto_1.CreateForfaitDto) {
}
exports.UpdateForfaitDto = UpdateForfaitDto;
//# sourceMappingURL=update-forfait.dto.js.map