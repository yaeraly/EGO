import { Injectable, NotFoundException } from '@nestjs/common';
import { investors } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvestorDto, UpdateInvestorDto } from './dto/capital.dto';

/**
 * Investor directory (§3).
 *
 * Investors are deactivated rather than deleted: their capital contributions
 * and returns stay attributable, the same rule staff records follow.
 */
@Injectable()
export class InvestorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateInvestorDto, userId: string): Promise<investors> {
    const investor = await this.prisma.investors.create({
      data: { name: dto.name, phone: dto.phone ?? null },
    });

    await this.audit.log({
      userId,
      entity: 'investors',
      entityId: investor.id,
      action: 'INVESTOR_CREATED',
      newValue: { name: investor.name, phone: investor.phone },
    });

    return investor;
  }

  findAll(includeInactive = false): Promise<investors[]> {
    return this.prisma.investors.findMany({
      where: includeInactive ? {} : { is_active: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string): Promise<investors> {
    const investor = await this.prisma.investors.findUnique({ where: { id } });
    if (!investor) {
      throw new NotFoundException('Investor not found');
    }
    return investor;
  }

  async update(
    id: string,
    dto: UpdateInvestorDto,
    userId: string,
  ): Promise<investors> {
    const before = await this.findOne(id);

    const investor = await this.prisma.investors.update({
      where: { id },
      data: { name: dto.name, phone: dto.phone, is_active: dto.is_active },
    });

    await this.audit.log({
      userId,
      entity: 'investors',
      entityId: id,
      action: 'INVESTOR_UPDATED',
      oldValue: { name: before.name, phone: before.phone, is_active: before.is_active },
      newValue: {
        name: investor.name,
        phone: investor.phone,
        is_active: investor.is_active,
      },
    });

    return investor;
  }
}
