import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Route, Switch, Link, useLocation, Router as WouterRouter } from 'wouter';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, Check, ChevronRight, CircleDollarSign,
  Coffee, History, LayoutDashboard, LogOut, PackagePlus, Plus, RefreshCw, ShieldAlert,
  ShoppingBag, SlidersHorizontal, Trash2, Users, X,
} from 'lucide-react';
import {
  getGetAuthMeQueryKey, getGetManagerOverviewQueryKey, getListManagerMenuQueryKey,
  getListCategoriesQueryKey, getListManagerInventoryQueryKey,
  getListManagerInventoryTransactionsQueryKey, getListManagerStaffQueryKey,
  useGetAuthMe, useGetManagerOverview, useListManagerMenu, useUpdateManagerMenu,
  useRemoveManagerMenuItem, useCreateManagerCategory, useListCategories,
  useListManagerInventory, useListManagerInventoryTransactions,
  useCreateManagerInventoryTransaction,
  useListManagerStaff,
} from '@workspace/api-client-react';
import type { BranchMenuItem, InventoryRecord, InventoryTransactionInputType } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 20_000, refetchInterval: 60_000, refetchOnWindowFocus: true } },
});

const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#382216', colorForeground: '#382419', colorMutedForeground: '#806c58',
    colorDanger: '#a04236', colorBackground: '#f8f3ea', colorInput: '#fcf9f3',
    colorInputForeground: '#362418', colorNeutral: '#d7c8b5', fontFamily: 'DM Sans',
    borderRadius: '3px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#f8f3ea] rounded-[3px] w-[440px] max-w-full overflow-hidden border border-[#d8c8b3]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#382419] font-serif', headerSubtitle: 'text-[#806c58]',
    socialButtonsBlockButtonText: 'text-[#49321f]', formFieldLabel: 'text-[#59432d]',
    footerActionLink: 'text-[#75552f]', footerActionText: 'text-[#806c58]',
    dividerText: 'text-[#806c58]', identityPreviewEditButton: 'text-[#75552f]',
    formFieldSuccessText: 'text-[#55704f]', alertText: 'text-[#774f3a]',
    logoBox: 'rounded-sm', logoImage: 'object-contain', socialButtonsBlockButton: 'border-[#d7c8b5]',
    formButtonPrimary: 'bg-[#382216] hover:bg-[#51331f] text-[#f5ecdd]',
    formFieldInput: 'bg-[#fcf9f3] border-[#d7c8b5] text-[#362418]',
    footerAction: 'text-[#806c58]', dividerLine: 'bg-[#ded3c3]', alert: 'bg-[#f8ece6]',
    otpCodeFieldInput: 'bg-[#fcf9f3]', formFieldRow: 'text-[#59432d]', main: 'text-[#382419]',
  },
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(amount);
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('tr-TR') ?? '').join('');
}

function SignInLanding() {
  const [, setLocation] = useLocation();
  return <main className="sign-in-page">
    <section className="sign-in-story">
      <img className="sign-in-brand" src={`${basePath}/brand/cafe-verun-logo.png`} alt="Café Verün" />
      <div>
        <div className="eyebrow">ŞUBE OPERASYONLARI · 2024</div>
        <h1>Her şey<br />yerli <em>yerinde.</em></h1>
        <p>Şubenizin günlük ritmini, stoklarını ve menüsünü tek bir yerde yönetin.</p>
      </div>
      <div className="sign-in-foot">CAFÉ VERÜN / ŞUBE SORUMLUSU</div>
    </section>
    <section className="sign-in-form">
      <div className="signin-inner">
        <div className="signin-kicker">PERSONEL ERİŞİMİ</div>
        <h2>İyi ki geldiniz.</h2>
        <p>Şube yönetim paneline devam etmek için oturum açın.</p>
        <button className="btn btn-primary" data-testid="button-open-signin" onClick={() => setLocation('/sign-in')}>
          Personel girişi <ChevronRight size={15} />
        </button>
        <div style={{ marginTop: 24, color: '#9a866f', fontSize: 10, lineHeight: 1.7 }}>
          Yalnızca yetkili şube sorumluları erişebilir. Hesap erişimi için Café Verün yöneticinizle görüşün.
        </div>
      </div>
    </section>
  </main>;
}

