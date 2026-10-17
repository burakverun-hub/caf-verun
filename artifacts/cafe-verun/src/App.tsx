import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import {
  ArrowLeft, ArrowRight, Check, Clock3, Coffee, LoaderCircle, Minus, Plus, RefreshCw,
} from 'lucide-react';
import {
  getGetOrderQueryKey, getHealthCheckQueryKey, getListMenuQueryKey,
  useCreateOrder, useGetOrder, useHealthCheck, useListMenu,
} from '@workspace/api-client-react';
import type { MenuItem, Order, OrderStatus } from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});
const LOGO = '/brand/cafe-verun-logo.png';
const money = (value: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(value);
const statuses: Record<OrderStatus, string> = { pending: 'Sırada', preparing: 'Hazırlanıyor', ready: 'Teslim alınabilir', completed: 'Teslim edildi' };
const statusOrder: OrderStatus[] = ['pending', 'preparing', 'ready', 'completed'];
const formatTime = (value: string) => new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

function AppShell({ children }: { children: ReactNode }) {
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  return <div className="app-shell">
    <header className="topbar">
      <Link href="/" className="brand-lockup" data-testid="link-home">
        <img src={LOGO} alt="Café Verün" className="brand-logo" />
        <span className="brand-caption">MAHALLEMİZİN KAHVESİ · 2022’DEN BERİ</span>
      </Link>
      <div className="service-indicator"><span className={`live-dot ${health.isError ? 'offline' : ''}`} />{health.isError ? 'Bağlantı yok' : 'Canlı servis'}</div>
    </header>
    <main>{children}</main>
    <footer className="site-footer"><span>© Café Verün · Her gün, iyi bir kahveyle başlar.</span><span>Özenle hazırlandı, burada paylaşıldı.</span></footer>
  </div>;
}

function LoadingState({ label = 'Hazırlanıyor' }: { label?: string }) {
  return <div className="state-panel" data-testid="status-loading"><span className="skeleton-line wide" /><span className="skeleton-line" /><span className="skeleton-line short" /><span className="state-caption"><LoaderCircle size={15} className="spin" /> {label}</span></div>;
}
function ErrorState({ onRetry, label = 'Bir şeyler yolunda gitmedi.' }: { onRetry: () => void; label?: string }) {
  return <div className="state-panel state-error" data-testid="status-error"><span className="state-symbol">!</span><h3>{label}</h3><p>Birazdan yeniden deneyebilirsin.</p><button className="button button-outline" onClick={onRetry} data-testid="button-retry"><RefreshCw size={15} /> Yeniden dene</button></div>;
}
function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state" data-testid="status-empty"><span className="empty-mark"><Coffee size={22} /></span><h3>{title}</h3><p>{detail}</p></div>;
}

type Cart = Record<number, number>;
function MenuList({ menu, cart, onChange, compact = false }: { menu: MenuItem[]; cart: Cart; onChange: (id: number, delta: number) => void; compact?: boolean }) {
  const categories = useMemo(() => [...new Set(menu.map(item => item.category))], [menu]);
  return <div className={`menu-list ${compact ? 'menu-compact' : ''}`}>
    {categories.map((category, ci) => <section className="menu-category" key={category}>
      <div className="category-heading"><span className="category-index">0{ci + 1}</span><h3>{category}</h3><span className="category-rule" /></div>
      {menu.filter(item => item.category === category).map(item => <article className={`menu-item ${!item.available ? 'unavailable' : ''}`} key={item.id} data-testid={`menu-item-${item.id}`}>
        <div className="menu-copy"><div className="menu-title-row"><h4>{item.name}</h4><span className="menu-price">{money(item.price)}</span></div>
          <p>{item.description}</p>{!item.available && <span className="sold-out">Bugün tükendi</span>}</div>
        {item.available && <div className="item-controls">
          {cart[item.id] ? <><button className="quantity-button" aria-label={`${item.name} azalt`} onClick={() => onChange(item.id, -1)} data-testid={`button-minus-${item.id}`}><Minus size={14} /></button><span className="quantity-value">{cart[item.id]}</span><button className="quantity-button" aria-label={`${item.name} artır`} onClick={() => onChange(item.id, 1)} data-testid={`button-plus-${item.id}`}><Plus size={14} /></button></> :
            <button className="add-button" onClick={() => onChange(item.id, 1)} data-testid={`button-add-${item.id}`}><Plus size={15} /><span>Ekle</span></button>}
        </div>}
      </article>)}
    </section>)}
  </div>;
}

