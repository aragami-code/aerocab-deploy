import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { CountriesService } from './countries.service';

@Module({
  imports: [PrismaModule],
  providers: [CountriesService],
  exports: [CountriesService],
})
export class CountriesModule implements OnModuleInit {
  constructor(private readonly countries: CountriesService) {}
  async onModuleInit() {
    await this.countries.backfillKnownCountries();
  }
}
