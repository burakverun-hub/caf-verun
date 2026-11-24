import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import {
  ArrowLeft, ArrowRight, Check, Clock3, Coffee, LoaderCircle, MapPin, Minus, Plus, RefreshCw, MailCheck,
} from 'lucide-react';
import {
  getGetAuthMeQueryKey, getGetOrderQueryKey, getHealthCheckQueryKey, getListBranchesQueryKey,
  getListCategoriesQueryKey, getListMenuQueryKey, getListOrdersQueryKey, useCreateOrder,
  useGetAuthMe, useGetOrder, useHealthCheck, useListBranches, useListCategories, useListMenu, useListOrders,
  firebaseAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, updateProfile,
  signInWithGoogle, googleSignInErrorMessage,
} from '@workspace/api-client-react';
import type { Branch, BranchMenuItem, Order, OrderStatus, FirebaseUser } from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});
const LOGO = '/brand/cafe-verun-logo.png';
const money = (value: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(value);
const statuses: Record<OrderStatus, string> = { pending: 'Sırada', preparing: 'Hazırlanıyor', ready: 'Teslim alınabilir', completed: 'Teslim edildi' };
const statusOrder: OrderStatus[] = ['pending', 'preparing', 'ready', 'completed'];
const formatTime = (value: string) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

type AuthState = { isLoaded: boolean; user: FirebaseUser | null; isSignedIn: boolean };
const AuthContext = createContext<AuthState>({ isLoaded: false, user: null, isSignedIn: false });
const useAuth = () => useContext(AuthContext);
function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  useEffect(() => onAuthStateChanged(firebaseAuth, nextUser => {
    setUser(nextUser);
    setIsLoaded(true);
  }), []);
  return <AuthContext.Provider value={{ isLoaded, user, isSignedIn: Boolean(user?.emailVerified) }}>{children}</AuthContext.Provider>;
}

