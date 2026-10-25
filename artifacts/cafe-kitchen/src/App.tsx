import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChefHat, CircleAlert, Clock3, LoaderCircle, LockKeyhole, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  getGetAuthMeQueryKey,
  getGetDashboardSummaryQueryKey,
  getListOrdersQueryKey,
  useGetAuthMe,
  useGetDashboardSummary,
  useListOrders,
  useUpdateOrderStatus,
} from '@workspace/api-client-react';
import type { Order, OrderStatus, UserProfile } from '@workspace/api-client-react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 4000 } },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#39251b',
    colorForeground: '#34251c',
    colorMutedForeground: '#806c58',
    colorDanger: '#a04236',
    colorBackground: '#f8f4ec',
    colorInput: '#fcf9f3',
    colorInputForeground: '#362418',
    colorNeutral: '#d7c8b5',
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: '3px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#f8f4ec] border border-[#d8cebe] rounded-sm w-[440px] max-w-full overflow-hidden shadow-sm',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#34251c] font-serif',
    headerSubtitle: 'text-[#806c58]',
    socialButtonsBlockButtonText: 'text-[#34251c]',
    formFieldLabel: 'text-[#53402e]',
    footerActionLink: 'text-[#785a34]',
    footerActionText: 'text-[#806c58]',
    dividerText: 'text-[#806c58]',
    identityPreviewEditButton: 'text-[#785a34]',
    formFieldSuccessText: 'text-[#54704e]',
    alertText: 'text-[#8d4e3c]',
    logoBox: 'rounded-sm',
    logoImage: 'object-contain',
    socialButtonsBlockButton: 'border-[#d7c8b5] bg-[#fcf9f3]',
    formButtonPrimary: 'bg-[#39251b] text-[#f8f4ec]',
    formFieldInput: 'border-[#d7c8b5] bg-[#fcf9f3] text-[#362418]',
    footerAction: 'text-[#806c58]',
    dividerLine: 'bg-[#ded3c3]',
    alert: 'border-[#dfc0b2] bg-[#f0dfd7]',
    otpCodeFieldInput: 'border-[#d7c8b5] bg-[#fcf9f3] text-[#362418]',
    formFieldRow: 'text-[#53402e]',
    main: 'text-[#34251c]',
  },
};

const money = (value: number) => new Intl.NumberFormat('tr-TR', {
  style: 'currency', currency: 'TRY', maximumFractionDigits: 2,
}).format(value);

const duration = (value: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  return `${hours} sa ${minutes % 60} dk`;
};

const clock = (value: string) => new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

function apiErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as {
      message?: string;
      error?: string;
      response?: { data?: { error?: string; message?: string } };
    };
    const serverMessage = value.response?.data?.error ?? value.response?.data?.message ?? value.error;
    if (serverMessage) {
      const normalized = serverMessage.toLocaleLowerCase('tr-TR');
      if (normalized.includes('stock') || normalized.includes('stok')) {
        return `Yetersiz stok: ${serverMessage}`;
      }
      if (normalized.includes('conflict') || normalized.includes('already') || normalized.includes('status')) {
        return `Sipariş başka bir işlemle değişmiş olabilir. Güncel durumu yenileyin. (${serverMessage})`;
      }
      return serverMessage;
    }
    if (value.message) return value.message;
  }
  return 'Sipariş durumu değiştirilemedi. Stok veya güncel sipariş durumu nedeniyle işlem reddedilmiş olabilir.';
}

