import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { RbacModule } from '../rbac/rbac.module';
import { CountriesService } from './countries.service';
import { CountriesController } from './countries.controller';

@Module({
  imports: [PrismaModule, RbacModule],
  controllers: [CountriesController],
  providers: [CountriesService],
  exports: [CountriesService],
})
export class CountriesModule implements OnModuleInit {
  constructor(private readonly countries: CountriesService) {}
  async onModuleInit() {
    await this.countries.backfillKnownCountries();
  }
}
