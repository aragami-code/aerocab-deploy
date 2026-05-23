import {
  Controller,
  Get,
  Post,
  Param,
  Res,
  UseGuards,
  NotFoundException,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SkipThrottle } from '@nestjs/throttler';

const UPLOAD_DIR = '/tmp/aerogo24-uploads';

/** KYC documents — JWT protected */
@Controller('uploads')
@UseGuards(JwtAuthGuard)
@SkipThrottle()
export class UploadsController {
  @Get(':filename')
  serveFile(@Param('filename') filename: string, @Res() res: any) {
    const safe = path.basename(filename);
    const filePath = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(filePath)) throw new NotFoundException('Fichier introuvable');
    res.sendFile(filePath);
  }

  @Post('ticket-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const MIME_TO_EXT: Record<string, string> = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/webp': '.webp',
          };
          const ext = MIME_TO_EXT[file.mimetype] ?? '.jpg';
          cb(null, `ticket-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
        if (!ALLOWED.includes(file.mimetype)) {
          return cb(new BadRequestException('Formats acceptés : JPG, PNG, WebP'), false);
        }
        cb(null, true);
      },
    }),
  )
  uploadTicketImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Aucun fichier reçu');
    return { url: `/api/ticket-images/${file.filename}` };
  }
}

/** Ticket images — public access (no JWT), only ticket- prefixed files */
@Controller('ticket-images')
@SkipThrottle()
export class TicketImagesController {
  @Get(':filename')
  serveTicketImage(@Param('filename') filename: string, @Res() res: any) {
    const safe = path.basename(filename);
    if (!safe.startsWith('ticket-')) throw new ForbiddenException('Accès refusé');
    const filePath = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(filePath)) throw new NotFoundException('Fichier introuvable');
    res.sendFile(filePath);
  }
}

/** Chat images — public access (no JWT), only chat- prefixed files */
@Controller('chat-images')
@SkipThrottle()
export class ChatImagesController {
  @Get(':filename')
  serveChatImage(@Param('filename') filename: string, @Res() res: any) {
    const safe = path.basename(filename);
    if (!safe.startsWith('chat-')) throw new ForbiddenException('Accès refusé');
    const filePath = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(filePath)) throw new NotFoundException('Fichier introuvable');
    res.sendFile(filePath);
  }
}