function AppShell({ children }: { children: ReactNode }) {
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  const auth = useAuth();
  const handleSignOut = () => signOut(firebaseAuth);
  const profileQuery = useGetAuthMe({
    query: { enabled: auth.isLoaded && Boolean(auth.isSignedIn), queryKey: getGetAuthMeQueryKey(), retry: false },
  });
  const profile = profileQuery.data;
  return <div className="app-shell">
    <header className="topbar">
      <Link href="/" className="brand-lockup" data-testid="link-home">
        <img src={LOGO} alt="Café Verün" className="brand-logo" />
        <span className="brand-caption">MAHALLEMİZİN KAHVESİ · 2022’DEN BERİ</span>
      </Link>
      <nav className="customer-nav" aria-label="Müşteri menüsü">
        {auth.isLoaded && auth.isSignedIn && profile?.role === 'customer' && <>
          <Link href="/orders" className="nav-link" data-testid="link-orders">Siparişlerim</Link>
          <span className="nav-greeting">{profile.fullName}</span>
          <button className="nav-signout" type="button" onClick={() => void handleSignOut()} data-testid="button-sign-out">Çıkış</button>
        </>}
        {auth.isLoaded && !auth.isSignedIn && <>
          <Link href="/sign-in" className="nav-link" data-testid="link-sign-in">Giriş yap</Link>
          <Link href="/sign-up" className="button button-dark nav-signup" data-testid="link-sign-up">Üye ol <ArrowRight size={14} /></Link>
        </>}
        {auth.isLoaded && auth.isSignedIn && profileQuery.isLoading && <span className="nav-greeting">Hesap yükleniyor</span>}
      </nav>
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
function MenuList({ menu, categories, cart, onChange, canOrder }: {
  menu: BranchMenuItem[]; categories: string[]; cart: Cart; onChange: (id: number, delta: number) => void; canOrder: boolean;
}) {
  const grouped = useMemo(() => {
    const names = categories.length ? categories : [...new Set(menu.map(row => row.categoryName))];
    return names.map(name => ({ name, items: menu.filter(row => row.categoryName === name) })).filter(group => group.items.length);
  }, [categories, menu]);
  return <div className="menu-list">
    {grouped.map((group, ci) => <section className="menu-category" key={group.name}>
      <div className="category-heading"><span className="category-index">0{ci + 1}</span><h3>{group.name}</h3><span className="category-rule" /></div>
      {group.items.map(row => {
        const item = row.item;
        const isAvailable = row.available && item.available && row.stockAvailable;
        return <article className={`menu-item ${!isAvailable ? 'unavailable' : ''}`} key={item.id} data-testid={`menu-item-${item.id}`}>
          <div className="menu-copy">
            <div className="menu-title-row"><h4>{item.name}</h4><span className="menu-price">{money(row.price)}</span></div>
            <p>{item.description}</p>
            <div className="food-details">
              <span><b>İçindekiler</b> {item.publicIngredients?.length ? item.publicIngredients.join(', ') : 'Bilgi belirtilmemiş'}</span>
              <span><b>Alerjenler</b> {item.allergens?.length ? item.allergens.join(', ') : 'Bilgi belirtilmemiş'}</span>
            </div>
            {!isAvailable && <span className="sold-out">Bugün tükendi</span>}
          </div>
          {isAvailable && <div className="item-controls">
            {cart[item.id] ? <><button className="quantity-button" aria-label={`${item.name} azalt`} onClick={() => onChange(item.id, -1)} data-testid={`button-minus-${item.id}`}><Minus size={14} /></button><span className="quantity-value">{cart[item.id]}</span><button className="quantity-button" aria-label={`${item.name} artır`} onClick={() => onChange(item.id, 1)} data-testid={`button-plus-${item.id}`}><Plus size={14} /></button></> :
              <button className="add-button" onClick={() => onChange(item.id, 1)} data-testid={`button-add-${item.id}`}><Plus size={15} /><span>{canOrder ? 'Ekle' : 'Sepete ekle'}</span></button>}
          </div>}
        </article>;
      })}
    </section>)}
  </div>;
}

function OrderForm({ branchId, menu, cart, onCartChange, onSuccess, profileName, signedIn }: {
  branchId: number | null; menu: BranchMenuItem[]; cart: Cart; onCartChange: (id: number, delta: number) => void;
  onSuccess: (order: Order) => void; profileName: string; signedIn: boolean;
}) {
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [, setLocation] = useLocation();
  const createOrder = useCreateOrder();
  const chosen = menu.filter(row => cart[row.item.id]).map(row => ({ row, quantity: cart[row.item.id] }));
  const total = chosen.reduce((sum, entry) => sum + entry.row.price * entry.quantity, 0);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!signedIn) { setLocation('/sign-in'); return; }
    if (!branchId) { setFormError('Sipariş vermek için önce şube seç.'); return; }
    if (chosen.length === 0) { setFormError('Sepetine en az bir ürün ekle.'); return; }
    setFormError('');
    createOrder.mutate({ data: {
      branchId,
      ...(note.trim() ? { note: note.trim() } : {}),
      items: chosen.map(({ row, quantity }) => ({ menuItemId: row.item.id, quantity })),
    } }, { onSuccess });
  };
  return <form className="order-form" onSubmit={submit}>
    <div className="form-heading"><span className="eyebrow">SİPARİŞ DETAYI</span><h3>Siparişini oluştur</h3></div>
    <div className="basket-lines">
      {chosen.length ? chosen.map(({ row, quantity }) => <div className="basket-line" key={row.item.id}><span>{quantity} × {row.item.name}</span><strong>{money(row.price * quantity)}</strong></div>) : <p className="basket-empty">Menüden bir şey seç, burada görünsün.</p>}
    </div>
    <div className="basket-total"><span>Toplam</span><strong data-testid="text-order-total">{money(total)}</strong></div>
    <label className="field-label" htmlFor="order-note">Not <span className="optional">isteğe bağlı</span></label>
    <textarea id="order-note" className="text-input note-input" value={note} onChange={event => setNote(event.target.value)} placeholder="Süt tercihi veya küçük bir not..." maxLength={500} data-testid="input-order-note" />
    {formError && <p className="form-error" data-testid="text-form-error">{formError}</p>}
    {createOrder.isError && <p className="form-error" data-testid="text-submit-error">Sipariş kaydedilemedi. Lütfen tekrar dene.</p>}
    <button className="button button-primary submit-order" type="submit" disabled={createOrder.isPending || !branchId} data-testid="button-submit-order">
      {createOrder.isPending ? <><LoaderCircle size={16} className="spin" /> Kaydediliyor</> : <>{signedIn ? 'Siparişi gönder' : 'Giriş yap ve sipariş ver'}<ArrowRight size={16} /></>}
    </button>
    {!signedIn && <p className="order-footnote">Sipariş verebilmek için müşteri hesabınla giriş yap.</p>}
    {signedIn && profileName && <p className="order-footnote">Sipariş {profileName} adına oluşturulacak · Ödeme teslim alırken.</p>}
  </form>;
}

