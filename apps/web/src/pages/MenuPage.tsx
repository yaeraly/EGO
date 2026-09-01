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
  { to: '/reports', icon: '📊', label: 'Отчеттор', hint: 'ОПУ, ДДС жана Баланс (§28)', ownerOnly: true },
  { to: '/health', icon: '🩺', label: 'Эмне кылуу керек', hint: 'Күнүмдүк маанилүү иштердин тизмеси (§34)', ownerOnly: true },
  { to: '/dashboard', icon: '🧭', label: 'Кыскача абал', hint: 'Бүгүнкү жана айлык абал бир экранда (§32)', ownerOnly: true },
  { to: '/performance', icon: '🏆', label: 'Сатуучулар жана кардарлар', hint: 'План, KPI, рейтинг (§24, §30, §31)', ownerOnly: true },
  { to: '/analytics', icon: '📈', label: 'Аналитика', hint: 'ABC, XYZ, маржа, заказ тизмеси (§29)', ownerOnly: true },
  { to: '/day-close', icon: '🌙', label: 'Күндү жабуу', hint: 'Кассаны өткөрүү жана күн/ай жабуу (§20, Period Lock)' },
  { to: '/sales', icon: '🧾', label: 'Менин сатууларым', hint: 'Өз сатууларым жана кассаларым (§2, §19)' },
  { to: '/approvals', icon: '✅', label: 'Скидка бекитүүлөрү', hint: 'Лимиттен ашкан скидка (§13.5)', ownerOnly: true },
  { to: '/purchase-advice', icon: '🧠', label: 'Сатып алуу жардамчысы', hint: 'Эмнени, канча заказ кылуу керек (§33)', ownerOnly: true },
  { to: '/purchases', icon: '📦', label: 'Сатып алуулар', hint: 'Кытайдан заказ, логистика (§4, §6)' },
  { to: '/receipts', icon: '📥', label: 'Приходдор', hint: 'Кабыл алуу, өздүк нарк (§7, §9)' },
  { to: '/accounts', icon: '💰', label: 'Кассалар', hint: 'Баланстар, валюта сатып алуу (CEX)' },
  { to: '/expenses', icon: '🧾', label: 'Чыгымдар', hint: 'Операциялык чыгымдар жана бюджет (§26)' },
  { to: '/salaries', icon: '👛', label: 'Айлык', hint: 'Кызматкерлердин айлыгы (§25)', ownerOnly: true },
  { to: '/bonuses', icon: '🎯', label: 'Сатуучунун бонусу', hint: 'Маржадан бонус, BON төлөм (§23)', ownerOnly: true },
  { to: '/suppliers', icon: '🏭', label: 'Поставщиктер', hint: 'Карыз, төлөм, ledger (§4)' },
  { to: '/cargo', icon: '🚚', label: 'Карго', hint: 'Логистика компаниялары, төлөм (§5.2)' },
  { to: '/transfers', icon: '🔁', label: 'Складдар аралык которуу', hint: 'TRF — өздүк нарк өзгөрбөйт (§12-А.5)' },
  { to: '/discrepancies', icon: '⚖️', label: 'Расхождениелер', hint: 'DIF — заказ менен фактынын айырмасы (§8)' },
  { to: '/claims', icon: '📮', label: 'Талаптар', hint: 'CLM — жоготуу үчүн талап (§8.5)', ownerOnly: true },
  { to: '/reservations', icon: '📌', label: 'Броньдор', hint: 'Товарды кармоо, аванс, мөөнөт (§17, §17-А)' },
  { to: '/vehicle-models', icon: '🛺', label: 'Трицикл моделдери', hint: 'Кайсы тетик кайсы моделге туура келет (§12-Б.8)' },
  { to: '/products', icon: '🔧', label: 'Товар каталогу', hint: 'Товар карточкасы, категория, издөө (§12-Б)' },
  { to: '/returns', icon: '↩️', label: 'Возвраттар', hint: 'Товарды кайтаруу, акча жана карыз (§35)' },
  { to: '/defects', icon: '🛠️', label: 'Брак актылары', hint: 'Текшерүү жана чечим (§36-А.3, §37)' },
  { to: '/write-offs', icon: '🗑️', label: 'Списание', hint: 'Брактан металл кирешеси (§38)', ownerOnly: true },
  { to: '/inventories', icon: '📋', label: 'Инвентаризация', hint: 'Саноо жана складдык корректировка (§22)' },
  { to: '/handovers', icon: '🤝', label: 'Жоопкерчиликти өткөрүү', hint: 'Сатуучулар ортосундагы акт (§21)' },
  { to: '/corrections', icon: '🩹', label: 'Коррекция', hint: 'Тастыкталган документтин катасын оңдоо (§27.1)', ownerOnly: true },
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