function SignInPage() {
  return <div className="sign-in-page">
    <section className="sign-in-story">
      <img className="sign-in-brand" src={`${basePath}/brand/cafe-verun-logo.png`} alt="Café Verün" />
      <div><div className="eyebrow">PERSONEL PORTALI</div><h1>Şubeniz,<br /><em>kontrolünüzde.</em></h1><p>Günlük operasyonlarınıza güvenle devam edin.</p></div>
      <div className="sign-in-foot">CAFÉ VERÜN / ŞUBE SORUMLUSU</div>
    </section>
    <section className="sign-in-form"><div className="signin-inner">
      <div className="signin-kicker">GÜVENLİ PERSONEL GİRİŞİ</div>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div></section>
  </div>;
}
function SignUpPage() {
  return <div className="sign-in-form"><div className="signin-inner"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></div>;
}

function AccessDenied() {
  const { signOut } = useClerk();
  return <main className="access-denied"><section className="access-card">
    <ShieldAlert size={34} strokeWidth={1.4} color="#9b5948" />
    <div className="eyebrow" style={{ marginTop: 18 }}>ERİŞİM SINIRLI</div>
    <h1>Bu alan size açık değil.</h1>
    <p>Şube sorumlusu paneline yalnızca bu role atanmış personel erişebilir. Yetkiniz olduğunu düşünüyorsanız sistem yöneticinizle görüşün.</p>
    <button className="btn" data-testid="button-denied-signout" onClick={() => signOut({ redirectUrl: basePath || '/' })}><LogOut size={14} /> Oturumu kapat</button>
  </section></main>;
}

function LoadingScreen() {
  return <div className="access-denied"><div style={{ width: 'min(520px,90vw)' }}><div className="skeleton" /><div className="skeleton" style={{ height: 34, marginTop: 12, width: '65%' }} /></div></div>;
}

function QueryError({ onRetry }: { onRetry: () => void }) {
  return <div className="error-box" role="alert"><div><strong>Bilgiler yüklenemedi</strong><p>Bağlantıyı kontrol edip yeniden deneyin.</p></div><button className="btn btn-small" onClick={onRetry}><RefreshCw size={13} /> Yenile</button></div>;
}

