import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FlightsService } from './flights.service';
import { CreateFlightDto, SearchFlightDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('flights')
@UseGuards(JwtAuthGuard)
export class FlightsController {
  constructor(private flightsService: FlightsService) {}

  /**
   * GET /flights/live/:flightNumber
   * Données complètes : infos statiques + position temps réel
   */
  @Get('live/:flightNumber')
  async getLiveFlightDetails(@Param('flightNumber') flightNumber: string) {
    const result = await this.flightsService.getLiveFlightDetails(flightNumber);
    if (!result) return { found: false };
    return { found: true, flight: result };
  }

  /**
   * GET /flights/search?flightNumber=AF946
   * Search for flight info from API / mock
   */
  @Get('search')
  async searchFlight(@Query() query: SearchFlightDto) {
    const result = await this.flightsService.searchFlight(query.flightNumber);

    if (!result) {
      return {
        found: false,
        message: 'Vol non trouve. Vous pouvez saisir les informations manuellement.',
      };
    }

    return { found: true, flight: result };
  }

  /**
   * POST /flights
   * Create/save a flight for the current user
   */
  @Post()
  async createFlight(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateFlightDto,
  ) {
    return this.flightsService.createFlight(userId, dto);
  }

  /**
   * GET /flights/me
   * Get all flights for current user
   */
  @Get('me')
  async getMyFlights(@CurrentUser('id') userId: string) {
    return this.flightsService.getUserFlights(userId);
  }

  /**
   * GET /flights/active
   * Get the next upcoming flight for current user
   */
  @Get('active')
  async getActiveFlight(@CurrentUser('id') userId: string) {
    const flight = await this.flightsService.getActiveFlight(userId);
    return { flight };
  }

  /**
   * GET /flights/:id
   * Get a specific flight by ID
   */
  @Get(':id')
  async getFlightById(@Param('id') id: string) {
    return this.flightsService.getFlightById(id);
  }

  /**
   * DELETE /flights/:id
   * Delete a flight
   */
  @Delete(':id')
  async deleteFlight(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.flightsService.deleteFlight(userId, id);
  }
}