function CustomerHome() {
  const [location, setLocation] = useLocation();
  const auth = useAuth();
  const profileQuery = useGetAuthMe({
    query: { enabled: auth.isLoaded && Boolean(auth.isSignedIn), queryKey: getGetAuthMeQueryKey(), retry: false },
  });
  const profile = profileQuery.data;
  const branchesQuery = useListBranches({ query: { queryKey: getListBranchesQueryKey() } });
  const branches = branchesQuery.data ?? [];
  const [branchId, setBranchId] = useState<number | null>(null);
  const selectedBranch = branches.find(branch => branch.id === branchId);
  const branchParam = { branchId: branchId ?? 0 };
  const menuQuery = useListMenu(branchParam, { query: { enabled: Boolean(branchId), queryKey: getListMenuQueryKey(branchParam) } });
  const categoriesQuery = useListCategories(branchParam, { query: { enabled: Boolean(branchId), queryKey: getListCategoriesQueryKey(branchParam) } });
  const menu = menuQuery.data ?? [];
  const categoryNames = (categoriesQuery.data ?? []).map(category => category.name);
  const [cart, setCart] = useState<Cart>({});
  const [created, setCreated] = useState<Order | null>(null);
  const queryClient = useQueryClient();
  const signedInCustomer = Boolean(auth.isSignedIn && profile?.role === 'customer');
  const setQuantity = (id: number, delta: number) => setCart(prev => {
    const quantity = Math.max(0, Math.min(50, (prev[id] ?? 0) + delta));
    const copy = { ...prev }; if (!quantity) delete copy[id]; else copy[id] = quantity; return copy;
  });
  const placeOrder = (order: Order) => {
    queryClient.setQueryData(getGetOrderQueryKey(order.id), order);
    void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    setCreated(order);
  };
  if (created) return <section className="success-page page-enter">
    <div className="success-seal"><Check size={35} /></div><span className="eyebrow">SİPARİŞİN MUTFAĞA İLETİLDİ</span>
    <h1>Birazdan<br /><em>görüşürüz.</em></h1><p>{created.customerName}, siparişin özenle hazırlanıyor.</p>
    <div className="success-ticket"><span>SİPARİŞ NUMARAN</span><strong>{created.orderNumber}</strong><small>{money(created.total)} · {selectedBranch?.name ?? created.branchName}</small></div>
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
        <div className="branch-picker">
          <label className="field-label" htmlFor="branch-select"><MapPin size={14} /> Sipariş vereceğin şube</label>
          {branchesQuery.isLoading ? <div className="branch-select-skeleton" /> :
            branchesQuery.isError ? <ErrorState onRetry={() => branchesQuery.refetch()} label="Şubeler şu an yüklenemiyor." /> :
              branches.length === 0 ? <EmptyState title="Şubeler hazırlanıyor" detail="Aktif şubeler burada görünecek." /> :
                <select id="branch-select" className="text-input branch-select" value={branchId ?? ''} onChange={event => { setBranchId(event.target.value ? Number(event.target.value) : null); setCart({}); }} data-testid="select-branch">
                  <option value="">Şube seç</option>{branches.map((branch: Branch) => <option key={branch.id} value={branch.id}>{branch.name} · {branch.address}</option>)}
                </select>}
          {selectedBranch && <p className="selected-branch"><MapPin size={12} /> {selectedBranch.address}</p>}
        </div>
        {!branchId ? <EmptyState title="Önce şubeni seç" detail="Şubeni seçtiğinde o şubenin menüsünü ve güncel fiyatlarını göstereceğiz." /> :
          menuQuery.isLoading ? <LoadingState label="Şubenin menüsü geliyor" /> :
            menuQuery.isError ? <ErrorState onRetry={() => menuQuery.refetch()} label="Menü şu an yüklenemiyor." /> :
              menu.length === 0 ? <EmptyState title="Menü hazırlanıyor" detail="Bu şubede şu an listelenecek ürün yok." /> :
                <MenuList menu={menu} categories={categoryNames} cart={cart} onChange={setQuantity} canOrder={signedInCustomer} />}
        {categoriesQuery.isError && branchId && <p className="inline-error">Kategori bilgisi alınamadı; ürünler kendi kategorilerine göre gösteriliyor.</p>}
      </div>
      <aside className="order-aside">
        {auth.isSignedIn && profileQuery.isLoading ? <LoadingState label="Hesap bilgisi yükleniyor" /> :
          auth.isSignedIn && profileQuery.isError ? <ErrorState onRetry={() => profileQuery.refetch()} label="Müşteri hesabına ulaşılamıyor." /> :
            auth.isSignedIn && profile?.role !== 'customer' ? <div className="order-form"><span className="eyebrow">MÜŞTERİ HESABI</span><h3>Bu alan müşteriler içindir.</h3><p className="order-footnote">Müşteri siparişi için uygun bir hesapla giriş yap.</p></div> :
              <OrderForm branchId={branchId} menu={menu} cart={cart} onCartChange={setQuantity} onSuccess={placeOrder} profileName={profile?.fullName ?? ''} signedIn={signedInCustomer} />}
      </aside>
    </section>
    <section className="closing-note"><span className="eyebrow">CAFÉ VERÜN · SINCE 2022</span><p>İyi şeyler<br /><em>aceleye gelmez.</em></p><span className="closing-rule" /></section>
  </div>;
}

