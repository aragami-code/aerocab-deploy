import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { IsBoolean } from 'class-validator';

class SetProximityDto {
  @IsBoolean()
  enabled!: boolean;
}

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get()
  getAll() {
    return this.settings.getAll();
  }

  @Get('proximity-assignment')
  async getProximity() {
    const enabled = await this.settings.isProximityAssignmentEnabled();
    return { proximityAssignment: enabled };
  }

  @Patch('proximity-assignment')
  async setProximity(@Body() dto: SetProximityDto) {
    await this.settings.setProximityAssignment(dto.enabled);
    return { proximityAssignment: dto.enabled };
  }
}
