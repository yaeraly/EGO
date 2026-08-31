import { Prisma, expense_alloc_basis } from '@prisma/client';
import {
  AllocationError,
  AllocationTarget,
  allocateExpense,
} from '../src/allocation/allocation';

const D = (value: string | number) => new Prisma.Decimal(value);
const ZERO = D(0);

/** A position measuring the same on every basis unless told otherwise. */
function target(
  id: string,
  overrides: Partial<AllocationTarget> = {},
): AllocationTarget {
  return {
    id,
    weight: ZERO,
    volume: null,
    value: ZERO,
    ...overrides,
  };
}

const sum = (result: Map<string, Prisma.Decimal>): Prisma.Decimal =>
  [...result.values()].reduce((a, b) => a.plus(b), ZERO);

describe('Allocation engine (Module 3.6, §9.3–9.9)', () => {
  describe('§9.9 — the sum is exact, always', () => {
    it('splits 1 000.00 across three equal weights as 333.34 + 333.33 + 333.33', () => {
      // The knowledge base's own example (§9.9), verbatim.
      const result = allocateExpense(
        { amountKgs: D('1000.00'), basis: expense_alloc_basis.WEIGHT },
        [
          target('a', { weight: D('10') }),
          target('b', { weight: D('10') }),
          target('c', { weight: D('10') }),
        ],
      );

      expect(result.get('a')!.toFixed(2)).toBe('333.34');
      expect(result.get('b')!.toFixed(2)).toBe('333.33');
      expect(result.get('c')!.toFixed(2)).toBe('333.33');
      expect(sum(result).toFixed(2)).toBe('1000.00');
    });

    it('refuses 999.99 and 1 000.01 by construction — the sum is checked', () => {
      const result = allocateExpense(
        { amountKgs: D('1000.00'), basis: expense_alloc_basis.WEIGHT },
        [
          target('a', { weight: D('10') }),
          target('b', { weight: D('10') }),
          target('c', { weight: D('10') }),
        ],
      );
      expect(sum(result).equals(D('1000.00'))).toBe(true);
      expect(sum(result).equals(D('999.99'))).toBe(false);
      expect(sum(result).equals(D('1000.01'))).toBe(false);
    });

    it('puts the remainder on the largest allocation (§9.9 rule 4)', () => {
      // 100.00 over 1 : 1 : 1 000 000 — the giant position takes the tiyin.
      const result = allocateExpense(
        { amountKgs: D('100.00'), basis: expense_alloc_basis.WEIGHT },
        [
          target('small-1', { weight: D('1') }),
          target('small-2', { weight: D('1') }),
          target('huge', { weight: D('1000000') }),
        ],
      );

      expect(sum(result).toFixed(2)).toBe('100.00');
      const largest = [...result.entries()].sort((a, b) =>
        b[1].comparedTo(a[1]),
      )[0];
      expect(largest[0]).toBe('huge');
    });

    it('breaks a tie on document order, not iteration order (§9.9 rule 5)', () => {
      const forward = allocateExpense(
        { amountKgs: D('10.00'), basis: expense_alloc_basis.WEIGHT },
        [
          target('first', { weight: D('1') }),
          target('second', { weight: D('1') }),
          target('third', { weight: D('1') }),
        ],
      );
      // 3.34 + 3.33 + 3.33 — the extra tiyin is on the first position.
      expect(forward.get('first')!.toFixed(2)).toBe('3.34');
      expect(forward.get('second')!.toFixed(2)).toBe('3.33');

      // The same three positions listed in another order put the tiyin on
      // whichever is now first, and still sum exactly.
      const reversed = allocateExpense(
        { amountKgs: D('10.00'), basis: expense_alloc_basis.WEIGHT },
        [
          target('third', { weight: D('1') }),
          target('second', { weight: D('1') }),
          target('first', { weight: D('1') }),
        ],
      );
      expect(reversed.get('third')!.toFixed(2)).toBe('3.34');
      expect(sum(reversed).toFixed(2)).toBe('10.00');
    });

    it('is deterministic — the same input gives the same split every time', () => {
      const build = () =>
        allocateExpense(
          { amountKgs: D('7777.77'), basis: expense_alloc_basis.WEIGHT },
          [
            target('a', { weight: D('3.333') }),
            target('b', { weight: D('11.111') }),
            target('c', { weight: D('0.007') }),
          ],
        );

      const first = build();
      for (let i = 0; i < 20; i += 1) {
        const again = build();
        for (const [id, amount] of first) {
          expect(again.get(id)!.equals(amount)).toBe(true);
        }
      }
    });

    /**
     * The property §9.9 actually asserts: whatever the weights, the pieces
     * add back up to the whole. Ten thousand random cases, because a single
     * worked example proves only that one case.
     */
    it('Σ allocated = source for 10 000 random weightings', () => {
      let seed = 20260831;
      const random = (): number => {
        // A small deterministic PRNG, so a failure is reproducible.
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };

      for (let round = 0; round < 10000; round += 1) {
        const count = 1 + Math.floor(random() * 8);
        const targets: AllocationTarget[] = [];
        for (let i = 0; i < count; i += 1) {
          // Weights from 0.001 to ~1000, three decimals, as the column holds.
          const weight = D((random() * 1000 + 0.001).toFixed(3));
          targets.push(target(`p${i}`, { weight }));
        }
        const amount = D((random() * 500000 + 0.01).toFixed(2));

        const result = allocateExpense(
          { amountKgs: amount, basis: expense_alloc_basis.WEIGHT },
          targets,
        );

        expect(sum(result).equals(amount)).toBe(true);
        for (const value of result.values()) {
          expect(value.decimalPlaces()).toBeLessThanOrEqual(2);
        }
      }
    });

    it('never leaves an allocation with more than two decimals', () => {
      const result = allocateExpense(
        { amountKgs: D('1.00'), basis: expense_alloc_basis.WEIGHT },
        [
          target('a', { weight: D('1') }),
          target('b', { weight: D('1') }),
          target('c', { weight: D('1') }),
          target('d', { weight: D('1') }),
          target('e', { weight: D('1') }),
          target('f', { weight: D('1') }),
          target('g', { weight: D('1') }),
        ],
      );
      expect(sum(result).toFixed(2)).toBe('1.00');
      for (const value of result.values()) {
        expect(value.decimalPlaces()).toBeLessThanOrEqual(2);
      }
    });

    it('gives the whole expense to a single position', () => {
      const result = allocateExpense(
        { amountKgs: D('1234.56'), basis: expense_alloc_basis.WEIGHT },
        [target('only', { weight: D('0.5') })],
      );
      expect(result.get('only')!.toFixed(2)).toBe('1234.56');
    });

    it('allocates a zero expense as zero everywhere', () => {
      const result = allocateExpense(
        { amountKgs: D('0.00'), basis: expense_alloc_basis.WEIGHT },
        [target('a', { weight: D('1') }), target('b', { weight: D('2') })],
      );
      expect(sum(result).toFixed(2)).toBe('0.00');
      expect(result.get('a')!.toFixed(2)).toBe('0.00');
    });
  });

  describe('WEIGHT (§9.3)', () => {
    it('shares in proportion to total position weight', () => {
      // The task's example: 10 kg × 5 pcs = 50, and 2 kg × 20 pcs = 40.
      // 1 400.00 over 50 : 40 → 777.78 : 622.22.
      const result = allocateExpense(
        { amountKgs: D('1400.00'), basis: expense_alloc_basis.WEIGHT },
        [
          target('motor', { weight: D('50.000') }),
          target('battery', { weight: D('40.000') }),
        ],
      );

      expect(result.get('motor')!.toFixed(2)).toBe('777.78');
      expect(result.get('battery')!.toFixed(2)).toBe('622.22');
      expect(sum(result).toFixed(2)).toBe('1400.00');
    });

    it('splits 1 000 : 400 when the weights are 1 000 : 400', () => {
      const result = allocateExpense(
        { amountKgs: D('1400.00'), basis: expense_alloc_basis.WEIGHT },
        [
          target('a', { weight: D('1000') }),
          target('b', { weight: D('400') }),
        ],
      );
      expect(result.get('a')!.toFixed(2)).toBe('1000.00');
      expect(result.get('b')!.toFixed(2)).toBe('400.00');
    });

    it('refuses when every position weighs nothing', () => {
      expect(() =>
        allocateExpense(
          { amountKgs: D('100.00'), basis: expense_alloc_basis.WEIGHT },
          [target('a', { weight: ZERO }), target('b', { weight: ZERO })],
        ),
      ).toThrow(AllocationError);
    });

    it('gives a position of zero weight nothing', () => {
      const result = allocateExpense(
        { amountKgs: D('100.00'), basis: expense_alloc_basis.WEIGHT },
        [
          target('carries', { weight: D('10') }),
          target('weightless', { weight: ZERO }),
        ],
      );
      expect(result.get('carries')!.toFixed(2)).toBe('100.00');
      expect(result.get('weightless')!.toFixed(2)).toBe('0.00');
    });
  });

  describe('VOLUME (§9.4)', () => {
    it('shares by volumetric weight when the carrier bills by it', () => {
      const result = allocateExpense(
        { amountKgs: D('3000.00'), basis: expense_alloc_basis.VOLUME },
        [
          // Light but bulky: heavy by volume, light on the scale.
          target('mirrors', { weight: D('5'), volume: D('120') }),
          target('motors', { weight: D('200'), volume: D('30') }),
        ],
      );

      expect(result.get('mirrors')!.toFixed(2)).toBe('2400.00');
      expect(result.get('motors')!.toFixed(2)).toBe('600.00');
      expect(sum(result).toFixed(2)).toBe('3000.00');
    });

    it('refuses a position with no volume, naming it (§9.4, §9.8)', () => {
      expect(() =>
        allocateExpense(
          { amountKgs: D('100.00'), basis: expense_alloc_basis.VOLUME },
          [
            target('has-volume', { volume: D('10') }),
            target('no-volume', { volume: null }),
          ],
        ),
      ).toThrow(/no-volume/);
    });
  });

  describe('VALUE (§9.5)', () => {
    it('shares in proportion to purchase value', () => {
      const result = allocateExpense(
        { amountKgs: D('900.00'), basis: expense_alloc_basis.VALUE },
        [
          target('expensive', { value: D('60000.00') }),
          target('cheap', { value: D('30000.00') }),
        ],
      );
      expect(result.get('expensive')!.toFixed(2)).toBe('600.00');
      expect(result.get('cheap')!.toFixed(2)).toBe('300.00');
    });
  });

  describe('MANUAL (§9.6)', () => {
    it('uses the OWNER figures when they add up exactly', () => {
      const result = allocateExpense(
        { amountKgs: D('1000.00'), basis: expense_alloc_basis.MANUAL },
        [
          target('a', { manualAmount: D('700.00') }),
          target('b', { manualAmount: D('300.00') }),
        ],
      );
      expect(result.get('a')!.toFixed(2)).toBe('700.00');
      expect(result.get('b')!.toFixed(2)).toBe('300.00');
    });

    it('refuses figures that are a tiyin short (§9.6, §9.9)', () => {
      expect(() =>
        allocateExpense(
          { amountKgs: D('1000.00'), basis: expense_alloc_basis.MANUAL },
          [
            target('a', { manualAmount: D('700.00') }),
            target('b', { manualAmount: D('299.99') }),
          ],
        ),
      ).toThrow(/999\.99.*1000\.00/);
    });

    it('refuses figures that are a tiyin over', () => {
      expect(() =>
        allocateExpense(
          { amountKgs: D('1000.00'), basis: expense_alloc_basis.MANUAL },
          [
            target('a', { manualAmount: D('700.01') }),
            target('b', { manualAmount: D('300.00') }),
          ],
        ),
      ).toThrow(AllocationError);
    });

    it('refuses a position the OWNER left blank', () => {
      expect(() =>
        allocateExpense(
          { amountKgs: D('1000.00'), basis: expense_alloc_basis.MANUAL },
          [target('a', { manualAmount: D('1000.00') }), target('b')],
        ),
      ).toThrow(/missing an amount for position b/);
    });

    it('refuses a negative manual figure', () => {
      expect(() =>
        allocateExpense(
          { amountKgs: D('1000.00'), basis: expense_alloc_basis.MANUAL },
          [
            target('a', { manualAmount: D('1100.00') }),
            target('b', { manualAmount: D('-100.00') }),
          ],
        ),
      ).toThrow(/cannot be negative/);
    });

    it('does not redistribute — a manual split is checked, not adjusted', () => {
      // 333.33 × 3 = 999.99, and MANUAL will not quietly add the tiyin.
      expect(() =>
        allocateExpense(
          { amountKgs: D('1000.00'), basis: expense_alloc_basis.MANUAL },
          [
            target('a', { manualAmount: D('333.33') }),
            target('b', { manualAmount: D('333.33') }),
            target('c', { manualAmount: D('333.33') }),
          ],
        ),
      ).toThrow(AllocationError);
    });
  });

  describe('what it refuses outright', () => {
    it('will not allocate to nothing', () => {
      expect(() =>
        allocateExpense(
          { amountKgs: D('100.00'), basis: expense_alloc_basis.WEIGHT },
          [],
        ),
      ).toThrow(/no positions/);
    });

    it('will not allocate a negative expense', () => {
      expect(() =>
        allocateExpense(
          { amountKgs: D('-1.00'), basis: expense_alloc_basis.WEIGHT },
          [target('a', { weight: D('1') })],
        ),
      ).toThrow(/cannot be negative/);
    });
  });
});
