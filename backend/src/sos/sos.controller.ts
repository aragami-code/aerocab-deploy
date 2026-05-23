import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Req, UseGuards,
  UseInterceptors, UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SosService } from './sos.service';

@Controller('sos')
@UseGuards(JwtAuthGuard)
export class SosController {
  constructor(private readonly sos: SosService) {}

  // ── Contacts d'urgence ───────────────────────────────────────────────────────

  @Get('contacts')
  getContacts(@Req() req: any) {
    return this.sos.getContacts(req.user.id);
  }

  @Post('contacts')
  addContact(@Req() req: any, @Body() dto: { name: string; phone: string; relation?: string }) {
    if (!dto.name || !dto.phone) throw new BadRequestException('name et phone requis');
    return this.sos.addContact(req.user.id, dto);
  }

  @Patch('contacts/:id')
  updateContact(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: { name?: string; phone?: string; relation?: string },
  ) {
    return this.sos.updateContact(req.user.id, id, dto);
  }

  @Delete('contacts/:id')
  deleteContact(@Req() req: any, @Param('id') id: string) {
    return this.sos.deleteContact(req.user.id, id);
  }

  // ── Déclenchement SOS ────────────────────────────────────────────────────────

  @Post('trigger')
  triggerSos(
    @Req() req: any,
    @Body() body: { bookingId?: string; lat?: number; lng?: number; audioUrl?: string },
  ) {
    return this.sos.triggerSos(req.user.id, body);
  }

  // ── Upload audio ─────────────────────────────────────────────────────────────

  @Post('audio')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: diskStorage({
        destination: '/tmp/aerogo24-uploads',
        filename: (_req, file, cb) => {
          const unique = `sos-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          cb(null, unique + extname(file.originalname));
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('audio/')) cb(null, true);
        else cb(new BadRequestException('Fichier audio requis'), false);
      },
    }),
  )
  async uploadAudio(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { bookingId?: string },
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu');
    const audioUrl = `/uploads/${file.filename}`;
    return this.sos.saveAudioUrl(req.user.id, body.bookingId, audioUrl);
  }
}
