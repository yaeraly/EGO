import type {
  AllocBasis,
  DiscrepancyStatus,
  DiscrepancyType,
  ExpenseType,
  ReceiptStatus,
  WarehouseType,
} from '../api/types';

/** §7 — приход процессинин абалдары. */
export const RECEIPT_STATUS_LABEL: Record<ReceiptStatus, string> = {
  DRAFT: 'Черновик',
  READY: 'Кабыл алууга даяр',
  RECEIVED: 'Приход болду',
  CLOSED: 'Жабылды',
};

/** §5, §9 — түз чыгымдардын түрлөрү. */
export const EXPENSE_LABEL: Record<ExpenseType, string> = {
  CHINA_TRANSPORT: 'Кытай ичиндеги транспорт',
  INTL_CARGO: 'Эл аралык карго',
  LOCAL_TRANSPORT: 'Жергиликтүү транспорт',
  INSURANCE: 'Камсыздандыруу',
  COMMISSION: 'Комиссия',
  OTHER: 'Башка',
};

/** §9.2 — ар бир чыгым өз базасын тандайт. */
export const BASIS_LABEL: Record<AllocBasis, string> = {
  WEIGHT: 'Салмак боюнча',
  VOLUME: 'Көлөм боюнча',
  VALUE: 'Нарк боюнча',
  MANUAL: 'Кол менен',
};

export const BASIS_HINT: Record<AllocBasis, string> = {
  WEIGHT: 'Ар бир позициянын жалпы салмагына пропорционал (§9.3)',
  VOLUME: 'Көлөмдүк/chargeable салмакка — карго ошону менен эсептесе (§9.4)',
  VALUE: 'Сатып алуу наркына пропорционал (§9.5)',
  MANUAL: 'Суммаларды өзүңүз бөлөсүз; жыйынтык чыгымга так тең болушу керек (§9.6)',
};

/** §8.4 — расхождениенин пайда болгон этабы. */
export const DISCREPANCY_TYPE_LABEL: Record<DiscrepancyType, string> = {
  SUPPLIER_SHORTAGE: 'Поставщик аз жөнөттү',
  CARGO_LOSS: 'Каргодо жоголду',
  LOCAL_TRANSPORT_LOSS: 'Жергиликтүү транспортто жоголду',
  RECEIVING_DAMAGE: 'Кабыл алууда брак',
  EXCESS: 'Ашыкча келди',
  UNKNOWN: 'Себеби белгисиз',
};

/** §8.9 — расхождениенин статусу. */
export const DISCREPANCY_STATUS_LABEL: Record<DiscrepancyStatus, string> = {
  OPEN: 'Ачык',
  UNDER_REVIEW: 'Териштирилүүдө',
  PARTIALLY_COMPENSATED: 'Жарым-жартылай компенсацияланды',
  COMPENSATED: 'Компенсацияланды',
  WRITTEN_OFF: 'Эсептен чыгарылды',
  CLOSED: 'Жабылды',
};

export const WAREHOUSE_TYPE_LABEL: Record<WarehouseType, string> = {
  MAIN: 'Негизги',
  DEFECT: 'Брак',
  SERVICE: 'Сервис',
  TRANSIT: 'Транзит',
  BRANCH: 'Филиал',
  OTHER: 'Башка',
};

export function receiptStatusTone(status: ReceiptStatus): string {
  return status === 'RECEIVED' || status === 'CLOSED'
    ? 'ok'
    : status === 'READY'
      ? 'info'
      : 'neutral';
}

export function discrepancyStatusTone(status: DiscrepancyStatus): string {
  return status === 'COMPENSATED' || status === 'CLOSED'
    ? 'ok'
    : status === 'WRITTEN_OFF'
      ? 'danger'
      : status === 'PARTIALLY_COMPENSATED'
        ? 'info'
        : 'warn';
}
