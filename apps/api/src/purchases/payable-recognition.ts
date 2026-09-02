import { purchase_status } from '@prisma/client';
import { stageIndex } from './logistics-status';

/**
 * The stage at which we owe the supplier for the goods (§6, stage 5).
 *
 * The business rule this encodes: the partner gathers the order, and when the
 * goods leave their warehouse the money is due. Before that there is only an
 * order — a list of parts we have asked for, which either side can still walk
 * away from, and which is therefore neither a debt of ours nor an asset.
 */
export const PAYABLE_STAGE = purchase_status.LEFT_SUPPLIER;

/**
 * Whether the goods have left the supplier's warehouse.
 *
 * A stage at or past `LEFT_SUPPLIER` counts, not `LEFT_SUPPLIER` alone: the
 * OWNER may set any stage (word from China arrives late and out of order), so
 * an order can reach us already "in transit" without ever being marked as
 * having left. The debt is due all the same.
 */
export function payableIsDue(status: purchase_status): boolean {
  return stageIndex(status) >= stageIndex(PAYABLE_STAGE);
}

/**
 * Whether the goods are on their way but not yet received.
 *
 * Between those two moments the supplier owes us the goods, which is an asset
 * of ours — the counterpart of the debt recognised at the same moment. It
 * becomes stock at its landed cost when the Receipt is confirmed (§7).
 */
export function goodsAreInTransit(status: purchase_status): boolean {
  return (
    payableIsDue(status) &&
    stageIndex(status) < stageIndex(purchase_status.RECEIVED)
  );
}