function OrderTicket({ order, onAdvance, updating }: {
  order: Order;
  onAdvance: (order: Order) => void;
  updating: boolean;
}) {
  return <article className={`ticket ${order.status}`} data-testid={`card-order-${order.id}`}>
    <div className="ticket-top">
      <span className="ticket-number">#{order.orderNumber}</span>
      <span className="ticket-time" title={clock(order.createdAt)}>
        <Clock3 size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />{duration(order.createdAt)}
      </span>
    </div>
    <div className="ticket-customer">
      <h3>{order.customerName}</h3>
      <span className="source">{order.source === 'cashier' ? 'Tezgâh' : 'Çevrim içi'}</span>
    </div>
    <div className="items">
      {order.items.map(item => <div className="item" key={item.id}>
        <div className="item-line">
          <span><strong>{item.quantity}×</strong> {item.name}</span>
          <strong>{money(item.lineTotal)}</strong>
        </div>
        {item.kitchenInstructions && <p className="prep-instruction"><b>Mutfağa özel:</b> {item.kitchenInstructions}</p>}
      </div>)}
    </div>
    {order.note && <p className="note"><b>SİPARİŞ NOTU</b>{order.note}</p>}
    <div className="ticket-bottom">
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

function KitchenBoard({ profile }: { profile: UserProfile }) {
  const queryClient = useQueryClient();
  const paramsPending = { status: 'pending' as const };
  const paramsPreparing = { status: 'preparing' as const };
  const paramsReady = { status: 'ready' as const };
  const pendingQuery = useListOrders(paramsPending, {
    query: { queryKey: getListOrdersQueryKey(paramsPending), refetchInterval: 5000, staleTime: 4000 },
  });
  const preparingQuery = useListOrders(paramsPreparing, {
    query: { queryKey: getListOrdersQueryKey(paramsPreparing), refetchInterval: 5000, staleTime: 4000 },
  });
  const readyQuery = useListOrders(paramsReady, {
    query: { queryKey: getListOrdersQueryKey(paramsReady), refetchInterval: 5000, staleTime: 4000 },
  });
  const summaryQuery = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 5000, staleTime: 4000 },
  });
  const mutation = useUpdateOrderStatus();
  const groups = useMemo(() => ({
    pending: pendingQuery.data ?? [],
    preparing: preparingQuery.data ?? [],
    ready: readyQuery.data ?? [],
  }), [pendingQuery.data, preparingQuery.data, readyQuery.data]);
  const activeCount = groups.pending.length + groups.preparing.length + groups.ready.length;
  const advance = (order: Order) => {
    const status: OrderStatus | undefined = order.status === 'pending' ? 'preparing' : order.status === 'preparing' ? 'ready' : undefined;
    if (!status || mutation.isPending) return;
    mutation.mutate({ id: order.id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      },
    });
  };
  const summary = summaryQuery.data;
  const lanes: { key: 'pending' | 'preparing' | 'ready'; title: string; query: typeof pendingQuery }[] = [
    { key: 'pending', title: 'Yeni siparişler', query: pendingQuery },
    { key: 'preparing', title: 'Hazırlanıyor', query: preparingQuery },
    { key: 'ready', title: 'Teslime hazır', query: readyQuery },
  ];

  return <div className="kitchen-app">
    <header className="topbar">
      <div className="brand">
        <img src={`${import.meta.env.BASE_URL}brand/cafe-verun-logo.png`} alt="Café Verün" />
        <span className="brand-divider" />
        <span className="brand-caption">ARKA TEZGAH<br />MUTFAK EKRANI</span>
      </div>
      <div className="header-right">
        <span className="branch-chip" data-testid="text-assigned-branch">{profile.branchName ?? 'Şube atanmamış'}</span>
        <div className="live-status"><span className="live-dot" /> CANLI SİPARİŞ AKIŞI</div>
        <LogoutButton />
      </div>
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
        {mutation.isError && <div className="error-inline" role="alert" data-testid="text-update-error">
          <AlertTriangle size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />{apiErrorMessage(mutation.error)}
          <button className="retry" onClick={() => mutation.reset()} style={{ marginLeft: 10 }}>Kapat</button>
        </div>}
        {lanes.some(lane => lane.query.isLoading) ? <LoadingState /> :
          lanes.some(lane => lane.query.isError) ?
            <ErrorState retry={() => lanes.forEach(lane => void lane.query.refetch())} label="Siparişlere ulaşılamadı" /> :
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

function LogoutButton() {
  const { signOut } = useClerk();
  return <button type="button" className="signout" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out">Oturumu kapat</button>;
}

function AuthLoading() {
  return <div className="state" role="status"><span className="skeleton" /><span className="skeleton short" /><p>Çalışan hesabı doğrulanıyor</p></div>;
}

function ProfileGate() {
  const authQuery = useGetAuthMe({
    query: { queryKey: getGetAuthMeQueryKey(), staleTime: 30000, refetchOnWindowFocus: true },
  });
  const { signOut } = useClerk();
  if (authQuery.isLoading) return <AuthLoading />;
  if (authQuery.isError || !authQuery.data) {
    return <div className="access-page"><section className="access-card" role="alert">
      <span className="access-mark"><CircleAlert size={20} /></span><span className="eyebrow">HESAP DOĞRULANAMADI</span>
      <h1>Bir dakika.</h1><p className="error-copy">Çalışan profilinize ulaşılamadı. Oturumunuzu kontrol edip yeniden deneyin.</p>
      <button className="retry" onClick={() => authQuery.refetch()} data-testid="button-profile-retry"><RefreshCw size={13} /> Yeniden dene</button>
      <button className="signout" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-profile-sign-out">Oturumu kapat</button>
    </section></div>;
  }
  if (authQuery.data.role !== 'kitchen') {
    return <div className="access-page"><section className="access-card" role="status" data-testid="status-access-denied">
      <span className="access-mark"><LockKeyhole size={20} /></span><span className="eyebrow">PERSONEL ERİŞİMİ</span>
      <h1>Bu ekran size açık değil.</h1>
      <p>Bu mutfak panosu yalnızca mutfak ekibi içindir. Hesabınızın rolü: <strong>{authQuery.data.role}</strong>.</p>
      <button className="signout" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-denied-sign-out">Oturumu kapat</button>
    </section></div>;
  }
  return <KitchenBoard profile={authQuery.data} />;
}

function StaffLanding() {
  return <div className="kitchen-app">
    <header className="topbar">
      <div className="brand">
        <img src={`${import.meta.env.BASE_URL}brand/cafe-verun-logo.png`} alt="Café Verün" />
        <span className="brand-divider" />
        <span className="brand-caption">PERSONEL<br />GİRİŞİ</span>
      </div>
      <div className="live-status"><span className="live-dot" /> MUTFAK EKİBİ</div>
    </header>
    <main className="auth-page page-enter">
      <section className="auth-copy">
        <span className="eyebrow">CAFÉ VERÜN · EKİP ALANI</span>
        <h1>İyi servis,<br /><em>iyi hazırlıkla.</em></h1>
        <p>Mutfak sipariş sırasına erişmek için personel hesabınızla giriş yapın. Yalnızca yetkili mutfak ekibi bu ekrana ulaşabilir.</p>
        <div className="auth-callout"><i /> Şube erişimi hesabınıza atanır; şube seçimi yoktur.</div>
      </section>
      <section className="auth-widget" aria-label="Personel giriş seçenekleri">
        <div className="access-card">
          <span className="access-mark"><ChefHat size={20} /></span>
          <span className="eyebrow">PERSONEL GİRİŞİ</span>
          <h2 style={{ font: "500 27px 'Playfair Display',serif", color: '#3d291e', margin: '12px 0 7px' }}>Mutfak ekranına geçin</h2>
          <p>Devam etmek için Café Verün personel hesabınızla oturum açın.</p>
          <a className="action" href={`${basePath}/sign-in`} data-testid="link-staff-sign-in" style={{ marginTop: 12, textDecoration: 'none' }}>Giriş yap <LockKeyhole size={14} /></a>
        </div>
      </section>
    </main>
    <footer className="footer" style={{ margin: '0 clamp(18px,4vw,58px)' }}><span>CAFÉ VERÜN · MAHALLEMİZİN KAHVESİ</span><span>Güvenli personel alanı</span></footer>
  </div>;
}

function HomeRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  return isSignedIn ? <ProfileGate /> : <StaffLanding />;
}

