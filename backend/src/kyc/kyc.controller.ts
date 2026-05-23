import {
  Controller, Get, Post, Param, Query, Body,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { SkipThrottle } from '@nestjs/throttler';
import { KycService } from './kyc.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { CurrentUser, Roles } from '../auth/decorators';

const KYC_UPLOAD_DIR = '/tmp/aerogo24-uploads';

const kycStorage = diskStorage({
  destination: KYC_UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const MIME_TO_EXT: Record<string, string> = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    };
    const ext = MIME_TO_EXT[file.mimetype] ?? '.jpg';
    cb(null, `kyc-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const kycFileFilter = (_req: any, file: Express.Multer.File, cb: any) => {
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
  if (!ALLOWED.includes(file.mimetype)) {
    return cb(new BadRequestException('Formats acceptés : JPG, PNG, WebP'), false);
  }
  cb(null, true);
};

@SkipThrottle()
@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private kycService: KycService) {}

  @Get('status')
  getStatus(@CurrentUser('id') userId: string) {
    return this.kycService.getStatus(userId);
  }

  @Post('upload/:type')
  @UseInterceptors(FileInterceptor('file', {
    storage: kycStorage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: kycFileFilter,
  }))
  uploadDocument(
    @CurrentUser('id') userId: string,
    @Param('type') type: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.kycService.uploadDocument(userId, type, file);
  }

  @Post('submit')
  submitForReview(@CurrentUser('id') userId: string) {
    return this.kycService.submitForReview(userId);
  }

  // ── Admin ────────────────────────────────────────────────────────────────────

  @Get('admin/pending')
  @UseGuards(RolesGuard)
  @Roles('admin', 'superadmin')
  getKycPending(@Query('page') page?: string) {
    return this.kycService.getPending(page ? parseInt(page) : 1);
  }

  @Post('admin/:userId/review')
  @UseGuards(RolesGuard)
  @Roles('admin', 'superadmin')
  reviewKyc(
    @Param('userId') userId: string,
    @Body() body: { action: 'approve' | 'reject'; reason?: string },
  ) {
    return this.kycService.reviewKyc(userId, body.action, body.reason);
  }
}