function OrderForm({ source, menu, onSuccess, title = 'Siparişini oluştur', submitLabel = 'Siparişi gönder', cart: externalCart, onCartChange }: {
  source: 'customer'; menu: MenuItem[]; onSuccess: (order: Order) => void; title?: string; submitLabel?: string;
  cart?: Cart; onCartChange?: (id: number, delta: number) => void;
}) {
  const [localCart, setLocalCart] = useState<Cart>({});
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const createOrder = useCreateOrder();
  const cart = externalCart ?? localCart;
  const changeQuantity = (id: number, delta: number) => {
    if (onCartChange) { onCartChange(id, delta); return; }
    setLocalCart(current => {
      const quantity = Math.max(0, (current[id] ?? 0) + delta);
      const updated = { ...current };
      if (quantity === 0) delete updated[id]; else updated[id] = quantity;
      return updated;
    });
  };
  const chosen = menu.filter(item => cart[item.id]).map(item => ({ item, quantity: cart[item.id] }));
  const total = chosen.reduce((sum, row) => sum + row.item.price * row.quantity, 0);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { setFormError('Sipariş için adını yazmalısın.'); return; }
    if (chosen.length === 0) { setFormError('Sepetine en az bir ürün ekle.'); return; }
    setFormError('');
    createOrder.mutate({ data: {
      customerName: name.trim(), source,
      ...(note.trim() ? { note: note.trim() } : {}),
      items: chosen.map(({ item, quantity }) => ({ menuItemId: item.id, quantity })),
    } }, { onSuccess });
  };
  return <form className="order-form" onSubmit={submit}>
    <div className="form-heading"><span className="eyebrow">SİPARİŞ DETAYI</span><h3>{title}</h3></div>
    <label className="field-label" htmlFor={`customer-name-${source}`}>Adın</label>
    <input id={`customer-name-${source}`} className="text-input" value={name} onChange={event => setName(event.target.value)} placeholder="Sipariş kimin adına?" maxLength={120} data-testid="input-customer-name" />
    <div className="basket-lines">
      {chosen.length ? chosen.map(({ item, quantity }) => <div className="basket-line" key={item.id}><span>{quantity} × {item.name}</span><strong>{money(item.price * quantity)}</strong></div>) : <p className="basket-empty">Menüden bir şey seç, burada görünsün.</p>}
    </div>
    <div className="basket-total"><span>Toplam</span><strong data-testid="text-order-total">{money(total)}</strong></div>
    <label className="field-label" htmlFor={`order-note-${source}`}>Not <span className="optional">isteğe bağlı</span></label>
    <textarea id={`order-note-${source}`} className="text-input note-input" value={note} onChange={event => setNote(event.target.value)} placeholder="Süt tercihi veya küçük bir not..." maxLength={500} data-testid="input-order-note" />
    {formError && <p className="form-error" data-testid="text-form-error">{formError}</p>}
    {createOrder.isError && <p className="form-error" data-testid="text-submit-error">Sipariş kaydedilemedi. Lütfen tekrar dene.</p>}
    <button className="button button-primary submit-order" type="submit" disabled={createOrder.isPending} data-testid="button-submit-order">
      {createOrder.isPending ? <><LoaderCircle size={16} className="spin" /> Kaydediliyor</> : <>{submitLabel}<ArrowRight size={16} /></>}
    </button>
    <p className="order-footnote">Ödeme, siparişini teslim alırken.</p>
  </form>;
}