function SignInPage() {
  return <div className="kitchen-app">
    <header className="topbar"><div className="brand"><img src={`${import.meta.env.BASE_URL}brand/cafe-verun-logo.png`} alt="Café Verün" /><span className="brand-divider" /><span className="brand-caption">PERSONEL<br />GİRİŞİ</span></div></header>
    <main className="auth-page"><section className="auth-copy"><span className="eyebrow">CAFÉ VERÜN · MUTFAK</span><h1>Ekibimize<br /><em>hoş geldiniz.</em></h1><p>Güvenli personel hesabınızla mutfak sipariş sırasına giriş yapın.</p></section>
      <div className="auth-widget"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>
    </main>
  </div>;
}

function SignUpPage() {
  return <div className="kitchen-app">
    <header className="topbar"><div className="brand"><img src={`${import.meta.env.BASE_URL}brand/cafe-verun-logo.png`} alt="Café Verün" /><span className="brand-divider" /><span className="brand-caption">PERSONEL<br />HESABI</span></div></header>
    <main className="auth-page"><section className="auth-copy"><span className="eyebrow">CAFÉ VERÜN · PERSONEL</span><h1>Hesap<br /><em>oluşturma.</em></h1><p>Personel hesabı oluşturma işlemi kurumunuzun erişim politikasına tabidir.</p></section>
      <div className="auth-widget"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>
    </main>
  </div>;
}

function UnknownRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  return isSignedIn ? <Redirect to="/" /> : <Redirect to="/" />;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) client.clear();
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{
      signIn: { start: { title: 'Tekrar hoş geldiniz', subtitle: 'Mutfak ekranına erişmek için giriş yapın' } },
      signUp: { start: { title: 'Personel hesabı oluştur', subtitle: 'Café Verün ekibi için hesap oluşturun' } },
    }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <QueryClientProvider client={queryClient}>
      <ClerkQueryClientCacheInvalidator />
      <Switch>
        <Route path="/" component={HomeRoute} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route component={UnknownRoute} />
      </Switch>
    </QueryClientProvider>
  </ClerkProvider>;
}

function App() {
  return <WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter>;
}

export default App;
