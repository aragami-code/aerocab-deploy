import {
  Controller,
  Get,
  Param,
  Res,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SkipThrottle } from '@nestjs/throttler';

const UPLOAD_DIR = '/tmp/aerogo24-uploads';

/**
 * 0.B8 — Documents KYC protégés par JWT.
 * Remplace useStaticAssets('/uploads') qui exposait les fichiers publiquement.
 */
@Controller('uploads')
@UseGuards(JwtAuthGuard)
@SkipThrottle()
export class UploadsController {
  @Get(':filename')
  serveFile(@Param('filename') filename: string, @Res() res: any) {
    // Prevent path traversal
    const safe = path.basename(filename);
    const filePath = path.join(UPLOAD_DIR, safe);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Fichier introuvable');
    }

    res.sendFile(filePath);
  }
}
