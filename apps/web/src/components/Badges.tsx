import type { PaymentStatus, PurchaseStatus } from '../api/types';

/** The 16 logistics stages of §6, in Kyrgyz, as the shop floor says them. */
export const STATUS_LABEL: Record<PurchaseStatus, string> = {
  DRAFT: 'Черновик',
  SENT_TO_SUPPLIER: 'Поставщикке жөнөтүлдү',
  SUPPLIER_ACCEPTED: 'Поставщик кабыл алды',
  COLLECTING: 'Товар чогултулууда',
  LEFT_SUPPLIER: 'Поставщиктен чыкты',
  ARRIVED_YIWU_CARGO: 'Иу карго складында',
  CARGO_ACCEPTED: 'Карго кабыл алды',
  LEFT_CARGO: 'Каргодон чыкты',
  IN_TRANSIT: 'Жолдо',
  ARRIVED_SVH: 'СВХга келди',
  RELEASED_SVH: 'СВХдан чыгарылды',
  LOCAL_TRANSPORT: 'Жергиликтүү транспортто',
  ARRIVED_EGOMOT: 'EGOMOT складында',
  READY_TO_RECEIVE: 'Кабыл алууга даяр',
  RECEIVED: 'Приход болду',
  CLOSED: 'Партия жабылды',
};

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  UNPAID: 'Төлөнгөн эмес',
  PARTIALLY_PAID: 'Жарым-жартылай',
  PAID: 'Төлөндү',
};

/** Where the goods are (§6) — informational, never a payment claim. */
export function LogisticsBadge({ status }: { status: PurchaseStatus }) {
  const tone =
    status === 'CLOSED' || status === 'RECEIVED'
      ? 'ok'
      : status === 'DRAFT'
        ? 'neutral'
        : 'info';
  return <span className={`badge ${tone}`}>{STATUS_LABEL[status]}</span>;
}

/** Whether the order is paid (§4.2) — independent of where the goods are. */
export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const tone =
    status === 'PAID' ? 'ok' : status === 'UNPAID' ? 'danger' : 'warn';
  return <span className={`badge ${tone}`}>{PAYMENT_LABEL[status]}</span>;
}
