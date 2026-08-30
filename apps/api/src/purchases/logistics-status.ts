import { purchase_status } from '@prisma/client';

/**
 * The 16 logistics stages, in the order §6 lists them.
 *
 * The order is the machine: normally a purchase moves one step along it. The
 * enum's declaration order already matches, but relying on that would make a
 * future enum edit silently change the workflow, so the sequence is written
 * out and checked against the enum by a test.
 */
export const LOGISTICS_SEQUENCE: readonly purchase_status[] = [
  purchase_status.DRAFT, // 1. Черновик
  purchase_status.SENT_TO_SUPPLIER, // 2. Поставщикке жөнөтүлдү
  purchase_status.SUPPLIER_ACCEPTED, // 3. Поставщик кабыл алды
  purchase_status.COLLECTING, // 4. Товар чогултулууда
  purchase_status.LEFT_SUPPLIER, // 5. Поставщиктин складынан чыкты
  purchase_status.ARRIVED_YIWU_CARGO, // 6. Иу карго складына жетти
  purchase_status.CARGO_ACCEPTED, // 7. Карго кабыл алды
  purchase_status.LEFT_CARGO, // 8. Карго складынан чыкты
  purchase_status.IN_TRANSIT, // 9. Жолдо
  purchase_status.ARRIVED_SVH, // 10. Кыргызстандагы СВХга келди
  purchase_status.RELEASED_SVH, // 11. СВХдан чыгарылды
  purchase_status.LOCAL_TRANSPORT, // 12. Жергиликтүү транспортто
  purchase_status.ARRIVED_EGOMOT, // 13. EGOMOT складына келди
  purchase_status.READY_TO_RECEIVE, // 14. Кабыл алууга даяр
  purchase_status.RECEIVED, // 15. Приход болду
  purchase_status.CLOSED, // 16. Партия жабылды
] as const;

export function stageIndex(status: purchase_status): number {
  return LOGISTICS_SEQUENCE.indexOf(status);
}

/** The one step a salesperson may take. Undefined at the final stage. */
export function nextStage(status: purchase_status): purchase_status | undefined {
  return LOGISTICS_SEQUENCE[stageIndex(status) + 1];
}

/** Human-readable stage number, for messages and the timeline. */
export function stageNumber(status: purchase_status): number {
  return stageIndex(status) + 1;
}
