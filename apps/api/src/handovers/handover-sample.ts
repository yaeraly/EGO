/**
 * Which positions a handover counts (§21.1).
 *
 * A handover is deliberately not a full inventory: "Ар бир өткөрүүдө толук
 * инвентаризация талап кылынбайт". What it does count is fixed — every
 * A-class item, plus a handful of positions the *system* picks, not the
 * person handing over. That last part is the whole control: a sample someone
 * chooses for themselves is not a sample.
 */
export interface Countable {
  productId: string;
  categoryId: string | null;
}

export function chooseSample(params: {
  held: Countable[];
  aClassCategories: string[];
  randomPositions: number;
  /** Injected so a test can pin the draw; defaults to Math.random. */
  random?: () => number;
}): { productId: string; isAClass: boolean }[] {
  const aClass = new Set(params.aClassCategories);
  const random = params.random ?? Math.random;

  const chosen: { productId: string; isAClass: boolean }[] = [];
  const rest: string[] = [];

  for (const item of params.held) {
    if (item.categoryId && aClass.has(item.categoryId)) {
      chosen.push({ productId: item.productId, isAClass: true });
    } else {
      rest.push(item.productId);
    }
  }

  // Fisher–Yates over a copy: an unbiased draw, and the caller's list is left
  // as it was.
  const pool = [...rest];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  for (const productId of pool.slice(0, Math.max(params.randomPositions, 0))) {
    chosen.push({ productId, isAClass: false });
  }

  return chosen;
}
