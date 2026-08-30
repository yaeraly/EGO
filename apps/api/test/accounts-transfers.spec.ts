import { INestApplication } from '@nestjs/common';
import { PrismaClient, doc_status } from '@prisma/client';
import request from 'supertest';
import { DocumentsService } from '../src/documents/documents.service';
import { createTestApp, resetDatabase } from './app-harness';
import { createAccount, fundAccount, seedUser } from './fixtures';

const OWNER_PASSWORD = 'accounts-owner-password';
const STAFF_PASSWORD = 'accounts-staff-password';

describe('Accounts and transfers (Module 0.4, criterion 3)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let documents: DocumentsService;
  let ownerToken: string;
  let staffToken: string;
  let ownerId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    documents = app.get(DocumentsService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${staffToken}`);

  const login = async (phone: string, password: string): Promise<string> => {
    const { body } = await http()
      .post('/api/auth/login')
      .send({ phone, password })
      .expect(200);
    return body.access_token as string;
  };

  beforeEach(async () => {
    await resetDatabase(prisma);
    const owner = await seedUser(prisma, {
      phone: '0700000001',
      password: OWNER_PASSWORD,
      pin: '12345678',
      role: 'OWNER',
      full_name: 'Owner',
    });
    ownerId = owner.id;
    await seedUser(prisma, {
      phone: '0700000002',
      password: STAFF_PASSWORD,
      pin: '87654321',
      role: 'SALES_MANAGER',
      full_name: 'Seller',
    });
    ownerToken = await login('0700000001', OWNER_PASSWORD);
    staffToken = await login('0700000002', STAFF_PASSWORD);
  });

  const balanceOf = async (id: string): Promise<string> => {
    const { body } = await asOwner(http().get(`/api/accounts/${id}/balance`)).expect(200);
    return body.balance as string;
  };

  const draftTransfer = async (
    from: string,
    to: string,
    amount: string,
  ): Promise<{ id: string; doc_number: string }> => {
    const { body } = await asOwner(http().post('/api/transfers'))
      .send({ from_account: from, to_account: to, amount, business_date: '2026-03-15' })
      .expect(201);
    return body;
  };

  describe('account administration (§19)', () => {
    it('lets OWNER create an account', async () => {
      const res = await asOwner(http().post('/api/accounts'))
        .send({ name: 'Seller Cash', type: 'CASH', currency: 'KGS' })
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Seller Cash',
        type: 'CASH',
        currency: 'KGS',
        is_active: true,
      });
    });

    it('refuses a SALES_MANAGER creating one', async () => {
      await asStaff(http().post('/api/accounts'))
        .send({ name: 'Sneaky Till', type: 'CASH', currency: 'KGS' })
        .expect(403);
    });

    it('lets any authenticated user read balances', async () => {
      await asStaff(http().get('/api/accounts/balances')).expect(200);
    });

    it('starts a new account at zero', async () => {
      const id = await createAccount(prisma, { name: 'Fresh' });

      expect(await balanceOf(id)).toBe('0.00');
    });

    it('refuses to deactivate an account still holding money', async () => {
      const id = await createAccount(prisma, { name: 'Loaded' });
      await fundAccount(prisma, { accountId: id, amount: '500.00', userId: ownerId });

      await asOwner(http().patch(`/api/accounts/${id}`))
        .send({ is_active: false })
        .expect(409);
    });

    it('allows deactivating an emptied account', async () => {
      const id = await createAccount(prisma, { name: 'Empty' });

      await asOwner(http().patch(`/api/accounts/${id}`))
        .send({ is_active: false })
        .expect(200)
        .expect((res) => expect(res.body.is_active).toBe(false));
    });
  });

  describe('transfer posting', () => {
    it('moves the balance and writes exactly two movements', async () => {
      const from = await createAccount(prisma, { name: 'Source' });
      const to = await createAccount(prisma, { name: 'Target' });
      await fundAccount(prisma, { accountId: from, amount: '1000.00', userId: ownerId });

      const transfer = await draftTransfer(from, to, '250.50');
      await asOwner(http().post(`/api/documents/${transfer.id}/confirm`)).expect(201);

      expect(await balanceOf(from)).toBe('749.50');
      expect(await balanceOf(to)).toBe('250.50');

      const movements = await prisma.account_movements.findMany({
        where: { document_id: transfer.id },
        orderBy: { amount: 'asc' },
      });
      expect(movements).toHaveLength(2);
      expect(movements[0].amount.toFixed(2)).toBe('-250.50');
      expect(movements[1].amount.toFixed(2)).toBe('250.50');
      expect(movements[0].account_id).toBe(from);
      expect(movements[1].account_id).toBe(to);
    });

    it('moves no money while the transfer is a draft', async () => {
      const from = await createAccount(prisma, { name: 'Source' });
      const to = await createAccount(prisma, { name: 'Target' });
      await fundAccount(prisma, { accountId: from, amount: '1000.00', userId: ownerId });

      await draftTransfer(from, to, '250.00');

      expect(await balanceOf(from)).toBe('1000.00');
      expect(await balanceOf(to)).toBe('0.00');
      expect(await prisma.account_movements.count()).toBe(1); // the funding one
    });

    it('keeps both movements in one transaction', async () => {
      const from = await createAccount(prisma, { name: 'Source' });
      const to = await createAccount(prisma, { name: 'Target' });
      await fundAccount(prisma, { accountId: from, amount: '100.00', userId: ownerId });

      const transfer = await draftTransfer(from, to, '400.00');
      await asOwner(http().post(`/api/documents/${transfer.id}/confirm`)).expect(409);

      // The credit side must not survive the refused debit.
      expect(
        await prisma.account_movements.count({ where: { document_id: transfer.id } }),
      ).toBe(0);
      expect(await balanceOf(to)).toBe('0.00');
    });

    it('leaves the document a draft when posting fails', async () => {
      const from = await createAccount(prisma, { name: 'Source' });
      const to = await createAccount(prisma, { name: 'Target' });

      const transfer = await draftTransfer(from, to, '10.00');
      await asOwner(http().post(`/api/documents/${transfer.id}/confirm`)).expect(409);

      const stored = await prisma.documents.findUnique({
        where: { id: transfer.id },
      });
      expect(stored?.status).toBe(doc_status.DRAFT);
      expect(stored?.confirmed_at).toBeNull();
    });

    it('spends a balance down to exactly zero', async () => {
      const from = await createAccount(prisma, { name: 'Source' });
      const to = await createAccount(prisma, { name: 'Target' });
      await fundAccount(prisma, { accountId: from, amount: '300.00', userId: ownerId });

      const transfer = await draftTransfer(from, to, '300.00');
      await asOwner(http().post(`/api/documents/${transfer.id}/confirm`)).expect(201);

      expect(await balanceOf(from)).toBe('0.00');
    });

    it('refuses one cent over the balance', async () => {
      const from = await createAccount(prisma, { name: 'Source' });
      const to = await createAccount(prisma, { name: 'Target' });
      await fundAccount(prisma, { accountId: from, amount: '300.00', userId: ownerId });

      const transfer = await draftTransfer(from, to, '300.01');
      await asOwner(http().post(`/api/documents/${transfer.id}/confirm`)).expect(409);
    });
  });

  describe('an account can never go negative under concurrency (§42.5)', () => {
    it('lets only one of two competing transfers through', async () => {
      const from = await createAccount(prisma, { name: 'Source' });
      const to = await createAccount(prisma, { name: 'Target' });
      await fundAccount(prisma, { accountId: from, amount: '100.00', userId: ownerId });

      const [first, second] = await Promise.all([
        draftTransfer(from, to, '60.00'),
        draftTransfer(from, to, '60.00'),
      ]);

      const results = await Promise.allSettled([
        documents.confirm(first.id, ownerId),
        documents.confirm(second.id, ownerId),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await balanceOf(from)).toBe('40.00');
      expect(await balanceOf(to)).toBe('60.00');
    });

    it('holds under a wider burst', async () => {
      const from = await createAccount(prisma, { name: 'Source' });
      const to = await createAccount(prisma, { name: 'Target' });
      await fundAccount(prisma, { accountId: from, amount: '100.00', userId: ownerId });

      const drafts = await Promise.all(
        Array.from({ length: 10 }, () => draftTransfer(from, to, '30.00')),
      );

      const results = await Promise.allSettled(
        drafts.map((d) => documents.confirm(d.id, ownerId)),
      );

      // 100 covers exactly three transfers of 30.
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      expect(await balanceOf(from)).toBe('10.00');
      expect(await balanceOf(to)).toBe('90.00');
    });
  });

  describe('validation', () => {
    it('refuses a cross-currency transfer and points at CEX', async () => {
      const kgs = await createAccount(prisma, { name: 'KGS Till' });
      const cny = await createAccount(prisma, { name: 'CNY Till', currency: 'CNY' });

      const res = await asOwner(http().post('/api/transfers'))
        .send({
          from_account: kgs,
          to_account: cny,
          amount: '100.00',
          business_date: '2026-03-15',
        })
        .expect(400);

      expect(res.body.message).toContain('CEX');
    });

    it('refuses a transfer to the same account', async () => {
      const id = await createAccount(prisma, { name: 'Only' });

      await asOwner(http().post('/api/transfers'))
        .send({
          from_account: id,
          to_account: id,
          amount: '100.00',
          business_date: '2026-03-15',
        })
        .expect(400);
    });

    it.each([['0.00'], ['-50.00']])('refuses an amount of %s', async (amount) => {
      const from = await createAccount(prisma, { name: 'Source' });
      const to = await createAccount(prisma, { name: 'Target' });

      await asOwner(http().post('/api/transfers'))
        .send({ from_account: from, to_account: to, amount, business_date: '2026-03-15' })
        .expect(400);
    });

    it('refuses a JSON number as the amount', async () => {
      const from = await createAccount(prisma, { name: 'Source' });
      const to = await createAccount(prisma, { name: 'Target' });

      await asOwner(http().post('/api/transfers'))
        .send({ from_account: from, to_account: to, amount: 100.5, business_date: '2026-03-15' })
        .expect(400);
    });

    it('refuses an inactive account', async () => {
      const from = await createAccount(prisma, { name: 'Source' });
      const to = await createAccount(prisma, { name: 'Target' });
      await prisma.payment_accounts.update({
        where: { id: to },
        data: { is_active: false },
      });

      await asOwner(http().post('/api/transfers'))
        .send({ from_account: from, to_account: to, amount: '10.00', business_date: '2026-03-15' })
        .expect(400);
    });

    it('404s on an unknown account', async () => {
      const from = await createAccount(prisma, { name: 'Source' });

      await asOwner(http().post('/api/transfers'))
        .send({
          from_account: from,
          to_account: '00000000-0000-0000-0000-000000000000',
          amount: '10.00',
          business_date: '2026-03-15',
        })
        .expect(404);
    });
  });
});
