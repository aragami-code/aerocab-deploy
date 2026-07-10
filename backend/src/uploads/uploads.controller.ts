import {
  Controller,
  Get,
  Post,
  Param,
  Query,
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
import { RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { SkipThrottle } from '@nestjs/throttler';

const UPLOAD_DIR = '/data/uploads';
// Volume persistant (bind-mount ./apk-storage:/data/apk) — survit aux redéploiements.
const APK_DIR = '/data/apk';
try { fs.mkdirSync(APK_DIR, { recursive: true }); } catch { /* ignore */ }

function apkSlot(app?: string): 'passenger' | 'driver' {
  return app === 'driver' ? 'driver' : 'passenger';
}

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

/** Upload APK — admin uniquement. Stocke {app}.apk dans le volume persistant. */
@Controller('uploads')
@UseGuards(JwtAuthGuard, RolesGuard)
@SkipThrottle()
export class ApkUploadController {
  @Post('apk')
  @Roles('admin')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: APK_DIR,
        filename: (req: any, _file, cb) => cb(null, `${apkSlot(req.query?.app)}.apk`),
      }),
      limits: { fileSize: 300 * 1024 * 1024 }, // 300 Mo
      fileFilter: (_req, file, cb) => {
        if (!/\.apk$/i.test(file.originalname)) {
          return cb(new BadRequestException('Un fichier .apk est requis'), false);
        }
        cb(null, true);
      },
    }),
  )
  uploadApk(@UploadedFile() file: Express.Multer.File, @Query('app') app?: string) {
    if (!file) throw new BadRequestException('Aucun fichier reçu');
    const slot = apkSlot(app);
    // URL relative ; l'admin la préfixe avec son origine API.
    return { url: `/api/apk/${slot}.apk`, slot, size: file.size };
  }
}

/** Service public de l'APK (téléchargement in-app). Seuls passenger.apk / driver.apk. */
@Controller('apk')
@SkipThrottle()
export class ApkController {
  @Get(':filename')
  serveApk(@Param('filename') filename: string, @Res() res: any) {
    const safe = path.basename(filename);
    if (!/^(passenger|driver)\.apk$/.test(safe)) throw new ForbiddenException('Accès refusé');
    const filePath = path.join(APK_DIR, safe);
    if (!fs.existsSync(filePath)) throw new NotFoundException('APK introuvable');
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
    res.sendFile(filePath);
  }
}
