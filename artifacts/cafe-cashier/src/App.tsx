import { type FormEvent, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, Check, CheckCircle2, Coffee, Minus, Plus, RefreshCw,
  Search, ShoppingBag, Sparkles, Utensils,
} from 'lucide-react';
import {
  getGetDashboardSummaryQueryKey, getListMenuQueryKey, getListOrdersQueryKey,
  useCreateOrder, useGetDashboardSummary, useListMenu, useListOrders, useUpdateOrderStatus,
} from '@workspace/api-client-react';
import type { MenuItem, Order } from '@workspace/api-client-react';
import './cashier.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});
const LOGO = `${import.meta.env.BASE_URL}brand/cafe-verun-logo.png`;
const money = (value: number) => new Intl.NumberFormat('tr-TR', {
  style: 'currency', currency: 'TRY', maximumFractionDigits: 2,
}).format(value);
const time = (value: string) => new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit', minute: '2-digit',
}).format(new Date(value));
type Cart = Record<number, number>;

function LoadingBlock({ label }: { label: string }) {
  return <div className="loading-block" role="status">
    <span className="skeleton wide" /><span className="skeleton" /><span className="skeleton narrow" />
    <small>{label}</small>
  </div>;
}

function RetryPanel({ title, retry }: { title: string; retry: () => void }) {
  return <div className="retry-panel">
    <span className="retry-mark">!</span><strong>{title}</strong>
    <p>Bağlantı kurulamadı. Birazdan yeniden deneyin.</p>
    <button className="quiet-button" onClick={retry}><RefreshCw size={14} /> Yeniden dene</button>
  </div>;
}

function Metric({ label, value, detail, kind = '' }: { label: string; value: string | number; detail: string; kind?: string }) {
  return <article className={`metric ${kind}`}>
    <span>{label}</span><strong>{value}</strong><small>{detail}</small>
  </article>;
}

function OrderComposer({ menu }: { menu: MenuItem[] }) {
  const [cart, setCart] = useState<Cart>({});
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Tümü');
  const [formError, setFormError] = useState('');
  const queryClient = useQueryClient();
  const create = useCreateOrder();
  const categories = useMemo(() => ['Tümü', ...new Set(menu.map(item => item.category))], [menu]);
  const visible = menu.filter(item => item.available)
    .filter(item => category === 'Tümü' || item.category === category)
    .filter(item => `${item.name} ${item.description}`.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr')));
  const selected = menu.filter(item => cart[item.id]).map(item => ({ item, quantity: cart[item.id] }));
  const total = selected.reduce((sum, row) => sum + row.item.price * row.quantity, 0);
  const change = (id: number, delta: number) => setCart(current => {
    const quantity = Math.max(0, Math.min(50, (current[id] ?? 0) + delta));
    const next = { ...current };
    if (quantity === 0) delete next[id]; else next[id] = quantity;
    return next;
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) { setFormError('Sipariş için müşteri adını yazın.'); return; }
    if (!selected.length) { setFormError('Devam etmek için menüden ürün seçin.'); return; }
    setFormError('');
    create.mutate({ data: {
      customerName: name.trim(),
      source: 'cashier',
      ...(note.trim() ? { note: note.trim() } : {}),
      items: selected.map(({ item, quantity }) => ({ menuItemId: item.id, quantity })),
    } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setName('');
        setNote('');
        setCart({});
      },
    });
  };

  return <div className="composer-layout">
    <section className="menu-panel" aria-label="Menüden ürün seç">
      <div className="menu-toolbar">
        <div className="search-wrap"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Menüde ara" aria-label="Menüde ara" data-testid="input-menu-search" /></div>
        <div className="category-tabs" aria-label="Menü kategorileri">
          {categories.map(value => <button key={value} className={category === value ? 'category-tab selected' : 'category-tab'} onClick={() => setCategory(value)} data-testid={`filter-category-${value}`}>{value}</button>)}
        </div>
      </div>
      <div className="menu-results">
        {!visible.length ? <div className="menu-empty"><Coffee size={22} /><strong>{menu.length ? 'Aradığınız ürün bulunamadı' : 'Menüde ürün yok'}</strong><span>Başka bir arama ya da kategori deneyin.</span></div> :
          visible.map((item, index) => <MenuRow key={item.id} item={item} quantity={cart[item.id] ?? 0} change={change} index={index} />)}
      </div>
    </section>
    <form className="ticket-panel" onSubmit={submit}>
      <div className="ticket-heading"><div><span className="overline">YENİ SİPARİŞ</span><h3>Tezgâh fişi</h3></div><span className="ticket-icon"><ShoppingBag size={17} /></span></div>
      <label className="field-label" htmlFor="guest-name">Müşteri adı</label>
      <input id="guest-name" className="form-input" value={name} onChange={event => setName(event.target.value)} placeholder="Örn. Deniz" maxLength={120} autoComplete="off" data-testid="input-cashier-name" />
      <div className="ticket-lines">
        <div className="ticket-lines-heading"><span>SEÇİLENLER</span><span>{selected.length} ürün çeşidi</span></div>
        {selected.length ? selected.map(({ item, quantity }) => <div className="ticket-line" key={item.id}>
          <div><strong>{quantity} × {item.name}</strong><small>{money(item.price)} / adet</small></div>
          <span>{money(item.price * quantity)}</span>
          <button type="button" className="line-remove" aria-label={`${item.name} azalt`} onClick={() => change(item.id, -1)}><Minus size={13} /></button>
        </div>) : <div className="ticket-empty"><span className="empty-ring"><Utensils size={18} /></span><p>Menüden ürün ekleyin.<br />Fişiniz burada oluşacak.</p></div>}
      </div>
      <label className="field-label note-label" htmlFor="order-note">Sipariş notu <span>İSTEĞE BAĞLI</span></label>
      <textarea id="order-note" className="form-input note-field" value={note} onChange={event => setNote(event.target.value)} placeholder="Süt tercihi, paket notu..." maxLength={500} data-testid="input-cashier-note" />
      {formError && <p className="form-error" role="alert">{formError}</p>}
      {create.isError && <p className="form-error" role="alert">Sipariş kaydedilemedi. Bilgileriniz duruyor; yeniden deneyin.</p>}
      <div className="ticket-total"><span>Toplam</span><strong>{money(total)}</strong></div>
      <button className="send-order" type="submit" disabled={create.isPending || !menu.length} data-testid="button-cashier-submit">
        {create.isPending ? 'Kaydediliyor…' : 'Mutfağa gönder'} <ArrowRight size={16} />
      </button>
      <p className="ticket-footnote">Sipariş mutfak ekranına anında iletilir.</p>
    </form>
  </div>;
}

