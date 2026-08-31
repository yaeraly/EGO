import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Page } from '../components/Page';

interface Entry {
  to: string;
  icon: string;
  label: string;
  hint: string;
  ownerOnly?: boolean;
}

/** Everything the bottom bar has no room for. */
const ENTRIES: Entry[] = [
  { to: '/sales', icon: '🧾', label: 'Менин сатууларым', hint: 'Өз сатууларым жана кассаларым (§2, §19)' },
  { to: '/approvals', icon: '✅', label: 'Скидка бекитүүлөрү', hint: 'Лимиттен ашкан скидка (§13.5)', ownerOnly: true },
  { to: '/purchases', icon: '📦', label: 'Сатып алуулар', hint: 'Кытайдан заказ, логистика (§4, §6)' },
  { to: '/receipts', icon: '📥', label: 'Приходдор', hint: 'Кабыл алуу, өздүк нарк (§7, §9)' },
  { to: '/accounts', icon: '💰', label: 'Кассалар', hint: 'Баланстар, валюта сатып алуу (CEX)' },
  { to: '/suppliers', icon: '🏭', label: 'Поставщиктер', hint: 'Карыз, төлөм, ledger (§4)' },
  { to: '/cargo', icon: '🚚', label: 'Карго', hint: 'Логистика компаниялары, төлөм (§5.2)' },
  { to: '/transfers', icon: '🔁', label: 'Складдар аралык которуу', hint: 'TRF — өздүк нарк өзгөрбөйт (§12-А.5)' },
  { to: '/discrepancies', icon: '⚖️', label: 'Расхождениелер', hint: 'DIF — заказ менен фактынын айырмасы (§8)' },
  { to: '/claims', icon: '📮', label: 'Талаптар', hint: 'CLM — жоготуу үчүн талап (§8.5)', ownerOnly: true },
  { to: '/reservations', icon: '📌', label: 'Броньдор', hint: 'Товарды кармоо, аванс, мөөнөт (§17, §17-А)' },
  { to: '/products', icon: '🔧', label: 'Товар каталогу', hint: 'Товар карточкасы, категория, издөө (§12-Б)' },
  { to: '/warehouses', icon: '🏗️', label: 'Складдар', hint: 'MAIN, DEFECT жана башкалар (§12-А)' },
];

export function MenuPage() {
  const { hasRole } = useAuth();
  const visible = ENTRIES.filter((entry) => !entry.ownerOnly || hasRole('OWNER'));

  return (
    <Page title="Дагы">
      {visible.map((entry) => (
        <Link key={entry.to} to={entry.to} className="card card-link">
          <div className="row">
            <strong>
              {entry.icon} {entry.label}
            </strong>
          </div>
          <span className="muted">{entry.hint}</span>
        </Link>
      ))}
    </Page>
  );
}