function ProtectedCustomer({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const profileQuery = useGetAuthMe({
    query: { enabled: auth.isLoaded && Boolean(auth.isSignedIn), queryKey: getGetAuthMeQueryKey(), retry: false },
  });
  if (!auth.isLoaded || (auth.isSignedIn && profileQuery.isLoading)) return <div className="protected-page"><LoadingState label="Hesabın doğrulanıyor" /></div>;
  if (!auth.isSignedIn) return <Redirect to="/sign-in" />;
  if (profileQuery.isError) return <div className="protected-page"><ErrorState onRetry={() => profileQuery.refetch()} label="Hesap bilgisine ulaşılamadı." /></div>;
  if (profileQuery.data?.role !== 'customer') return <div className="protected-page"><EmptyState title="Bu sayfa müşteriler içindir" detail="Müşteri hesabınla giriş yaparak siparişlerine ulaşabilirsin." /></div>;
  return <>{children}</>;
}

function CustomerOrdersContent() {
  const [, setLocation] = useLocation();
  const ordersQuery = useListOrders(undefined, { query: { queryKey: getListOrdersQueryKey(), refetchOnWindowFocus: true } });
  const orders = ordersQuery.data ?? [];
  return <section className="orders-page page-enter">
    <Link href="/" className="back-link" data-testid="link-back-menu"><ArrowLeft size={15} /> Menüye dön</Link>
    <div className="orders-heading"><span className="eyebrow">CAFÉ VERÜN · SENİN SİPARİŞLERİN</span><h1>Güzel anlar<br /><em>burada birikir.</em></h1><p>Geçmiş ve devam eden siparişlerin tek yerde.</p></div>
    {ordersQuery.isLoading ? <LoadingState label="Siparişlerin getiriliyor" /> :
      ordersQuery.isError ? <ErrorState onRetry={() => ordersQuery.refetch()} label="Sipariş geçmişin yüklenemedi." /> :
        orders.length === 0 ? <EmptyState title="Henüz siparişin yok" detail="Şubeni seçip ilk kahve molanı oluşturduğunda burada göreceksin." /> :
          <div className="orders-list">{orders.map((order, index) => <article className="order-history-row" key={order.id} data-testid={`order-card-${order.id}`}>
            <div className="history-index">0{index + 1}</div>
            <div className="history-main"><span className="history-number">{order.orderNumber}</span><h2>{order.branchName ?? 'Café Verün'} <span>· {formatTime(order.createdAt)}</span></h2><p>{order.items.map(item => `${item.quantity} × ${item.name}`).join(' · ')}</p></div>
            <div className="history-status"><span className={`status-tag status-${order.status}`}>{statuses[order.status]}</span><strong>{money(order.total)}</strong></div>
            <button className="button button-outline history-action" onClick={() => setLocation(`/track/${order.id}`)} data-testid={`button-order-details-${order.id}`}>Detay <ArrowRight size={14} /></button>
          </article>)}</div>}
  </section>;
}

function CustomerOrders() {
  return <ProtectedCustomer><CustomerOrdersContent /></ProtectedCustomer>;
}

function TrackOrderContent() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const ordersQuery = useListOrders(undefined, { query: { queryKey: getListOrdersQueryKey(), enabled: validId, refetchOnWindowFocus: true } });
  const ownOrder = (ordersQuery.data ?? []).some(order => order.id === id);
  const orderQuery = useGetOrder(validId ? id : 0, {
    query: { enabled: validId && !ordersQuery.isLoading && ownOrder, queryKey: getGetOrderQueryKey(validId ? id : 0), refetchInterval: 5000 },
  });
  const order = orderQuery.data as Order | undefined;
  return <div className="track-page page-enter">
    <Link href="/orders" className="back-link" data-testid="link-back-orders"><ArrowLeft size={15} /> Siparişlerime dön</Link>
    {!validId ? <EmptyState title="Sipariş numarası geçersiz" detail="Siparişlerime dönerek kayıtlarını görebilirsin." /> :
      ordersQuery.isLoading ? <LoadingState label="Siparişlerin doğrulanıyor" /> :
        ordersQuery.isError ? <ErrorState onRetry={() => ordersQuery.refetch()} label="Siparişlerine şu an ulaşılamıyor." /> :
          !ownOrder ? <EmptyState title="Bu sipariş sana ait değil" detail="Yalnızca kendi müşteri siparişlerini görüntüleyebilirsin." /> :
            orderQuery.isLoading ? <LoadingState label="Sipariş bilgisi alınıyor" /> :
              orderQuery.isError ? <ErrorState onRetry={() => orderQuery.refetch()} label="Bu siparişe şu an ulaşılamıyor." /> :
                order ? <div className="track-card">
                  <div className="track-topline"><span className="eyebrow">SİPARİŞ TAKİBİ</span><span className="live-pill"><i /> CANLI</span></div>
                  <p className="track-number">{order.orderNumber}</p><h1>{order.status === 'ready' ? 'Hazır, seni bekliyor.' : order.status === 'completed' ? 'Afiyet olsun.' : 'Güzel şeyler hazırlanıyor.'}</h1>
                  <p className="track-greeting">{order.branchName} · Sipariş durumun burada güncellenir.</p>
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

function TrackOrder() {
  return <ProtectedCustomer><TrackOrderContent /></ProtectedCustomer>;
}

function SignInPage() {
  return <AuthForm mode="sign-in" />;
}
function SignUpPage() {
  return <AuthForm mode="sign-up" />;
}

function ResetPasswordPage() {
  return <AuthForm mode="reset" />;
}

function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' | 'reset' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [, setLocation] = useLocation();
  const title = mode === 'sign-up' ? <>Mahallene<br /><em>katıl.</em></> : mode === 'reset' ? <>Şifreni<br /><em>yenile.</em></> : <>Kahve molana<br /><em>devam et.</em></>;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    setBusy(true);
    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(firebaseAuth, email.trim());
        setMessage('Şifre yenileme bağlantısı e-posta adresine gönderildi.');
      } else if (mode === 'sign-up') {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
        if (fullName.trim()) await updateProfile(credential.user, { displayName: fullName.trim() });
        await sendEmailVerification(credential.user);
        await signOut(firebaseAuth);
        setMessage('Hesabın oluşturuldu. Giriş yapmadan önce e-posta kutundaki doğrulama bağlantısına tıkla. Personelsen, yöneticinin ekip kaydında kullandığı aynı e-posta adresiyle kaydolmalısın.');
      } else {
        const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
        if (!credential.user.emailVerified) {
          await sendEmailVerification(credential.user);
          await signOut(firebaseAuth);
          setMessage('E-posta adresin henüz doğrulanmamış. Yeni bir doğrulama bağlantısı gönderdik; hesabına erişmek için önce e-postanı doğrula.');
          return;
        }
        setLocation('/');
      }
    } catch (cause) {
      const code = (cause as { code?: string }).code ?? '';
      const messages: Record<string, string> = {
        'auth/email-already-in-use': 'Bu e-posta adresiyle bir hesap zaten var. Giriş yapmayı dene.',
        'auth/invalid-email': 'Geçerli bir e-posta adresi yaz.',
        'auth/invalid-credential': 'E-posta veya şifre hatalı.',
        'auth/user-not-found': 'Bu e-posta adresiyle bir hesap bulunamadı.',
        'auth/wrong-password': 'E-posta veya şifre hatalı.',
        'auth/weak-password': 'Şifren en az 6 karakter olmalı.',
        'auth/too-many-requests': 'Çok fazla deneme yapıldı. Biraz bekleyip yeniden dene.',
        'auth/network-request-failed': 'Bağlantı kurulamadı. İnternetini kontrol edip yeniden dene.',
      };
      setError(messages[code] ?? 'İşlem tamamlanamadı. Bilgilerini kontrol edip yeniden dene.');
    } finally {
      setBusy(false);
    }
  };
  const handleGoogleSignIn = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const credential = await signInWithGoogle();
      await credential.user.reload();
      if (!firebaseAuth.currentUser?.emailVerified) {
        if (firebaseAuth.currentUser) await sendEmailVerification(firebaseAuth.currentUser);
        await signOut(firebaseAuth);
        setMessage('Google e-posta adresiniz doğrulanmamış. Doğruladıktan sonra yeniden giriş yapın.');
        return;
      }
      setLocation('/');
    } catch (cause) {
      setError(googleSignInErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return <div className="auth-page">
    <div className="auth-intro">
      <Link href="/" className="back-link"><ArrowLeft size={15} /> Café Verün’e dön</Link>
      <span className="eyebrow">{mode === 'sign-up' ? 'BİR FİNCANLIK YAKINLIK' : mode === 'reset' ? 'HESABINA YENİDEN ULAŞ' : 'MAHALLEMİZDE YERİN HAZIR'}</span>
      <h1>{title}</h1>
      <p>{mode === 'sign-up' ? 'Hesabını oluştur, şubeni seç ve ilk siparişini ver.' : mode === 'reset' ? 'E-posta adresine güvenli bir şifre yenileme bağlantısı gönderelim.' : 'Siparişlerin ve sevdiğin şube burada seni bekliyor.'}</p>
    </div>
    <form className="auth-card" onSubmit={submit}>
      <div className="auth-card-heading"><span className="eyebrow">{mode === 'sign-up' ? 'YENİ MÜŞTERİ HESABI' : mode === 'reset' ? 'ŞİFRE YENİLEME' : 'HESABINA GİRİŞ YAP'}</span><h2>{mode === 'sign-up' ? 'Aramıza hoş geldin.' : mode === 'reset' ? 'Bağlantı gönderelim.' : 'Tekrar hoş geldin.'}</h2></div>
      {mode === 'sign-up' && <><label className="field-label" htmlFor="auth-name">Adın soyadın</label><input id="auth-name" className="text-input" autoComplete="name" value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Ad Soyad" data-testid="input-full-name" /></>}
      <label className="field-label" htmlFor="auth-email">E-posta adresin</label>
      <input id="auth-email" className="text-input" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="ornek@eposta.com" data-testid="input-email" />
      {mode !== 'reset' && <><label className="field-label" htmlFor="auth-password">Şifren</label><input id="auth-password" className="text-input" type="password" required minLength={6} autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="En az 6 karakter" data-testid="input-password" /></>}
      {error && <p className="form-error" role="alert" data-testid="text-auth-error">{error}</p>}
      {message && <div className="auth-message" role="status" data-testid="text-auth-message"><MailCheck size={18} /><span>{message}</span></div>}
      <button className="button button-primary auth-submit" type="submit" disabled={busy} data-testid="button-auth-submit">{busy ? <><LoaderCircle size={15} className="spin" /> İşleniyor</> : mode === 'sign-up' ? 'Hesabını oluştur' : mode === 'reset' ? 'Bağlantı gönder' : 'Giriş yap'}{!busy && <ArrowRight size={15} />}</button>
      {mode !== 'reset' && <button className="mt-3 flex w-full items-center justify-center gap-3 border border-[#d8c8b3] bg-[#fcf9f3] px-3 py-3 text-xs font-semibold text-[#382216] transition hover:bg-[#eee3d0] disabled:opacity-60" type="button" onClick={() => void handleGoogleSignIn()} disabled={busy}><span aria-hidden="true" className="font-bold text-[#4285f4]">G</span> Google ile devam et</button>}
      {mode === 'sign-in' && <Link href="/reset-password" className="auth-secondary-link">Şifremi unuttum</Link>}
      <div className="auth-switch">{mode === 'sign-up' ? <>Zaten hesabın var mı? <Link href="/sign-in">Giriş yap</Link></> : mode === 'reset' ? <>Şifreni hatırladın mı? <Link href="/sign-in">Giriş yap</Link></> : <>Henüz hesabın yok mu? <Link href="/sign-up">Üye ol</Link></>}</div>
    </form>
  </div>;
}

function FirebaseQueryClientCacheInvalidator() {
  const { user, isLoaded } = useAuth();
  const client = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded) return;
    const userId = user?.uid ?? null;
    if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) client.clear();
    prevUserIdRef.current = userId;
  }, [client, isLoaded, user?.uid]);
  return null;
}

function CafeRoutes() {
  return <FirebaseAuthProvider>
    <QueryClientProvider client={queryClient}>
      <FirebaseQueryClientCacheInvalidator />
      <AppShell><Switch>
        <Route path="/" component={CustomerHome} />
        <Route path="/sign-in" component={SignInPage} />
        <Route path="/sign-up" component={SignUpPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route path="/orders" component={CustomerOrders} />
        <Route path="/track/:id" component={TrackOrder} />
        <Route component={NotFound} />
      </Switch></AppShell>
    </QueryClientProvider>
  </FirebaseAuthProvider>;
}

function App() {
  return <WouterRouter base={basePath}><CafeRoutes /></WouterRouter>;
}
export default App;
