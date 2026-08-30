import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A Prisma client or an open interactive transaction.
 *
 * Repository methods take this so the same call works standalone or inside a
 * caller's transaction — every financial service method runs in one
 * (CLAUDE.md), and the repository must not decide that for them.
 */
export type Db = PrismaService | Prisma.TransactionClient;
