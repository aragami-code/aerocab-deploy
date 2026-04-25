import { PartialType } from '@nestjs/mapped-types';
import { CreateForfaitDto } from './create-forfait.dto';

export class UpdateForfaitDto extends PartialType(CreateForfaitDto) {}
