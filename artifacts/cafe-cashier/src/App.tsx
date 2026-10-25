import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import {
  ArrowRight, Check, CheckCircle2, Coffee, LockKeyhole, MapPin, Minus, Plus,
  RefreshCw, Search, ShieldAlert, ShoppingBag, Sparkles, Utensils,
} from 'lucide-react';
import {
  getGetAuthMeQueryKey, getGetDashboardSummaryQueryKey, getListCategoriesQueryKey,
  getListMenuQueryKey, getListOrdersQueryKey, useCreateOrder, useGetAuthMe,
  useGetDashboardSummary, useListCategories, useListMenu, useListOrders, useUpdateOrderStatus,
} from '@workspace/api-client-react';
import type { BranchMenuItem, Order, UserProfile } from '@workspace/api-client-react';
import './cashier.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const LOGO = `${basePath}/brand/cafe-verun-logo.png`;
const money = (value: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(value);
const time = (value: string) => new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const dateLabel = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
type Cart = Record<number, number>;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#382216', colorForeground: '#382519', colorMutedForeground: '#806c58',
    colorDanger: '#a04236', colorBackground: '#f8f3ea', colorInput: '#fcf9f3',
    colorInputForeground: '#362418', colorNeutral: '#d7c8b5', fontFamily: 'DM Sans', borderRadius: '3px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#f8f3ea] rounded-sm w-[440px] max-w-full overflow-hidden border border-[#d8c8b3]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#382519] font-display', headerSubtitle: 'text-[#806c58]',
    socialButtonsBlockButtonText: 'text-[#382519]', formFieldLabel: 'text-[#53402e]',
    footerActionLink: 'text-[#75562e]', footerActionText: 'text-[#806c58]', dividerText: 'text-[#806c58]',
    identityPreviewEditButton: 'text-[#75562e]', formFieldSuccessText: 'text-[#526b4b]',
    alertText: 'text-[#873f34]', logoBox: 'mx-auto', logoImage: 'max-h-14 object-contain',
    socialButtonsBlockButton: 'border-[#d7c8b5] bg-[#fcf9f3]', formButtonPrimary: 'bg-[#382216] hover:bg-[#51331f]',
    formFieldInput: 'border-[#d7c8b5] bg-[#fcf9f3] text-[#362418]', footerAction: 'text-[#806c58]',
    dividerLine: 'bg-[#ded3c3]', alert: 'bg-[#f4e6e1]', otpCodeFieldInput: 'border-[#d7c8b5]',
    formFieldRow: 'text-[#53402e]', main: 'text-[#382519]',
  },
};

function LoadingBlock({ label }: { label: string }) {
  return <div className="loading-block" role="status"><span className="skeleton wide" /><span className="skeleton" /><span className="skeleton narrow" /><small>{label}</small></div>;
}

function RetryPanel({ title, retry }: { title: string; retry: () => void }) {
  return <div className="retry-panel"><span className="retry-mark">!</span><strong>{title}</strong><p>Bağlantı kurulamadı. Birazdan yeniden deneyin.</p><button className="quiet-button" onClick={retry}><RefreshCw size={14} /> Yeniden dene</button></div>;
}