function Sidebar({ name, email, branchName }: { name: string; email: string; branchName: string }) {
  const { signOut } = useClerk();
  const [location] = useLocation();
  const nav = [
    { href: '/', label: 'Genel Bakış', icon: LayoutDashboard },
    { href: '/inventory', label: 'Stok Yönetimi', icon: Boxes },
    { href: '/menu', label: 'Şube Menüsü', icon: Coffee },
    { href: '/staff', label: 'Ekip', icon: Users },
  ];
  return <aside className="sidebar">
    <Link href="/" className="brand"><img src={`${basePath}/brand/cafe-verun-logo.png`} alt="" /><span><span className="brand-name">Café Verün</span><span className="brand-sub">Şube yönetimi</span></span></Link>
    <div className="branch-chip"><small>Atanmış şube</small><strong data-testid="text-assigned-branch">{branchName}</strong></div>
    <div className="nav-label">Çalışma alanı</div>
    <nav className="nav-items">{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-${label.toLocaleLowerCase('tr-TR').replaceAll(' ', '-')}`} className={`nav-link ${location === href ? 'active' : ''}`}><Icon size={16} strokeWidth={1.7} />{label}</Link>)}</nav>
    <div className="side-bottom">
      <div className="user-mini" data-testid="text-manager-name">{name}</div><div className="user-email">{email}</div>
      <button className="signout" data-testid="button-signout" onClick={() => signOut({ redirectUrl: basePath || '/' })}><LogOut size={14} /> Oturumu kapat</button>
    </div>
  </aside>;
}

function ManagerLayout({ children, name, email, branchName }: { children: ReactNode; name: string; email: string; branchName: string }) {
  const [location] = useLocation();
  const label = location === '/' ? 'Operasyon özeti' : location === '/inventory' ? 'Stok ve hareketler' : location === '/menu' ? 'Menü düzeni' : 'Şube ekibi';
  return <div className="shell grain"><Sidebar name={name} email={email} branchName={branchName} /><div className="main">
    <header className="topbar"><div className="topbar-label">{label}</div><div className="topbar-user"><span className="avatar">{initials(name)}</span><span>{name}</span></div></header>
    {children}
  </div></div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function OverviewPage() {
  const query = useGetManagerOverview({ query: { queryKey: getGetManagerOverviewQueryKey(), staleTime: 20_000, refetchInterval: 45_000 } });
  if (query.isLoading) return <main className="content page-enter"><PageHeading eyebrow="BUGÜNÜN AKIŞI" title="Genel Bakış" description="Şubenizin operasyon görünümü." /><div className="stats-grid">{[1, 2, 3, 4].map((n) => <div className="skeleton" key={n} />)}</div></main>;
  if (query.isError || !query.data) return <main className="content"><QueryError onRetry={() => void query.refetch()} /></main>;
  const overview = query.data;
  const stats = [
    ['Bekleyen', overview.pendingOrders, 'Yeni siparişler'],
    ['Hazırlanıyor', overview.preparingOrders, 'Mutfak akışında'],
    ['Hazır', overview.readyOrders, 'Teslim alınabilir'],
    ['Bugün tamamlanan', overview.completedToday, 'Günlük kapanan'],
  ];
  return <main className="content page-enter">
    <PageHeading eyebrow="BUGÜNÜN AKIŞI" title="Genel Bakış" description={`${overview.branch.name} şubenizin günlük operasyon özeti.`} />
    <section className="stats-grid">{stats.map(([label, value, note]) => <article className="stat" key={label}><div className="stat-label">{label}</div><div className="stat-value" data-testid={`metric-${String(label).toLocaleLowerCase('tr-TR').replaceAll(' ', '-')}`}>{value}</div><div className="stat-note">{note}</div></article>)}</section>
    <div className="overview-grid">
      <section className="panel">
        <div className="panel-head"><div><h2>Sipariş akışı</h2><p>Anlık durum özeti</p></div><ShoppingBag size={18} color="#98784d" /></div>
        <div className="order-stages">
          <div className="stage"><strong>{overview.pendingOrders}</strong><span>Bekliyor</span></div>
          <div className="stage"><strong>{overview.preparingOrders}</strong><span>Hazırlanıyor</span></div>
          <div className="stage"><strong>{overview.readyOrders}</strong><span>Hazır</span></div>
        </div>
        <div className="today-row"><span><CircleDollarSign size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Bugünkü ciro</span><strong>{formatCurrency(overview.revenueToday)}</strong></div>
        <div className="today-row" style={{ borderTop: 0, paddingTop: 0 }}><span>Bugün tamamlanan</span><strong>{overview.completedToday} sipariş</strong></div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Stok uyarıları</h2><p>Eşik seviyesinin altındaki malzemeler</p></div><span className="pill"><AlertTriangle size={12} style={{ marginRight: 5 }} />{overview.lowStockCount} kritik</span></div>
        {overview.lowStockItems.length ? <div className="stock-list">{overview.lowStockItems.map((item) => <StockAlert key={item.id} item={item} />)}</div> : <div className="empty"><Check size={19} /><strong>Stoklar yerinde</strong><span>Şu an düşük stok uyarısı yok.</span></div>}
        {overview.lowStockItems.length > 0 && <div style={{ padding: '0 20px 17px' }}><Link href="/inventory" className="btn btn-small">Stokları incele <ChevronRight size={13} /></Link></div>}
      </section>
    </div>
  </main>;
}

function StockAlert({ item }: { item: InventoryRecord }) {
  return <div className="stock-row"><div><div className="stock-name">{item.name}</div><div className="stock-meta">Eşik {item.lowStockThreshold} {item.unit}</div></div><div className="stock-count">{item.quantity} {item.unit}</div></div>;
}

function InventoryPage() {
  const client = useQueryClient();
  const inventory = useListManagerInventory({ query: { queryKey: getListManagerInventoryQueryKey(), staleTime: 15_000, refetchInterval: 45_000 } });
  const txParams = { limit: 60 };
  const transactions = useListManagerInventoryTransactions(txParams, { query: { queryKey: getListManagerInventoryTransactionsQueryKey(txParams), staleTime: 15_000, refetchInterval: 45_000 } });
  const createTransaction = useCreateManagerInventoryTransaction();
  const [ingredientId, setIngredientId] = useState('');
  const [type, setType] = useState<InventoryTransactionInputType>('restock');
  const [quantity, setQuantity] = useState('');
  const [threshold, setThreshold] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    const ingredient = Number(ingredientId), amount = Number(quantity);
    if (!ingredient || !amount || amount < 0) { setError('Malzeme ve geçerli miktar bilgisi girin.'); return; }
    createTransaction.mutate({ data: { ingredientId: ingredient, type, quantity: amount, note, ...(threshold !== '' ? { lowStockThreshold: Number(threshold) } : {}) } }, {
      onSuccess: async () => {
        await Promise.all([
          client.invalidateQueries({ queryKey: getListManagerInventoryQueryKey() }),
          client.invalidateQueries({ queryKey: getListManagerInventoryTransactionsQueryKey(txParams) }),
          client.invalidateQueries({ queryKey: getGetManagerOverviewQueryKey() }),
        ]);
        setQuantity(''); setThreshold(''); setNote('');
      },
      onError: () => setError('Stok hareketi kaydedilemedi. Bilgileri kontrol edip tekrar deneyin.'),
    });
  };
  return <main className="content page-enter">
    <PageHeading eyebrow="DEPO & TEDARİK" title="Stok Yönetimi" description="Şubenizin malzeme seviyelerini, stok hareketlerini ve uyarı eşiklerini yönetin." />
    {error && <div className="error-box" style={{ marginBottom: 16 }} role="alert"><span>{error}</span><button className="btn btn-small" onClick={() => setError('')}><X size={13} /> Kapat</button></div>}
    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-head"><div><h2>Stok hareketi kaydet</h2><p>Alım, fire veya sayım düzeltmesi girin.</p></div><PackagePlus size={18} color="#98784d" /></div>
      {inventory.isLoading ? <div className="skeleton" /> : inventory.isError ? <div style={{ padding: 18 }}><QueryError onRetry={() => void inventory.refetch()} /></div> : !inventory.data?.length ? <div className="empty"><Boxes size={20} /><strong>Henüz stok kaydı yok</strong><span>Şubenize tanımlı malzemeler burada görünür.</span></div> : <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field"><label htmlFor="ingredient">Malzeme</label><select id="ingredient" className="select" required value={ingredientId} onChange={(e) => { setIngredientId(e.target.value); const chosen = inventory.data?.find((i) => i.ingredientId === Number(e.target.value)); setThreshold(chosen ? String(chosen.lowStockThreshold) : ''); }}><option value="">Malzeme seçin</option>{inventory.data.map((item) => <option value={item.ingredientId} key={item.id}>{item.name} · {item.quantity} {item.unit}</option>)}</select></div>
          <div className="field"><label htmlFor="transaction-type">Hareket türü</label><select id="transaction-type" className="select" value={type} onChange={(e) => setType(e.target.value as InventoryTransactionInputType)}><option value="restock">Stok girişi</option><option value="waste">Fire / zayi</option><option value="adjustment">Sayım düzeltmesi</option></select></div>
          <div className="field"><label htmlFor="quantity">{type === 'restock' ? 'Eklenecek miktar' : type === 'waste' ? 'Fire miktarı' : 'Düzeltme miktarı'}</label><input id="quantity" type="number" min="0.001" step="any" className="input" placeholder="0,00" required value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
          <div className="field"><label htmlFor="threshold">Düşük stok eşiği</label><input id="threshold" type="number" min="0" step="any" className="input" placeholder="Değiştirmeyecekseniz boş bırakın" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="transaction-note">Not <span style={{ color: '#9a866f', fontWeight: 400 }}>(isteğe bağlı)</span></label><input id="transaction-note" maxLength={300} className="input" placeholder="Örn. Sabah teslimatı, günlük sayım…" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <div className="form-actions"><button className="btn btn-primary" data-testid="button-record-transaction" disabled={createTransaction.isPending}><Plus size={14} />{createTransaction.isPending ? 'Kaydediliyor…' : 'Hareketi kaydet'}</button></div>
      </form>}
    </section>
    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-head"><div><h2>Mevcut stok</h2><p>Düşük stok eşiklerini satır üzerinden güncelleyebilirsiniz.</p></div><SlidersHorizontal size={17} color="#98784d" /></div>
      {inventory.isLoading ? <div className="skeleton" /> : inventory.isError ? <div style={{ padding: 18 }}><QueryError onRetry={() => void inventory.refetch()} /></div> : !inventory.data?.length ? <EmptyList label="Stok bilgisi yok" detail="Tanımlı şube malzemeleri göründüğünde burada listelenecek." /> : <div className="table-wrap"><table><thead><tr><th>Malzeme</th><th>Mevcut</th><th>Durum</th><th>Düşük stok eşiği</th><th>Son güncelleme</th></tr></thead><tbody>{inventory.data.map((item) => <tr key={item.id} data-testid={`row-inventory-${item.id}`}><td className="td-strong">{item.name}</td><td>{item.quantity} {item.unit}</td><td><span className="pill" style={item.isLow ? { color: '#9b4c3e', background: '#f5e4de' } : { color: '#55704f', background: '#e7eddf' }}>{item.isLow ? 'Düşük' : 'Yeterli'}</span></td><td>{item.lowStockThreshold} {item.unit}</td><td>{formatDate(item.updatedAt)}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Hareket geçmişi</h2><p>Son stok kayıtları · güncelden eskiye</p></div><History size={17} color="#98784d" /></div>
      {transactions.isLoading ? <div className="skeleton" /> : transactions.isError ? <div style={{ padding: 18 }}><QueryError onRetry={() => void transactions.refetch()} /></div> : !transactions.data?.length ? <EmptyList label="Henüz hareket yok" detail="Kaydedilen stok girişleri ve düzeltmeler burada görünür." /> : <div className="table-wrap"><table><thead><tr><th>Zaman</th><th>Malzeme</th><th>Hareket</th><th>Miktar</th><th>Kaydeden</th><th>Not</th></tr></thead><tbody>{transactions.data.map((tx) => <tr key={tx.id} data-testid={`row-transaction-${tx.id}`}><td>{formatDate(tx.createdAt)}</td><td className="td-strong">{tx.ingredientName}</td><td>{tx.type === 'restock' ? 'Stok girişi' : tx.type === 'waste' ? 'Fire' : tx.type === 'adjustment' ? 'Düzeltme' : 'Sipariş kullanımı'}</td><td><span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', color: tx.quantityDelta < 0 ? '#9b4c3e' : '#55704f' }}>{tx.quantityDelta < 0 ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{Math.abs(tx.quantityDelta)} {tx.unit}</span></td><td>{tx.actorName}</td><td>{tx.note || '—'}</td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}

function EmptyList({ label, detail }: { label: string; detail: string }) {
  return <div className="empty"><strong>{label}</strong><span>{detail}</span></div>;
}

function MenuPage() {
  const client = useQueryClient();
  const menu = useListManagerMenu({ query: { queryKey: getListManagerMenuQueryKey(), staleTime: 20_000, refetchInterval: 60_000 } });
  const overview = useGetManagerOverview({ query: { queryKey: getGetManagerOverviewQueryKey(), staleTime: 20_000 } });
  const categoriesQuery = useListCategories({ branchId: overview.data?.branch.id ?? 1 }, { query: { queryKey: getListCategoriesQueryKey({ branchId: overview.data?.branch.id ?? 1 }), enabled: !!overview.data?.branch.id, staleTime: 30_000, refetchInterval: 60_000 } });
  const updateMenu = useUpdateManagerMenu();
  const removeItem = useRemoveManagerMenuItem();
  const createCategory = useCreateManagerCategory();
  const [categoryName, setCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editAvailable, setEditAvailable] = useState(true);
  const [notice, setNotice] = useState('');
  const invalidateMenu = async () => Promise.all([
    client.invalidateQueries({ queryKey: getListManagerMenuQueryKey() }),
    client.invalidateQueries({ queryKey: getListCategoriesQueryKey({ branchId: overview.data?.branch.id ?? 1 }) }),
  ]);
  const addProduct = (productId: number) => {
    const product = menu.data?.availableProducts.find((item) => item.id === productId);
    if (!product) return;
    updateMenu.mutate({ menuItemId: product.id, data: { available: true, price: product.price, categoryId: null } }, { onSuccess: () => { void invalidateMenu(); setNotice(`${product.name} menünüze eklendi.`); }, onError: () => setNotice('Ürün menüye eklenemedi.') });
  };
  const saveItem = (item: BranchMenuItem) => {
    updateMenu.mutate({ menuItemId: item.item.id, data: { available: editAvailable, price: Number(editPrice), categoryId: editCategory === 'none' ? null : Number(editCategory) } }, { onSuccess: () => { void invalidateMenu(); setEditingId(null); setNotice('Menü ayarları kaydedildi.'); }, onError: () => setNotice('Menü ayarları kaydedilemedi.') });
  };
  const createLocalCategory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setCategoryError('');
    if (categoryName.trim().length < 2) { setCategoryError('Kategori adı en az 2 karakter olmalı.'); return; }
    createCategory.mutate({ data: { name: categoryName.trim() } }, { onSuccess: async () => { setCategoryName(''); await client.invalidateQueries({ queryKey: getListCategoriesQueryKey({ branchId: overview.data?.branch.id ?? 1 }) }); }, onError: () => setCategoryError('Kategori oluşturulamadı.') });
  };
  const removeProduct = (item: BranchMenuItem) => {
    if (!window.confirm(`${item.item.name} ürününü bu şubenin menüsünden kaldırmak istiyor musunuz?`)) return;
    removeItem.mutate({ menuItemId: item.item.id }, { onSuccess: () => { void invalidateMenu(); setNotice('Ürün şube menüsünden kaldırıldı.'); }, onError: () => setNotice('Ürün kaldırılamadı.') });
  };
  if (menu.isLoading) return <main className="content"><PageHeading eyebrow="ÜRÜN DÜZENİ" title="Şube Menüsü" description="Şubenizde sunulan ürünleri yönetin." /><div className="skeleton" /></main>;
  if (menu.isError || !menu.data) return <main className="content"><QueryError onRetry={() => void menu.refetch()} /></main>;
  const categories = categoriesQuery.data ?? [];
  return <main className="content page-enter">
    <PageHeading eyebrow="ÜRÜN DÜZENİ" title="Şube Menüsü" description="Ortak ürün kataloğundan seçim yapın; fiyatı ve kategoriyi şubenize göre düzenleyin." />
    {notice && <div className="error-box" style={{ marginBottom: 14, borderColor: '#d9cbbb', background: '#f5efe5', color: '#654b2c' }}><span>{notice}</span><button className="btn btn-small" onClick={() => setNotice('')}><X size={13} /> Kapat</button></div>}
    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-head"><div><h2>Şube menünüz</h2><p>Fiyatlar ve kategori atamaları yalnızca bu şubeye uygulanır.</p></div><Coffee size={18} color="#98784d" /></div>
      {categories.length > 0 && <div className="category-strip"><span className="nav-label" style={{ padding: 0 }}>KATEGORİLER</span>{categories.map((category) => <span key={category.id} className="category-chip">{category.name}{category.branchId === null ? ' · ortak' : ' · şube'}</span>)}</div>}
      {!menu.data.menuItems.length ? <EmptyList label="Menünüz henüz boş" detail="Aşağıdaki ortak katalogdan ürün ekleyerek başlayın." /> : <div className="table-wrap"><table><thead><tr><th>Ürün</th><th>Menü fiyatı</th><th>Kategori</th><th>Durum</th><th style={{ textAlign: 'right' }}>İşlem</th></tr></thead><tbody>{menu.data.menuItems.map((item) => <tr key={item.item.id} data-testid={`row-menu-item-${item.item.id}`}><td><div className="td-strong">{item.item.name}</div><div style={{ color: '#927e69', fontSize: 10, marginTop: 4 }}>{item.item.description}</div></td><td>{formatCurrency(item.price)}</td><td>{item.categoryName || 'Kategorisiz'}</td><td><span className="pill" style={item.available ? { color: '#55704f', background: '#e7eddf' } : { color: '#80643d' }}>{item.available ? 'Yayında' : 'Gizli'}</span></td><td><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}><button className="btn btn-small" onClick={() => { setEditingId(item.item.id); setEditPrice(String(item.price)); setEditCategory(item.categoryId === null ? 'none' : String(item.categoryId)); setEditAvailable(item.available); }} data-testid={`button-edit-menu-${item.item.id}`}>Düzenle</button><button className="btn btn-small btn-danger" onClick={() => removeProduct(item)} disabled={removeItem.isPending} aria-label={`${item.item.name} ürününü kaldır`}><Trash2 size={13} /></button></div></td></tr>)}</tbody></table></div>}
    </section>
    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-head"><div><h2>Ortak ürün kataloğu</h2><p>Ürün tanımı ve tarifler merkezi olarak yönetilir.</p></div><ShoppingBag size={17} color="#98784d" /></div>
      {!menu.data.availableProducts.length ? <EmptyList label="Eklenecek ürün yok" detail="Katalogdaki tüm uygun ürünler bu şube menüsünde." /> : <div className="stock-list">{menu.data.availableProducts.map((product) => <div className="stock-row" key={product.id}><div><div className="stock-name">{product.name}</div><div className="stock-meta">{product.category} · {formatCurrency(product.price)}</div></div><button className="btn btn-small btn-primary" onClick={() => addProduct(product.id)} disabled={updateMenu.isPending} data-testid={`button-add-product-${product.id}`}><Plus size={13} /> Menüye ekle</button></div>)}</div>}
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Şube kategorisi oluştur</h2><p>Bu kategori yalnızca size atanmış şubenin menüsünde kullanılabilir.</p></div><Plus size={17} color="#98784d" /></div>
      <form onSubmit={createLocalCategory}><div className="form-grid" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end' }}><div className="field"><label htmlFor="new-category">Yeni kategori adı</label><input id="new-category" className="input" maxLength={80} minLength={2} value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="Örn. Mevsimlik içecekler" /></div><button className="btn btn-primary" disabled={createCategory.isPending}><Plus size={14} />{createCategory.isPending ? 'Oluşturuluyor…' : 'Kategori oluştur'}</button></div>{categoryError && <div style={{ padding: '0 20px 14px', color: '#a04236', fontSize: 11 }}>{categoryError}</div>}</form>
    </section>
    {editingId !== null && <div className="overlay" role="presentation" onClick={() => setEditingId(null)}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-menu-title" onClick={(e) => e.stopPropagation()}><div className="eyebrow">ŞUBEYE ÖZEL DÜZENLEME</div><h2 id="edit-menu-title">Menü ayarları</h2><p>Ürün tarifleri ve ortak katalog bilgileri bu ekrandan değiştirilemez.</p><div className="field"><label htmlFor="edit-price">Şube fiyatı (₺)</label><input id="edit-price" className="input" type="number" min="0" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} /></div><div className="field" style={{ marginTop: 14 }}><label htmlFor="edit-category">Kategori</label><select id="edit-category" className="select" value={editCategory} onChange={(e) => setEditCategory(e.target.value)}><option value="none">Kategorisiz</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.branchId === null ? ' · ortak' : ' · şube'}</option>)}</select></div><div className="field" style={{ marginTop: 14 }}><label htmlFor="edit-available">Menü durumu</label><select id="edit-available" className="select" value={editAvailable ? 'active' : 'hidden'} onChange={(e) => setEditAvailable(e.target.value === 'active')}><option value="active">Yayında</option><option value="hidden">Gizli</option></select></div><div className="dialog-actions"><button className="btn" onClick={() => setEditingId(null)}>Vazgeç</button><button className="btn btn-primary" onClick={() => { const selected = menu.data?.menuItems.find((i) => i.item.id === editingId); if (selected && Number(editPrice) >= 0) saveItem(selected); }} disabled={updateMenu.isPending}>Kaydet</button></div></section></div>}
  </main>;
}

function StaffPage() {
  const staff = useListManagerStaff({ query: { queryKey: getListManagerStaffQueryKey(), staleTime: 30_000, refetchInterval: 60_000 } });
  return <main className="content page-enter">
    <PageHeading eyebrow="ŞUBE EKİBİ" title="Ekip" description="Bu şubeye atanmış kasiyerleri görüntüleyin. Personel bilgileri bu ekranda salt okunurdur." />
    <section className="panel">
      <div className="panel-head"><div><h2>Kasiyerler</h2><p>Şubenize atanmış etkin ve davetli ekip üyeleri</p></div><Users size={17} color="#98784d" /></div>
      {staff.isLoading ? <div className="skeleton" /> : staff.isError ? <div style={{ padding: 18 }}><QueryError onRetry={() => void staff.refetch()} /></div> : !staff.data?.length ? <EmptyList label="Henüz kasiyer atanmadı" detail="Şubenize atanan ekip üyeleri burada listelenir." /> : <div className="table-wrap"><table><thead><tr><th>Personel</th><th>E-posta</th><th>Personel kodu</th><th>Durum</th><th>Katılım</th></tr></thead><tbody>{staff.data.map((member) => <tr key={member.id} data-testid={`row-staff-${member.id}`}><td><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="avatar">{initials(member.fullName)}</span><span className="td-strong">{member.fullName}</span></div></td><td>{member.email}</td><td>{member.staffCode || '—'}</td><td><span className="pill" style={member.status === 'active' && member.active ? { color: '#55704f', background: '#e7eddf' } : { color: '#80643d' }}>{member.status === 'active' && member.active ? 'Etkin' : 'Davetli'}</span></td><td>{formatDate(member.createdAt)}</td></tr>)}</tbody></table></div>}
    </section>
    <div style={{ marginTop: 12, color: '#947e65', fontSize: 10 }}>Ekip değişiklikleri için Café Verün yöneticinizle iletişime geçin.</div>
  </main>;
}

function ManagerPortal() {
  const auth = useAuth();
  const profile = useGetAuthMe({ query: { queryKey: getGetAuthMeQueryKey(), enabled: !!auth.isSignedIn && auth.isLoaded, retry: false, staleTime: 30_000, refetchInterval: 60_000 } });
  if (!auth.isLoaded || (auth.isSignedIn && profile.isLoading)) return <LoadingScreen />;
  if (!auth.isSignedIn) return <SignInLanding />;
  if (profile.isError || !profile.data) return <main className="access-denied"><section className="access-card"><ShieldAlert size={32} color="#9b5948" /><h1>Profilinize ulaşılamadı.</h1><p>Oturumunuzu yenileyip tekrar deneyin. Sorun sürerse sistem yöneticinizle görüşün.</p><button className="btn" onClick={() => void profile.refetch()}><RefreshCw size={14} /> Yeniden dene</button></section></main>;
  if (profile.data.role !== 'branch_manager') return <AccessDenied />;
  if (!profile.data.branchId || !profile.data.branchName) return <main className="access-denied"><section className="access-card"><AlertTriangle size={31} color="#9b5948" /><h1>Şube ataması eksik.</h1><p>Hesabınıza bağlı bir şube bulunamadı. Lütfen sistem yöneticinize başvurun.</p></section></main>;
  return <ManagerLayout name={profile.data.fullName} email={profile.data.email} branchName={profile.data.branchName}>
    <Switch>
      <Route path="/" component={OverviewPage} />
      <Route path="/inventory" component={InventoryPage} />
      <Route path="/menu" component={MenuPage} />
      <Route path="/staff" component={StaffPage} />
      <Route><NotFound /></Route>
    </Switch>
  </ManagerLayout>;
}

function NotFound() {
  return <main className="content"><div className="eyebrow">404 · BULUNAMADI</div><h1 className="font-display" style={{ fontSize: 42 }}>Bu sayfa menüde yok.</h1><Link className="btn btn-primary" href="/">Genel bakışa dön</Link></main>;
}

function RouterContent() {
  const { addListener } = useClerk();
  const cache = useQueryClient();
  useEffect(() => {
    let previousUser: string | null | undefined = undefined;
    const unsubscribe = addListener(({ user }) => {
      const currentUser = user?.id ?? null;
      if (previousUser !== undefined && currentUser !== previousUser) cache.clear();
      previousUser = currentUser;
    });
    return () => unsubscribe();
  }, [addListener, cache]);
  return <Switch>
    <Route path="/sign-in/*?" component={SignInPage} />
    <Route path="/sign-up/*?" component={SignUpPage} />
    <Route path="/" component={ManagerPortal} />
    <Route path="/inventory" component={ManagerPortal} />
    <Route path="/menu" component={ManagerPortal} />
    <Route path="/staff" component={ManagerPortal} />
    <Route component={ManagerPortal} />
  </Switch>;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{
    signIn: { start: { title: 'Tekrar hoş geldiniz', subtitle: 'Şube panelinize giriş yapın' } },
    signUp: { start: { title: 'Personel hesabı', subtitle: 'Hesap oluşturma davet ile yapılır' } },
  }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><RouterContent /></QueryClientProvider>
  </ClerkProvider>;
}

function App() {
  return <QueryClientProvider client={queryClient}>
    <WouterRouter base={basePath}>
      <ErrorBoundary><ClerkRoutes /></ErrorBoundary>
    </WouterRouter>
  </QueryClientProvider>;
}

export default App;
