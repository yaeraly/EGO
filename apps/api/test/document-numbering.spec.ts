import { INestApplication } from '@nestjs/common';
import { PrismaClient, doc_type } from '@prisma/client';
import { sequenceYear } from '../src/documents/document-number';
import { DocumentsService } from '../src/documents/documents.service';
import { createTestApp, resetDatabase } from './app-harness';
import { seedUser } from './fixtures';

const BUSINESS_DATE = new Date('2026-03-15T00:00:00.000Z');
const CONCURRENT = 100;

describe('Document numbering (Module 0.3, criterion 1)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let documents: DocumentsService;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    documents = app.get(DocumentsService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const user = await seedUser(prisma, {
      phone: '0700000001',
      password: 'numbering-password',
      pin: '12345678',
      role: 'OWNER',
    });
    userId = user.id;
  });

  const create = (docType: doc_type = doc_type.SAL, date = BUSINESS_DATE) =>
    documents.createStandalone({ docType, businessDate: date, userId });

  it('formats numbers as PREFIX-YYYY-NNNNNN', async () => {
    const document = await create();

    expect(document.doc_number).toBe(`SAL-${sequenceYear()}-000001`);
  });

  it(`issues ${CONCURRENT} unique numbers under full concurrency`, async () => {
    const created = await Promise.all(
      Array.from({ length: CONCURRENT }, () => create()),
    );

    const numbers = created.map((d) => d.doc_number);
    expect(new Set(numbers).size).toBe(CONCURRENT);

    // Not merely unique — a contiguous 1..N run, proving no number was
    // skipped or handed out twice.
    expect([...numbers].sort()).toEqual(
      Array.from({ length: CONCURRENT }, (_, i) =>
        `SAL-${sequenceYear()}-${String(i + 1).padStart(6, '0')}`,
      ),
    );

    const sequence = await prisma.doc_sequences.findUnique({
      where: { doc_type_year: { doc_type: doc_type.SAL, year: sequenceYear() } },
    });
    expect(sequence?.last_number).toBe(CONCURRENT);
    expect(await prisma.documents.count()).toBe(CONCURRENT);
  });

  it('keeps sequences independent per document type', async () => {
    const [sal, cap, trn] = await Promise.all([
      create(doc_type.SAL),
      create(doc_type.CAP),
      create(doc_type.TRN),
    ]);

    const year = sequenceYear();
    expect(sal.doc_number).toBe(`SAL-${year}-000001`);
    expect(cap.doc_number).toBe(`CAP-${year}-000001`);
    expect(trn.doc_number).toBe(`TRN-${year}-000001`);
  });

  // Numbering Standard: "YYYY — документ түзүлгөн жыл". Business Date and
  // Created Date are separate (Period Lock), so a backdated document still
  // takes the current year's sequence.
  it('numbers by creation year, not business date', async () => {
    const backdated = await create(
      doc_type.SAL,
      new Date('2024-06-01T00:00:00.000Z'),
    );
    const currentYear = sequenceYear();

    expect(backdated.doc_number).toBe(`SAL-${currentYear}-000001`);
  });

  it('shares one sequence across business dates in different years', async () => {
    const first = await create(doc_type.SAL, new Date('2025-12-31T00:00:00.000Z'));
    const second = await create(doc_type.SAL, new Date('2026-01-01T00:00:00.000Z'));
    const currentYear = sequenceYear();

    expect(first.doc_number).toBe(`SAL-${currentYear}-000001`);
    expect(second.doc_number).toBe(`SAL-${currentYear}-000002`);

    expect(
      await prisma.doc_sequences.findUnique({
        where: { doc_type_year: { doc_type: doc_type.SAL, year: currentYear } },
      }),
    ).not.toBeNull();
  });

  describe('sequenceYear resolves in Bishkek time', () => {
    it.each([
      ['2026-06-15T12:00:00.000Z', 2026],
      // 23:30 UTC on 31 December is already 05:30 on 1 January in Bishkek
      // (UTC+6), so the new year's sequence starts there.
      ['2025-12-31T23:30:00.000Z', 2026],
      // 17:00 UTC on 31 December is still 23:00 on 31 December in Bishkek.
      ['2025-12-31T17:00:00.000Z', 2025],
      ['2026-01-01T00:30:00.000Z', 2026],
    ])('%s -> %i', (iso, expected) => {
      expect(sequenceYear(new Date(iso))).toBe(expected);
    });
  });

  describe('a cancelled number is retired', () => {
    it('does not hand out a cancelled document number again', async () => {
      const first = await create();
      await documents.cancel(first.id, userId, 'test cancellation');

      const second = await create();
      const third = await create();

      const year = sequenceYear();
      expect(first.doc_number).toBe(`SAL-${year}-000001`);
      expect(second.doc_number).toBe(`SAL-${year}-000002`);
      expect(third.doc_number).toBe(`SAL-${year}-000003`);

      const numbers = await prisma.documents.findMany({
        select: { doc_number: true },
      });
      expect(new Set(numbers.map((n) => n.doc_number)).size).toBe(3);
    });

    it('leaves the sequence untouched when a document is cancelled', async () => {
      const doc = await create();
      const key = { doc_type_year: { doc_type: doc_type.SAL, year: sequenceYear() } };
      const before = await prisma.doc_sequences.findUnique({ where: key });

      await documents.cancel(doc.id, userId);

      const after = await prisma.doc_sequences.findUnique({ where: key });
      expect(after?.last_number).toBe(before?.last_number);
    });

    it('keeps numbers unique when cancellations interleave with creation', async () => {
      const created = await Promise.all(
        Array.from({ length: 20 }, () => create()),
      );

      await Promise.all(
        created
          .filter((_, i) => i % 2 === 0)
          .map((d) => documents.cancel(d.id, userId)),
      );

      const more = await Promise.all(
        Array.from({ length: 20 }, () => create()),
      );

      const all = [...created, ...more].map((d) => d.doc_number);
      expect(new Set(all).size).toBe(40);
      expect(all).not.toContain(`SAL-${sequenceYear()}-000041`);
    });
  });

  it('rejects a duplicate number at the database level', async () => {
    const existing = await create();

    await expect(
      prisma.documents.create({
        data: {
          doc_type: doc_type.SAL,
          doc_number: existing.doc_number,
          business_date: BUSINESS_DATE,
          created_by: userId,
        },
      }),
    ).rejects.toThrow();
  });
});
