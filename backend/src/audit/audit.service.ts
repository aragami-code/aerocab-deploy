import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface AuditLogEntry {
  action: string;
  entity: string;
  entityId?: string;
  userId?: string;
  adminId?: string;
  meta?: Record<string, unknown>;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(entry: AuditLogEntry) {
    return this.prisma.auditLog.create({
      data: {
        ...entry,
        meta: entry.meta as Prisma.InputJsonValue ?? Prisma.JsonNull,
      },
    });
  }

  async findAll(filters?: {
    entity?: string;
    entityId?: string;
    userId?: string;
    adminId?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (filters?.entity)   where.entity   = filters.entity;
    if (filters?.entityId) where.entityId = filters.entityId;
    if (filters?.userId)   where.userId   = filters.userId;
    if (filters?.adminId)  where.adminId  = filters.adminId;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:  filters?.limit  ?? 50,
        skip:  filters?.offset ?? 0,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total };
  }
}
