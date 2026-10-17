import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Check, ChefHat, CircleAlert, Clock3, LoaderCircle, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import {
  getGetDashboardSummaryQueryKey,
  getListOrdersQueryKey,
  useGetDashboardSummary,
  useListOrders,
  useUpdateOrderStatus,
} from '@workspace/api-client-react';
import type { Order, OrderStatus } from '@workspace/api-client-react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});
const statusNames: Record<OrderStatus, string> = {
  pending: 'Bekliyor', preparing: 'Hazırlanıyor', ready: 'Hazır', completed: 'Tamamlandı',
};
const money = (value: number) => new Intl.NumberFormat('tr-TR', {
  style: 'currency', currency: 'TRY', maximumFractionDigits: 2,
}).format(value);
const clock = (value: string) => new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

function OrderTicket({ order, onAdvance, updating }: {
  order: Order;
  onAdvance: (order: Order) => void;
  updating: boolean;
}) {
  return <article className={`ticket ${order.status}`} data-testid={`card-order-${order.id}`}>
    <div className="ticket-top">
      <span className="ticket-number">#{order.orderNumber}</span>
      <span className="ticket-time"><Clock3 size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />{clock(order.createdAt)}</span>
    </div>
    <div className="ticket-customer">
      <h3>{order.customerName}</h3>
      <span className="source">{order.source === 'cashier' ? 'Tezgâh' : 'Çevrim içi'}</span>
    </div>
    <div className="items">
      {order.items.map(item => <div className="item" key={item.id}>
        <span><strong>{item.quantity}×</strong> {item.name}</span>
        <strong>{money(item.lineTotal)}</strong>
      </div>)}
    </div>
    {order.note && <p className="note"><b>NOT</b>{order.note}</p>}
    <div className="ticket-bottom">
      <span className="total">{money(order.total)}</span>
      {order.status === 'pending' && <button className="action" onClick={() => onAdvance(order)} disabled={updating} data-testid={`button-start-${order.id}`}>
        {updating ? <LoaderCircle size={14} className="spin" /> : <ChefHat size={14} />} Hazırlamaya al
      </button>}
      {order.status === 'preparing' && <button className="action green" onClick={() => onAdvance(order)} disabled={updating} data-testid={`button-ready-${order.id}`}>
        {updating ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Hazır
      </button>}
      {order.status === 'ready' && <span className="ready-label"><Check size={14} /> Teslime hazır</span>}
    </div>
  </article>;
}

function LoadingState() {
  return <div className="state" role="status" data-testid="status-loading">
    <span className="skeleton" /><span className="skeleton" /><span className="skeleton short" />
    <p>Sipariş sırası alınıyor</p>
  </div>;
}

function ErrorState({ retry, label }: { retry: () => void; label: string }) {
  return <div className="state" role="alert" data-testid="status-error">
    <span className="state-icon"><CircleAlert size={18} /></span>
    <h3>{label}</h3><p>Bağlantı kısa süreliğine kesilmiş olabilir. Yeniden deneyebilirsin.</p>
    <button className="retry" onClick={retry} data-testid="button-retry"><RefreshCw size={13} /> Yeniden dene</button>
  </div>;
}

function EmptyState({ ready }: { ready: boolean }) {
  return <div className="state" data-testid="status-empty">
    <span className="state-icon">{ready ? <Check size={18} /> : <ChefHat size={18} />}</span>
    <h3>{ready ? 'Teslim bekleyen yok' : 'Sıra şimdilik sakin'}</h3>
    <p>{ready ? 'Hazır siparişler bu bölümde görünür.' : 'Yeni sipariş geldiğinde burada belirecek.'}</p>
  </div>;
}

function KitchenBoard() {
  const queryClient = useQueryClient();
  const ordersQuery = useListOrders(undefined, {
    query: { queryKey: getListOrdersQueryKey(), refetchInterval: 5000 },
  });
  const summaryQuery = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 8000 },
  });
  const mutation = useUpdateOrderStatus();
  const orders = ordersQuery.data ?? [];
  const groups = useMemo(() => ({
    pending: orders.filter(order => order.status === 'pending'),
    preparing: orders.filter(order => order.status === 'preparing'),
    ready: orders.filter(order => order.status === 'ready'),
  }), [orders]);
  const activeCount = groups.pending.length + groups.preparing.length + groups.ready.length;
  const advance = (order: Order) => {
    const status: OrderStatus | undefined = order.status === 'pending' ? 'preparing' : order.status === 'preparing' ? 'ready' : undefined;
    if (!status) return;
    mutation.mutate({ id: order.id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      },
    });
  };
  const summary = summaryQuery.data;
  const lanes: { key: 'pending' | 'preparing' | 'ready'; title: string }[] = [
    { key: 'pending', title: 'Yeni siparişler' },
    { key: 'preparing', title: 'Hazırlanıyor' },
    { key: 'ready', title: 'Teslime hazır' },
  ];

  return <div className="kitchen-app">
    <header className="topbar">
      <div className="brand">
        <img src={`${import.meta.env.BASE_URL}brand/cafe-verun-logo.png`} alt="Café Verün" />
        <span className="brand-divider" />
        <span className="brand-caption">ARKA TEZGAH<br />MUTFAK EKRANI</span>
      </div>
      <div className="live-status"><span className="live-dot" /> CANLI SİPARİŞ AKIŞI</div>
    </header>
    <main className="page page-enter">
      <section className="welcome">
        <div><span className="eyebrow">CAFÉ VERÜN · MUTFAK</span><h1>Servis akışı,<br /><em>buradan başlar.</em></h1></div>
        <div className="date-block"><small>BUGÜNÜN VARDİYASI</small><strong>{new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</strong></div>
      </section>
      <section className="summary" aria-label="Gün özeti">
        <div className="summary-item"><span>Bekleyen</span><strong>{summary?.pending ?? '—'}</strong><small>hazırlık sırası</small></div>
        <div className="summary-item"><span>Hazırlanıyor</span><strong>{summary?.preparing ?? '—'}</strong><small>mutfakta</small></div>
        <div className="summary-item highlight"><span>Hazır</span><strong>{summary?.ready ?? '—'}</strong><small>teslim bekliyor</small></div>
        <div className="summary-item"><span>Bugün tamamlanan</span><strong>{summary?.completedToday ?? '—'}</strong><small>{summary ? money(summary.revenueToday) : 'günlük toplam'}</small></div>
      </section>
      <section aria-labelledby="queue-title">
        <div className="board-heading">
          <div><span className="eyebrow">SİPARİŞ PANOSU</span><h2 id="queue-title">Aktif hazırlık <span className="board-count">{activeCount.toString().padStart(2, '0')}</span></h2></div>
          <span className="sync">5 saniyede bir güncellenir</span>
        </div>
        {mutation.isError && <div className="error-inline" role="alert" data-testid="text-update-error">Sipariş durumu güncellenemedi. Lütfen yeniden deneyin.</div>}
        {ordersQuery.isLoading ? <LoadingState /> : ordersQuery.isError ?
          <ErrorState retry={() => ordersQuery.refetch()} label="Siparişlere ulaşılamadı" /> :
          <div className="columns">
            {lanes.map(lane => <section className={`lane lane-${lane.key}`} key={lane.key} aria-label={lane.title}>
              <header className="lane-head"><span className="lane-title"><i className="lane-mark" />{lane.title}</span><b>{groups[lane.key].length.toString().padStart(2, '0')}</b></header>
              {groups[lane.key].length === 0 ? <EmptyState ready={lane.key === 'ready'} /> :
                <div className="ticket-list">{groups[lane.key].map(order =>
                  <OrderTicket key={order.id} order={order} onAdvance={advance} updating={mutation.isPending} />)}</div>}
            </section>)}
          </div>}
        {summaryQuery.isError && <div className="error-inline" role="status">Gün özeti şu anda yenilenemiyor; sipariş panosu çalışmaya devam ediyor. <button className="retry" onClick={() => summaryQuery.refetch()}>Özeti yenile</button></div>}
      </section>
      <footer className="footer"><span>CAFÉ VERÜN · MAHALLEMİZİN KAHVESİ</span><span>Hazır siparişi teslim için kasaya bırakın.</span></footer>
    </main>
  </div>;
}

function App() {
  return <QueryClientProvider client={queryClient}><KitchenBoard /></QueryClientProvider>;
}

export default App;
