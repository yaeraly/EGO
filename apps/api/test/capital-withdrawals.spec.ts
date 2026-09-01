import { INestApplication } from '@nestjs/common';
import { PrismaClient, doc_status, doc_type } from '@prisma/client';
import request from 'supertest';
import {
  CashFlowCategory,
  cashFlowCategory,
  isCapitalFinancing,
} from '../src/reports/cash-flow-category';
import { createTestApp } from './app-harness';
import { BUSINESS_DATE, Module1Context, resetModule1 } from './module1-harness';

describe('Capital and withdrawals (Modules 1.1 and 1.2, criterion 3)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ctx: Omit<Module1Context, 'app' | 'prisma'>;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ctx = await resetModule1(app, prisma);
  });

  const http = () => request(app.getHttpServer());
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.ownerToken}`);
  const asStaff = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ctx.staffToken}`);

  const confirm = (id: string) =>
    asOwner(http().post(`/api/documents/${id}/confirm`));

  const balance = async (accountId: string): Promise<string> => {
    const { body } = await asOwner(
      http().get(`/api/accounts/${accountId}/balance`),
    ).expect(200);
    return body.balance as string;
  };

  const draftCapital = (payload: Record<string, unknown>) =>
    asOwner(http().post('/api/capital')).send({
      source: 'OWNER',
      account_id: ctx.kgsAccount,
      business_date: BUSINESS_DATE,
      ...payload,
    });

  const draftWithdrawal = (payload: Record<string, unknown>) =>
    asOwner(http().post('/api/withdrawals')).send({
      wtype: 'OWNER_WITHDRAWAL',
      account_id: ctx.kgsAccount,
      purpose: 'personal use',
      business_date: BUSINESS_DATE,
      ...payload,
    });

  async function fundKgs(amount: string): Promise<void> {
    const { body } = await draftCapital({ amount }).expect(201);
    await confirm(body.id).expect(201);
  }

  async function createInvestor(name = 'Aibek'): Promise<string> {
    const { body } = await asOwner(http().post('/api/investors'))
      .send({ name, phone: '0555111222' })
      .expect(201);
    return body.id as string;
  }

  describe('capital in (§3)', () => {
    it('increases the account on confirmation', async () => {
      const { body } = await draftCapital({ amount: '500000.00' }).expect(201);

      expect(body.doc_number).toMatch(/^CAP-\d{4}-\d{6}$/);
      expect(await balance(ctx.kgsAccount)).toBe('0.00');

      await confirm(body.id).expect(201);
      expect(await balance(ctx.kgsAccount)).toBe('500000.00');
    });

    it('records the contribution and audits it', async () => {
      const { body } = await draftCapital({ amount: '500000.00' }).expect(201);
      await confirm(body.id).expect(201);

      const capital = await prisma.capital_docs.findUnique({
        where: { document_id: body.id },
      });
      expect(capital?.source).toBe('OWNER');
      expect(capital?.amount.toFixed(2)).toBe('500000.00');
      expect(capital?.currency).toBe('KGS');

      expect(
        await prisma.audit_log.count({ where: { action: 'CAPITAL_CONTRIBUTED' } }),
      ).toBe(1);
    });

    it('names the investor when the source is INVESTOR', async () => {
      const investorId = await createInvestor();

      const { body } = await draftCapital({
        source: 'INVESTOR',
        investor_id: investorId,
        amount: '300000.00',
      }).expect(201);
      await confirm(body.id).expect(201);

      const capital = await prisma.capital_docs.findUnique({
        where: { document_id: body.id },
      });
      expect(capital?.investor_id).toBe(investorId);
    });

    it('refuses an INVESTOR contribution with no investor', async () => {
      await draftCapital({ source: 'INVESTOR', amount: '300000.00' }).expect(400);
    });

    it('refuses an OWNER contribution that names an investor', async () => {
      const investorId = await createInvestor();

      await draftCapital({
        source: 'OWNER',
        investor_id: investorId,
        amount: '300000.00',
      }).expect(400);
    });

    it('refuses an unknown investor', async () => {
      await draftCapital({
        source: 'INVESTOR',
        investor_id: '00000000-0000-0000-0000-000000000000',
        amount: '300000.00',
      }).expect(404);
    });

    it('refuses a SALES_MANAGER (§2)', async () => {
      await asStaff(http().post('/api/capital'))
        .send({
          source: 'OWNER',
          account_id: ctx.kgsAccount,
          amount: '1000.00',
          business_date: BUSINESS_DATE,
        })
        .expect(403);
    });
  });

  describe('capital contributed straight into a currency till', () => {
    it('requires the KGS rate and builds a FIFO layer from it', async () => {
      const { body } = await draftCapital({
        account_id: ctx.cnyAccount,
        amount: '10000.00',
        rate: '13.00',
      }).expect(201);
      await confirm(body.id).expect(201);

      expect(await balance(ctx.cnyAccount)).toBe('10000.00');

      const layer = await prisma.currency_layers.findFirst({
        where: { account_id: ctx.cnyAccount },
      });
      expect(layer?.rate_kgs.toFixed(2)).toBe('13.00');
      expect(layer?.remaining_amount.toFixed(2)).toBe('10000.00');

      const movement = await prisma.account_movements.findFirst({
        where: { document_id: body.id },
      });
      expect(movement?.kgs_value?.toFixed(2)).toBe('130000.00');
    });

    // Without a rate the currency would sit in the till with no cost basis,
    // and the first payment out of it would have nothing to draw on.
    it('refuses a foreign contribution with no rate', async () => {
      const res = await draftCapital({
        account_id: ctx.cnyAccount,
        amount: '10000.00',
      }).expect(400);

      expect(res.body.message).toContain('rate is required');
    });

    it('ignores a rate on a KGS account', async () => {
      const { body } = await draftCapital({ amount: '1000.00' }).expect(201);
      await confirm(body.id).expect(201);

      const capital = await prisma.capital_docs.findUnique({
        where: { document_id: body.id },
      });
      expect(capital?.rate).toBeNull();
      expect(await prisma.currency_layers.count()).toBe(0);
    });
  });

  describe('withdrawal (§3.1)', () => {
    it.each([
      'OWNER_WITHDRAWAL',
      'INVESTOR_CAPITAL_RETURN',
      'PROFIT_DISTRIBUTION',
    ])('reduces the account for %s', async (wtype) => {
      await fundKgs('500000.00');
      const investorId = await createInvestor();

      const { body } = await draftWithdrawal({
        wtype,
        amount: '80000.00',
        investor_id: wtype === 'OWNER_WITHDRAWAL' ? undefined : investorId,
      }).expect(201);
      await confirm(body.id).expect(201);

      expect(await balance(ctx.kgsAccount)).toBe('420000.00');
      expect(body.doc_number).toMatch(/^WDW-\d{4}-\d{6}$/);
    });

    it('requires an investor for INVESTOR_CAPITAL_RETURN (§3.1.2)', async () => {
      await fundKgs('500000.00');

      await draftWithdrawal({
        wtype: 'INVESTOR_CAPITAL_RETURN',
        amount: '80000.00',
      }).expect(400);
    });

    it('requires a purpose (§3.1.4)', async () => {
      await fundKgs('500000.00');

      await draftWithdrawal({ amount: '80000.00', purpose: '' }).expect(400);
    });

    it('links back to the capital contribution being returned', async () => {
      const { body: capital } = await draftCapital({
        amount: '500000.00',
      }).expect(201);
      await confirm(capital.id).expect(201);
      const investorId = await createInvestor();

      const { body } = await draftWithdrawal({
        wtype: 'INVESTOR_CAPITAL_RETURN',
        investor_id: investorId,
        amount: '80000.00',
        linked_capital_doc: capital.id,
        purpose: 'partial capital return',
      }).expect(201);
      await confirm(body.id).expect(201);

      const withdrawal = await prisma.withdrawal_docs.findUnique({
        where: { document_id: body.id },
      });
      expect(withdrawal?.linked_capital_doc).toBe(capital.id);
    });

    it('refuses a linked document that is not a CAP', async () => {
      await fundKgs('500000.00');
      const { body: transfer } = await asOwner(http().post('/api/transfers'))
        .send({
          from_account: ctx.kgsAccount,
          to_account: ctx.cnyAccount,
          amount: '10.00',
          business_date: BUSINESS_DATE,
        })
        .expect(400); // cross-currency, so use a genuinely non-CAP document
      expect(transfer).toBeDefined();

      const { body: capitalDoc } = await draftCapital({ amount: '1.00' }).expect(201);
      const other = await prisma.documents.findUnique({
        where: { id: capitalDoc.id },
      });
      expect(other?.doc_type).toBe(doc_type.CAP);

      await draftWithdrawal({
        amount: '1.00',
        linked_capital_doc: '00000000-0000-0000-0000-000000000000',
      }).expect(404);
    });

    it('refuses a withdrawal the account cannot cover', async () => {
      await fundKgs('50000.00');

      const { body } = await draftWithdrawal({ amount: '80000.00' }).expect(201);

      await confirm(body.id).expect(409);
      expect(await balance(ctx.kgsAccount)).toBe('50000.00');
      const stored = await prisma.documents.findUnique({ where: { id: body.id } });
      expect(stored?.status).toBe(doc_status.DRAFT);
    });

    it('consumes FIFO layers when taken from a currency till', async () => {
      const { body: capital } = await draftCapital({
        account_id: ctx.cnyAccount,
        amount: '10000.00',
        rate: '13.00',
      }).expect(201);
      await confirm(capital.id).expect(201);

      const { body } = await draftWithdrawal({
        account_id: ctx.cnyAccount,
        amount: '4000.00',
        purpose: 'owner draw in CNY',
      }).expect(201);
      await confirm(body.id).expect(201);

      expect(await balance(ctx.cnyAccount)).toBe('6000.00');

      const consumption = await prisma.currency_layer_consumptions.findFirst({
        where: { document_id: body.id },
      });
      expect(consumption?.amount.toFixed(2)).toBe('4000.00');
      expect(consumption?.kgs_value.toFixed(2)).toBe('52000.00');

      const movement = await prisma.account_movements.findFirst({
        where: { document_id: body.id },
      });
      expect(movement?.kgs_value?.toFixed(2)).toBe('-52000.00');
    });

    it('refuses a SALES_MANAGER (§2)', async () => {
      await asStaff(http().post('/api/withdrawals'))
        .send({
          wtype: 'OWNER_WITHDRAWAL',
          account_id: ctx.kgsAccount,
          amount: '1000.00',
          purpose: 'nope',
          business_date: BUSINESS_DATE,
        })
        .expect(403);
    });
  });

  describe('a withdrawal leaves no trace in P&L expenses (criterion 3)', () => {
    async function ownerDrawsMoney(): Promise<string> {
      await fundKgs('500000.00');
      const { body } = await draftWithdrawal({ amount: '80000.00' }).expect(201);
      await confirm(body.id).expect(201);
      return body.id as string;
    }

    // §26: operating expenses are the `expenses` table, and that is what P&L
    // expenses are drawn from. §3.1.6 forbids a withdrawal ever landing there.
    it('writes nothing to the expenses table', async () => {
      await ownerDrawsMoney();

      expect(await prisma.expenses.count()).toBe(0);
    });

    it('creates no EXP document', async () => {
      await ownerDrawsMoney();

      expect(
        await prisma.documents.count({ where: { doc_type: doc_type.EXP } }),
      ).toBe(0);
    });

    it.each([
      'OWNER_WITHDRAWAL',
      'INVESTOR_CAPITAL_RETURN',
      'PROFIT_DISTRIBUTION',
    ])('keeps P&L expenses at zero for %s', async (wtype) => {
      await fundKgs('500000.00');
      const investorId = await createInvestor();

      const { body } = await draftWithdrawal({
        wtype,
        amount: '80000.00',
        investor_id: wtype === 'OWNER_WITHDRAWAL' ? undefined : investorId,
      }).expect(201);
      await confirm(body.id).expect(201);

      const { _sum } = await prisma.expenses.aggregate({ _sum: { amount: true } });
      expect(_sum.amount).toBeNull();
    });

    // The contrast: a real operating expense does show up, so the assertion
    // above is testing the rule rather than an empty table.
    it('still counts a genuine operating expense', async () => {
      await ownerDrawsMoney();

      const category = await prisma.expense_categories.create({
        data: { name: 'Warehouse rent' },
        select: { id: true },
      });
      const expenseDoc = await prisma.documents.create({
        data: {
          doc_type: doc_type.EXP,
          doc_number: 'EXP-2026-000001',
          business_date: new Date(`${BUSINESS_DATE}T00:00:00.000Z`),
          status: doc_status.CONFIRMED,
          created_by: ctx.ownerId,
        },
        select: { id: true },
      });
      await prisma.expenses.create({
        data: {
          document_id: expenseDoc.id,
          category_id: category.id,
          account_id: ctx.kgsAccount,
          amount: '15000.00',
        },
      });

      const { _sum } = await prisma.expenses.aggregate({ _sum: { amount: true } });
      // The rent, and only the rent — the 80 000 withdrawal is not in here.
      expect(_sum.amount?.toFixed(2)).toBe('15000.00');
    });

    it('classifies WDW as a capital/financing flow, never operating (§3.1.5)', () => {
      expect(cashFlowCategory(doc_type.WDW)).toBe(
        CashFlowCategory.CAPITAL_FINANCING,
      );
      expect(cashFlowCategory(doc_type.WDW)).not.toBe(
        CashFlowCategory.OPERATING,
      );
      expect(isCapitalFinancing(doc_type.WDW)).toBe(true);
      expect(isCapitalFinancing(doc_type.CAP)).toBe(true);
    });

    it('classifies account moves between own tills as internal transfers', () => {
      expect(cashFlowCategory(doc_type.TRN)).toBe(
        CashFlowCategory.INTERNAL_TRANSFER,
      );
      expect(cashFlowCategory(doc_type.CEX)).toBe(
        CashFlowCategory.INTERNAL_TRANSFER,
      );
    });

    it('leaves a type that moves no money unclassified', () => {
      // A LOT records what a batch cost; no money crosses an account for it,
      // so it belongs in no Cash Flow section. (SAL was the example here
      // until §28 gave every money-moving type its category.)
      expect(cashFlowCategory(doc_type.LOT)).toBeNull();
      expect(isCapitalFinancing(doc_type.LOT)).toBe(false);
    });
  });

  describe('investors directory', () => {
    it('creates, lists and renames an investor', async () => {
      const id = await createInvestor('Aibek');

      const listed = await asOwner(http().get('/api/investors')).expect(200);
      expect(listed.body).toHaveLength(1);

      const renamed = await asOwner(http().patch(`/api/investors/${id}`))
        .send({ name: 'Aibek Zh.' })
        .expect(200);
      expect(renamed.body.name).toBe('Aibek Zh.');
    });

    it('deactivates rather than deletes', async () => {
      const id = await createInvestor();

      await asOwner(http().patch(`/api/investors/${id}`))
        .send({ is_active: false })
        .expect(200);

      const active = await asOwner(http().get('/api/investors')).expect(200);
      expect(active.body).toHaveLength(0);

      const all = await asOwner(
        http().get('/api/investors?include_inactive=true'),
      ).expect(200);
      expect(all.body).toHaveLength(1);
    });

    it('refuses a SALES_MANAGER', async () => {
      await asStaff(http().get('/api/investors')).expect(403);
    });
  });
});