function Metric({ label, value, detail, kind = '' }: { label: string; value: string | number; detail: string; kind?: string }) {
  return <article className={`metric ${kind}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function AuthLanding() {
  return <div className="landing-shell">
    <header className="landing-header"><img src={LOGO} alt="Café Verün" /><span>PERSONEL GİRİŞİ</span></header>
    <main className="landing-main">
      <div className="landing-copy">
        <span className="overline">CAFÉ VERÜN <i>/</i> ÖN TEZGÂH</span>
        <h1>Her sipariş,<br /><em>iyi bir başlangıç.</em></h1>
        <p>Şubenizin siparişlerini alın, hazır olanları misafirlerimize ulaştırın. Tezgâh çalışma alanına devam etmek için personel hesabınızla giriş yapın.</p>
        <Link href="/sign-in" className="landing-cta" data-testid="link-staff-sign-in"><LockKeyhole size={16} /> Personel girişi <ArrowRight size={16} /></Link>
        <small className="landing-note">Yalnızca yetkili Café Verün personeli içindir.</small>
      </div>
      <div className="landing-mark"><div className="mark-ring"><Coffee size={45} strokeWidth={1.1} /><span>CV</span></div><p>TEZGAH<br />AÇIK</p></div>
    </main>
    <footer className="landing-footer"><span>© Café Verün · 2022’den beri aynı özen.</span><span>GÜVENLİ PERSONEL ALANI</span></footer>
  </div>;
}

function SignInPage() {
  return <main className="auth-screen">
    <div className="auth-intro"><Link href="/" className="back-link">← Ana sayfaya dön</Link><span className="overline">PERSONEL HESABI</span><h1>Tezgâha<br /><em>hoş geldiniz.</em></h1><p>Giriş bilgileriniz size şube yöneticiniz tarafından iletilmiş olmalı.</p></div>
    <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
  </main>;
}

function SignUpPage() {
  return <main className="auth-screen"><div className="auth-intro"><Link href="/" className="back-link">← Ana sayfaya dön</Link><span className="overline">CAFÉ VERÜN</span><h1>Personel<br /><em>hesabı oluştur.</em></h1></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></main>;
}

function AccessDenied({ profile }: { profile?: UserProfile }) {
  const { signOut } = useClerk();
  return <main className="access-page"><div className="access-card"><span className="access-icon"><ShieldAlert size={25} /></span><span className="overline">ERİŞİM SINIRLI</span><h1>Bu alan size<br /><em>atanmamış.</em></h1><p>Bu çalışma alanı yalnızca kasa personeli içindir. {profile?.role ? `Hesap rolünüz: ${profile.role}.` : ''} Doğru uygulama için yöneticinizle görüşün.</p><button className="landing-cta" onClick={() => signOut({ redirectUrl: basePath || '/' })}>Oturumu kapat <ArrowRight size={16} /></button></div></main>;
}

function OrderComposer({ menu, categories, branchId }: { menu: BranchMenuItem[]; categories: { id: number; name: string }[]; branchId: number }) {
  const [cart, setCart] = useState<Cart>({});
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Tümü');
  const [formError, setFormError] = useState('');
  const [createdNumber, setCreatedNumber] = useState('');
  const queryClient = useQueryClient();
  const create = useCreateOrder();
  const available = menu.filter(row => row.available && row.stockAvailable && row.item.available);
  const categoryNames = useMemo(() => ['Tümü', ...categories.map(value => value.name)], [categories]);
  const visible = available.filter(row => category === 'Tümü' || row.categoryName === category)
    .filter(row => `${row.item.name} ${row.item.description} ${row.item.publicIngredients.join(' ')} ${row.item.allergens.join(' ')}`
      .toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr')));
  const selected = available.filter(row => cart[row.item.id]).map(row => ({ row, quantity: cart[row.item.id] }));
  const total = selected.reduce((sum, line) => sum + line.row.price * line.quantity, 0);
  const change = (id: number, delta: number) => setCart(current => {
    const quantity = Math.max(0, Math.min(50, (current[id] ?? 0) + delta));
    const next = { ...current };
    if (!quantity) delete next[id]; else next[id] = quantity;
    return next;
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) { setFormError('Sipariş için müşteri adını yazın.'); return; }
    if (!selected.length) { setFormError('Devam etmek için menüden ürün seçin.'); return; }
    setFormError('');
    create.mutate({ data: {
      branchId,
      customerName: name.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
      items: selected.map(({ row, quantity }) => ({ menuItemId: row.item.id, quantity })),
    } }, {
      onSuccess: order => {
        setCreatedNumber(order.orderNumber);
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMenuQueryKey({ branchId }) });
        queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey({ branchId }) });
        setName(''); setNote(''); setCart({});
      },
    });
  };
  return <div className="composer-layout">
    <section className="menu-panel" aria-label="Menüden ürün seç">
      <div className="menu-toolbar">
        <div className="search-wrap"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Ürün, içerik veya alerjen ara" aria-label="Menüde ara" data-testid="input-menu-search" /></div>
        <div className="category-tabs" aria-label="Menü kategorileri">{categoryNames.map(value => <button key={value} className={category === value ? 'category-tab selected' : 'category-tab'} onClick={() => setCategory(value)} data-testid={`filter-category-${value}`}>{value}</button>)}</div>
      </div>
      <div className="menu-results">{visible.length === 0 ? <div className="menu-empty"><Coffee size={22} /><strong>{available.length ? 'Aradığınız ürün bulunamadı' : 'Şu an satışta ürün yok'}</strong><span>Başka bir arama ya da kategori deneyin.</span></div> :
        visible.map((row, index) => <MenuRow key={row.item.id} row={row} quantity={cart[row.item.id] ?? 0} change={change} index={index} />)}</div>
    </section>
    <form className="ticket-panel" onSubmit={submit}>
      <div className="ticket-heading"><div><span className="overline">YENİ SİPARİŞ</span><h3>Tezgâh fişi</h3></div><span className="ticket-icon"><ShoppingBag size={17} /></span></div>
      {createdNumber && <div className="cashier-success" role="status" data-testid="status-order-created"><CheckCircle2 size={16} /><span>Sipariş alındı · <b>#{createdNumber}</b></span><button type="button" aria-label="Başarı mesajını kapat" onClick={() => setCreatedNumber('')}>×</button></div>}
      <label className="field-label" htmlFor="guest-name">Müşteri adı</label><input id="guest-name" className="form-input" value={name} onChange={event => setName(event.target.value)} placeholder="Örn. Deniz" maxLength={120} autoComplete="off" data-testid="input-cashier-name" />
      <div className="ticket-lines"><div className="ticket-lines-heading"><span>SEÇİLENLER</span><span>{selected.length} ürün çeşidi</span></div>
        {selected.length ? selected.map(({ row, quantity }) => <div className="ticket-line" key={row.item.id}><div><strong>{quantity} × {row.item.name}</strong><small>{money(row.price)} / adet</small></div><span>{money(row.price * quantity)}</span><button type="button" className="line-remove" aria-label={`${row.item.name} azalt`} onClick={() => change(row.item.id, -1)}><Minus size={13} /></button></div>) :
          <div className="ticket-empty"><span className="empty-ring"><Utensils size={18} /></span><p>Menüden ürün ekleyin.<br />Fişiniz burada oluşacak.</p></div>}
      </div>
      <label className="field-label note-label" htmlFor="order-note">Sipariş notu <span>İSTEĞE BAĞLI</span></label><textarea id="order-note" className="form-input note-field" value={note} onChange={event => setNote(event.target.value)} placeholder="Paket notu, servis tercihi..." maxLength={500} data-testid="input-cashier-note" />
      {formError && <p className="form-error" role="alert">{formError}</p>}
      {create.isError && <p className="form-error" role="alert">Sipariş kaydedilemedi. Bilgileriniz duruyor; yeniden deneyin.</p>}
      <div className="ticket-total"><span>Toplam</span><strong>{money(total)}</strong></div>
      <button className="send-order" type="submit" disabled={create.isPending || !available.length} data-testid="button-cashier-submit">{create.isPending ? 'Kaydediliyor…' : 'Mutfağa gönder'} <ArrowRight size={16} /></button>
      <p className="ticket-footnote">Sipariş mutfak ekranına iletilir.</p>
    </form>
  </div>;
}

function MenuRow({ row, quantity, change, index }: { row: BranchMenuItem; quantity: number; change: (id: number, delta: number) => void; index: number }) {
  const item = row.item;
  return <article className="menu-row" style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }} data-testid={`menu-item-${item.id}`}>
    <div className="menu-item-info"><span className="menu-category-label">{row.categoryName}</span><h4>{item.name}</h4>{item.description && <p>{item.description}</p>}
      {(item.publicIngredients.length > 0 || item.allergens.length > 0) && <div className="food-details">
        {item.publicIngredients.length > 0 && <span><b>İçindekiler:</b> {item.publicIngredients.join(', ')}</span>}
        {item.allergens.length > 0 && <span><b>Alerjen:</b> {item.allergens.join(', ')}</span>}
      </div>}
    </div>
    <div className="menu-item-action"><strong>{money(row.price)}</strong>{quantity > 0 ? <div className="quantity-stepper"><button type="button" onClick={() => change(item.id, -1)} aria-label={`${item.name} azalt`} data-testid={`button-minus-${item.id}`}><Minus size={14} /></button><span>{quantity}</span><button type="button" onClick={() => change(item.id, 1)} aria-label={`${item.name} artır`} data-testid={`button-plus-${item.id}`}><Plus size={14} /></button></div> : <button type="button" className="add-product" onClick={() => change(item.id, 1)} data-testid={`button-add-${item.id}`}><Plus size={14} /> Ekle</button>}</div>
  </article>;
}

function OrderHistory({ orders, loading, error, retry }: { orders: Order[]; loading: boolean; error: boolean; retry: () => void }) {
  return <section className="history-section"><div className="section-title"><div><span className="overline">SON TESLİMATLAR</span><h2>Tamamlananlar</h2></div><span className="history-caption">ŞUBE SİPARİŞ GEÇMİŞİ</span></div>
    {loading ? <LoadingBlock label="Teslim geçmişi alınıyor" /> : error ? <RetryPanel title="Geçmiş yüklenemedi" retry={retry} /> : orders.length === 0 ?
      <div className="handoff-empty"><span><Check size={17} /></span><div><strong>Henüz tamamlanan sipariş yok</strong><small>Teslim ettiğiniz siparişler burada listelenir.</small></div></div> :
      <div className="history-list">{orders.slice(0, 8).map(order => <article className="history-row" key={order.id} data-testid={`history-order-${order.id}`}><span className="history-number">#{order.orderNumber}</span><strong>{order.customerName}</strong><span>{order.items.reduce((sum, item) => sum + item.quantity, 0)} ürün</span><time>{time(order.updatedAt)}</time><b>{money(order.total)}</b></article>)}</div>}
  </section>;
}

function HandoffQueue() {
  const queryClient = useQueryClient();
  const orders = useListOrders({ status: 'ready' }, { query: { queryKey: getListOrdersQueryKey({ status: 'ready' }), refetchInterval: 5000 } });
  const history = useListOrders({ status: 'completed' }, { query: { queryKey: getListOrdersQueryKey({ status: 'completed' }), refetchInterval: 5000 } });
  const update = useUpdateOrderStatus();
  const ready = [...(orders.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const handoff = (order: Order) => update.mutate({ id: order.id, data: { status: 'completed' } }, { onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  } });
  return <>
    <section className="handoff-section"><div className="section-title"><div><span className="overline">TEZGAHIN DİĞER TARAFI</span><h2>Teslim sırası <span className="count-pill">{ready.length.toString().padStart(2, '0')}</span></h2></div><span className="live-indicator"><i /> Canlı · 5 sn</span></div>
      {update.isError && <div className="handoff-error" role="alert">Teslim durumu güncellenemedi. Yeniden deneyin.</div>}
      {orders.isLoading ? <LoadingBlock label="Hazır siparişler alınıyor" /> : orders.isError ? <RetryPanel title="Teslim sırası yüklenemedi" retry={() => orders.refetch()} /> :
        ready.length === 0 ? <div className="handoff-empty"><span><Check size={17} /></span><div><strong>Şu an teslim bekleyen yok</strong><small>Hazır siparişler burada görünür.</small></div></div> :
        <div className="handoff-list">{ready.map(order => <article className="handoff-card" key={order.id} data-testid={`card-order-${order.id}`}>
          <div className="handoff-card-head"><span className="order-number">#{order.orderNumber}</span><span className="ready-badge"><i /> Teslim alınabilir</span></div>
          <div className="handoff-customer"><h3>{order.customerName}</h3><span>{time(order.createdAt)} <b /> {order.source === 'cashier' ? 'Tezgâh siparişi' : 'Online sipariş'}</span></div>
          <div className="handoff-items">{order.items.map(line => <div className="handoff-line" key={line.id}><span><b>{line.quantity}×</b> {line.name}</span><strong>{money(line.lineTotal)}</strong></div>)}</div>
          {order.note && <p className="handoff-note"><span>NOT</span>{order.note}</p>}
          <div className="handoff-card-bottom"><strong>{money(order.total)}</strong><button className="complete-button" onClick={() => handoff(order)} disabled={update.isPending} data-testid={`button-handoff-${order.id}`}>{update.isPending ? 'İşleniyor…' : <><CheckCircle2 size={15} /> Teslim edildi</>}</button></div>
        </article>)}</div>}
    </section>
    <OrderHistory orders={history.data ?? []} loading={history.isLoading} error={history.isError} retry={() => history.refetch()} />
  </>;
}

function CashierWorkspace({ profile }: { profile: UserProfile }) {
  const { signOut } = useClerk();
  const branchId = profile.branchId;
  const menu = useListMenu({ branchId: branchId ?? 1 }, { query: { queryKey: getListMenuQueryKey({ branchId: branchId ?? 1 }), enabled: branchId !== null, refetchInterval: 30000 } });
  const categories = useListCategories({ branchId: branchId ?? 1 }, { query: { queryKey: getListCategoriesQueryKey({ branchId: branchId ?? 1 }), enabled: branchId !== null } });
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 8000 } });
  return <div className="cashier-app">
    <header className="workspace-header"><div className="brand"><img src={LOGO} alt="Café Verün" /><span className="brand-divider" /><div><b>Ön tezgâh</b><small>KASA ÇALIŞMA ALANI</small></div></div>
      <div className="header-right"><span className="open-status"><i /> SERVİS AÇIK</span><span className="header-date">{dateLabel}</span><button className="signout-button" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out">Çıkış</button></div>
    </header>
    <main className="workspace-main">
      <div className="welcome-row"><div><span className="overline">CAFÉ VERÜN <span className="overline-divider">/</span> GÜNLÜK AKIŞ</span><h1>Merhaba, <em>tezgâh hazır.</em></h1><p>Yeni siparişleri alın, hazır olanları güvenle teslim edin.</p></div>
        <div className="staff-ident"><span className="staff-avatar">{profile.fullName.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toLocaleUpperCase('tr')}</span><span><b>{profile.fullName}</b><small>PERSONEL KODU · <strong data-testid="text-staff-code">{profile.staffCode || '—'}</strong></small></span></div>
      </div>
      <div className="branch-lock"><MapPin size={15} /><span>Atandığınız şube</span><strong>{profile.branchName || `Şube ${branchId ?? ''}`}</strong><small>Şube değişikliği yönetici tarafından yapılır.</small></div>
      {summary.isLoading ? <div className="metrics-loading"><LoadingBlock label="Günün özeti hazırlanıyor" /></div> : summary.isError ? <div className="summary-error"><RetryPanel title="Günlük özet alınamadı" retry={() => summary.refetch()} /></div> :
        summary.data && <section className="metrics" aria-label="Günlük özet"><Metric label="Bekleyen" value={summary.data.pending} detail="mutfak sırasına alındı" /><Metric label="Hazırlanıyor" value={summary.data.preparing} detail="mutfakta çalışılıyor" /><Metric label="Hazır" value={summary.data.ready} detail="teslim noktasında" kind="metric-ready" /><Metric label="Bugün tamamlanan" value={summary.data.completedToday} detail="sipariş teslim edildi" /><Metric label="Günlük ciro" value={money(summary.data.revenueToday)} detail="tamamlanan siparişler" kind="metric-revenue" /></section>}
      <div className="section-title composer-title"><div><span className="overline">MAĞAZA İÇİ SİPARİŞ</span><h2>Sipariş oluştur</h2></div><span className="source-tag"><Coffee size={14} /> Tezgâhtan</span></div>
      {branchId === null ? <div className="no-menu"><MapPin size={23} /><strong>Şube ataması bulunamadı</strong><span>Çalışma alanı için yöneticinizden şube ataması isteyin.</span></div> :
        menu.isLoading || categories.isLoading ? <LoadingBlock label="Şube menüsü yükleniyor" /> :
          menu.isError ? <RetryPanel title="Menü yüklenemedi" retry={() => menu.refetch()} /> :
            categories.isError ? <RetryPanel title="Kategoriler yüklenemedi" retry={() => categories.refetch()} /> :
              !menu.data?.length ? <div className="no-menu"><Coffee size={23} /><strong>Menü henüz hazır değil</strong><span>Ürünler erişilebilir olduğunda burada görünecek.</span><button className="quiet-button" onClick={() => menu.refetch()}><RefreshCw size={14} /> Yenile</button></div> :
                <OrderComposer menu={menu.data} categories={categories.data ?? []} branchId={branchId} />}
      <HandoffQueue />
    </main>
    <footer className="workspace-footer"><span>© Café Verün · Her fincanda tanıdık bir sıcaklık.</span><span className="footer-live"><i /> Sipariş akışı güncel</span></footer>
  </div>;
}

function Home() {
  const auth = useAuth();
  const profileQuery = useGetAuthMe({ query: { queryKey: getGetAuthMeQueryKey(), enabled: !!auth.isSignedIn } });
  if (!auth.isLoaded) return <div className="auth-loading"><LoadingBlock label="Personel oturumu doğrulanıyor" /></div>;
  if (!auth.isSignedIn) return <AuthLanding />;
  if (profileQuery.isLoading) return <div className="auth-loading"><LoadingBlock label="Personel bilgileriniz yükleniyor" /></div>;
  if (profileQuery.isError) return <main className="profile-error"><RetryPanel title="Personel bilgisi alınamadı" retry={() => profileQuery.refetch()} /></main>;
  const profile = profileQuery.data;
  if (!profile || profile.role !== 'cashier' || !profile.active) return <AccessDenied profile={profile} />;
  return <CashierWorkspace profile={profile} />;
}

function ClerkCacheInvalidator() {
  const { addListener } = useClerk();
  const cache = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const userId = user?.id ?? null;
    if (previousUserId.current !== undefined && previousUserId.current !== userId) cache.clear();
    previousUserId.current = userId;
  }), [addListener, cache]);
  return null;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Personel girişi', subtitle: 'Café Verün tezgâh alanına erişin' } }, signUp: { start: { title: 'Personel hesabı', subtitle: 'Café Verün ekibine katılın' } } }}
    routerPush={to => setLocation(stripBase(to))} routerReplace={to => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><ClerkCacheInvalidator /><Switch>
      <Route path="/" component={Home} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route><Home /></Route>
    </Switch></QueryClientProvider>
  </ClerkProvider>;
}

function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  return <WouterRouter base={basePath}><ClerkRoutes /></WouterRouter>;
}

export default App;