function MenuRow({ item, quantity, change, index }: { item: MenuItem; quantity: number; change: (id: number, delta: number) => void; index: number }) {
  return <article className="menu-row" style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }} data-testid={`menu-item-${item.id}`}>
    <div className="menu-item-info"><span className="menu-category-label">{item.category}</span><h4>{item.name}</h4>
      {item.description && <p>{item.description}</p>}
    </div>
    <div className="menu-item-action"><strong>{money(item.price)}</strong>
      {quantity > 0 ? <div className="quantity-stepper">
        <button type="button" onClick={() => change(item.id, -1)} aria-label={`${item.name} azalt`} data-testid={`button-minus-${item.id}`}><Minus size={14} /></button>
        <span>{quantity}</span>
        <button type="button" onClick={() => change(item.id, 1)} aria-label={`${item.name} artır`} data-testid={`button-plus-${item.id}`}><Plus size={14} /></button>
      </div> : <button type="button" className="add-product" onClick={() => change(item.id, 1)} data-testid={`button-add-${item.id}`}><Plus size={14} /> Ekle</button>}
    </div>
  </article>;
}

function HandoffQueue() {
  const queryClient = useQueryClient();
  const orders = useListOrders(undefined, { query: { queryKey: getListOrdersQueryKey(), refetchInterval: 5000 } });
  const update = useUpdateOrderStatus();
  const ready = (orders.data ?? []).filter(order => order.status === 'ready')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const handoff = (order: Order) => update.mutate({ id: order.id, data: { status: 'completed' } }, {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    },
  });
  return <section className="handoff-section">
    <div className="section-title">
      <div><span className="overline">TEZGAHIN DİĞER TARAFI</span><h2>Teslim sırası <span className="count-pill">{ready.length.toString().padStart(2, '0')}</span></h2></div>
      <span className="live-indicator"><i /> Canlı · 5 sn</span>
    </div>
    {update.isError && <div className="handoff-error" role="alert">Teslim durumu güncellenemedi. Yeniden deneyin.</div>}
    {orders.isLoading ? <LoadingBlock label="Hazır siparişler alınıyor" /> :
      orders.isError ? <RetryPanel title="Teslim sırası yüklenemedi" retry={() => orders.refetch()} /> :
        ready.length === 0 ? <div className="handoff-empty"><span><Check size={17} /></span><div><strong>Şu an teslim bekleyen yok</strong><small>Hazır siparişler burada görünür.</small></div></div> :
          <div className="handoff-list">{ready.map(order => <article className="handoff-card" key={order.id} data-testid={`card-order-${order.id}`}>
            <div className="handoff-card-head"><span className="order-number">#{order.orderNumber}</span><span className="ready-badge"><i /> Teslim alınabilir</span></div>
            <div className="handoff-customer"><h3>{order.customerName}</h3><span>{time(order.createdAt)} <b /> {order.source === 'cashier' ? 'Tezgâh siparişi' : 'Online sipariş'}</span></div>
            <div className="handoff-items">{order.items.map(line => <div className="handoff-line" key={line.id}><span><b>{line.quantity}×</b> {line.name}</span><strong>{money(line.lineTotal)}</strong></div>)}</div>
            {order.note && <p className="handoff-note"><span>NOT</span>{order.note}</p>}
            <div className="handoff-card-bottom"><strong>{money(order.total)}</strong>
              <button className="complete-button" onClick={() => handoff(order)} disabled={update.isPending} data-testid={`button-handoff-${order.id}`}>
                {update.isPending ? 'İşleniyor…' : <><CheckCircle2 size={15} /> Teslim edildi</>}
              </button>
            </div>
          </article>)}</div>
    }
  </section>;
}