function CustomerHome() {
  const [location, setLocation] = useLocation();
  const menuQuery = useListMenu({ query: { queryKey: getListMenuQueryKey() } });
  const [cart, setCart] = useState<Cart>({});
  const [created, setCreated] = useState<Order | null>(null);
  const menu = menuQuery.data ?? [];
  const setQuantity = (id: number, delta: number) => setCart(prev => {
    const quantity = Math.max(0, (prev[id] ?? 0) + delta);
    const copy = { ...prev }; if (!quantity) delete copy[id]; else copy[id] = quantity; return copy;
  });
  if (created) return <section className="success-page page-enter">
    <div className="success-seal"><Check size={35} /></div><span className="eyebrow">SİPARİŞİN MUTFAĞA İLETİLDİ</span>
    <h1>Birazdan<br /><em>görüşürüz.</em></h1><p>{created.customerName}, siparişin özenle hazırlanıyor.</p>
    <div className="success-ticket"><span>SİPARİŞ NUMARAN</span><strong>{created.orderNumber}</strong><small>{money(created.total)} · yaklaşık 8–12 dakika</small></div>
    <button className="button button-primary" onClick={() => setLocation(`/track/${created.id}`)} data-testid="button-track-order">Siparişimi takip et <ArrowRight size={16} /></button>
    <button className="text-button" onClick={() => { setCreated(null); setCart({}); }} data-testid="button-new-order">Yeni sipariş ver</button>
  </section>;
  return <div className="customer-page page-enter">
    <section className="welcome-band">
      <div className="welcome-copy"><span className="eyebrow">KÜÇÜK BİR MOLA, GÜZEL BİR GÜN</span><h1>Günün en güzel<br /><em>köşesi burada.</em></h1>
        <p>Mahalle arasında, iyi kahvenin ve tanıdık yüzlerin buluştuğu yer. Ne istersin bugün?</p>
        <a href="#menu" className="button button-dark" data-testid="link-menu-scroll">Menüyü keşfet <ArrowRight size={16} /></a>
      </div>
      <div className="hero-stamp"><img src={LOGO} alt="Café Verün logosu" /><div className="stamp-caption"><span>ÖZENLE DEMLENDİ</span><i /> <span>SEVGİYLE SUNULDU</span></div></div>
      <div className="hero-note"><span className="note-dash" />Mahallene<br />yakışan bir kahve.</div>
    </section>
    <section className="order-story" id="menu">
      <div className="section-intro"><span className="eyebrow">BUGÜN VERÜN’DE</span><h2>Menüye<br /><em>buyur.</em></h2><p>Klasiklerden küçük sürprizlere; her fincanda tanıdık bir sıcaklık.</p>
        <div className="opening-note"><Clock3 size={15} /><span>Her gün <b>08.00 – 20.00</b></span></div>
      </div>
      <div className="menu-column">
        {menuQuery.isLoading ? <LoadingState label="Günün menüsü geliyor" /> :
          menuQuery.isError ? <ErrorState onRetry={() => menuQuery.refetch()} label="Menü şu an yüklenemiyor." /> :
            menu.length === 0 ? <EmptyState title="Menü hazırlanıyor" detail="Birazdan burada olacağız." /> :
              <MenuList menu={menu} cart={cart} onChange={setQuantity} />}
      </div>
      <aside className="order-aside"><OrderForm source="customer" menu={menu} cart={cart} onCartChange={setQuantity} onSuccess={setCreated} /></aside>
    </section>
    <section className="closing-note"><span className="eyebrow">CAFÉ VERÜN · SINCE 2022</span><p>İyi şeyler<br /><em>aceleye gelmez.</em></p><span className="closing-rule" /></section>
  </div>;
}

function TrackOrder() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const orderQuery = useGetOrder(validId ? id : 0, { query: { enabled: validId, queryKey: getGetOrderQueryKey(validId ? id : 0), refetchInterval: 5000 } });
  const order = orderQuery.data as Order | undefined;
  return <div className="track-page page-enter">
    <Link href="/" className="back-link" data-testid="link-back-menu"><ArrowLeft size={15} /> Menüye dön</Link>
    {!validId ? <EmptyState title="Sipariş numarası geçersiz" detail="Menüye dönerek yeni bir sipariş verebilirsin." /> :
      orderQuery.isLoading ? <LoadingState label="Sipariş bilgisi alınıyor" /> :
        orderQuery.isError ? <ErrorState onRetry={() => orderQuery.refetch()} label="Bu siparişe şu an ulaşılamıyor." /> :
          order ? <div className="track-card">
            <div className="track-topline"><span className="eyebrow">SİPARİŞ TAKİBİ</span><span className="live-pill"><i /> CANLI</span></div>
            <p className="track-number">{order.orderNumber}</p><h1>{order.status === 'ready' ? 'Hazır, seni bekliyor.' : order.status === 'completed' ? 'Afiyet olsun.' : 'Güzel şeyler hazırlanıyor.'}</h1>
            <p className="track-greeting">{order.customerName}, sipariş durumun burada güncellenir.</p>
            <div className="progress-rail">{statusOrder.map((status, index) => {
              const current = statusOrder.indexOf(order.status);
              return <div className={`progress-step ${index <= current ? 'done' : ''} ${index === current ? 'current' : ''}`} key={status}>
                <span className="progress-dot">{index < current ? <Check size={13} /> : <i />}</span><span>{statuses[status]}</span>
              </div>;
            })}</div>
            <div className="track-items">{order.items.map(item => <div className="track-item" key={item.id}><span>{item.quantity} × {item.name}</span><strong>{money(item.lineTotal)}</strong></div>)}
              {order.note && <div className="track-note">Not: {order.note}</div>}
              <div className="track-total"><span>Toplam</span><strong>{money(order.total)}</strong></div>
            </div><p className="track-time">Sipariş saati · {formatTime(order.createdAt)} <span>Her 5 saniyede yenilenir</span></p>
          </div> : null}
  </div>;
}

function AppRouter() {
  return <AppShell><Switch>
    <Route path="/" component={CustomerHome} />
    <Route path="/track/:id" component={TrackOrder} />
    <Route component={NotFound} />
  </Switch></AppShell>;
}
function App() {
  return <QueryClientProvider client={queryClient}>
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppRouter /></WouterRouter>
  </QueryClientProvider>;
}
export default App;