function CashierWorkspace() {
  const menu = useListMenu({ query: { queryKey: getListMenuQueryKey(), refetchInterval: 30000 } });
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 8000 } });
  return <div className="cashier-app">
    <header className="workspace-header">
      <div className="brand">
        <img src={LOGO} alt="Café Verün" />
        <span className="brand-divider" />
        <div><b>Ön tezgâh</b><small>KASA ÇALIŞMA ALANI</small></div>
      </div>
      <div className="header-right"><span className="open-status"><i /> SERVİS AÇIK</span><span className="header-date">{new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span></div>
    </header>
    <main className="workspace-main">
      <div className="welcome-row"><div><span className="overline">CAFÉ VERÜN <span className="overline-divider">/</span> GÜNLÜK AKIŞ</span><h1>Merhaba, <em>tezgâh hazır.</em></h1><p>Yeni siparişleri alın, hazır olanları güvenle teslim edin.</p></div>
        <span className="shift-chip"><Sparkles size={15} /> Mahalleye iyi bak</span>
      </div>
      {summary.isLoading ? <div className="metrics-loading"><LoadingBlock label="Günün özeti hazırlanıyor" /></div> :
        summary.isError ? <div className="summary-error"><RetryPanel title="Günlük özet alınamadı" retry={() => summary.refetch()} /></div> :
          summary.data && <section className="metrics" aria-label="Günlük özet">
            <Metric label="Bekleyen" value={summary.data.pending} detail="mutfak sırasına alındı" />
            <Metric label="Hazırlanıyor" value={summary.data.preparing} detail="mutfakta çalışılıyor" />
            <Metric label="Hazır" value={summary.data.ready} detail="teslim noktasında" kind="metric-ready" />
            <Metric label="Bugün tamamlanan" value={summary.data.completedToday} detail="sipariş teslim edildi" />
            <Metric label="Günlük ciro" value={money(summary.data.revenueToday)} detail="tamamlanan siparişler" kind="metric-revenue" />
          </section>}
      <div className="section-title composer-title">
        <div><span className="overline">MAĞAZA İÇİ SİPARİŞ</span><h2>Sipariş oluştur</h2></div>
        <span className="source-tag"><Coffee size={14} /> Tezgâhtan</span>
      </div>
      {menu.isLoading ? <LoadingBlock label="Menü alınıyor" /> :
        menu.isError ? <RetryPanel title="Menü yüklenemedi" retry={() => menu.refetch()} /> :
          !menu.data?.length ? <div className="no-menu"><Coffee size={23} /><strong>Menü henüz hazır değil</strong><span>Ürünler erişilebilir olduğunda burada görünecek.</span><button className="quiet-button" onClick={() => menu.refetch()}><RefreshCw size={14} /> Yenile</button></div> :
            <OrderComposer menu={menu.data} />}
      <HandoffQueue />
    </main>
    <footer className="workspace-footer"><span>© Café Verün · Her fincanda tanıdık bir sıcaklık.</span><span className="footer-live"><i /> Sipariş akışı güncel</span></footer>
  </div>;
}

function App() {
  return <QueryClientProvider client={queryClient}><CashierWorkspace /></QueryClientProvider>;
}

export default App;
