import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChefHat, CircleAlert, Clock3, LoaderCircle, LockKeyhole, RefreshCw } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Redirect, Route, Router as WouterRouter, Switch } from 'wouter';
import {
  createUserWithEmailAndPassword,
  firebaseAuth,
  getGetAuthMeQueryKey,
  getGetDashboardSummaryQueryKey,
  getListOrdersQueryKey,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithGoogle,
  googleSignInErrorMessage,
  signOut,
  updateProfile,
  useGetAuthMe,
  useGetDashboardSummary,
  useListOrders,
  useUpdateOrderStatus,
} from '@workspace/api-client-react';
import type { FirebaseUser, Order, OrderStatus, UserProfile } from '@workspace/api-client-react';
import { useQueryClient as useQueryCache } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 4000 } },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
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
      if (normalized.includes('stock') || normalized.includes('stok')) return `Yetersiz stok: ${serverMessage}`;
      if (normalized.includes('conflict') || normalized.includes('already') || normalized.includes('status')) {
        return `Sipariş başka bir işlemle değişmiş olabilir. Güncel durumu yenileyin. (${serverMessage})`;
      }
      return serverMessage;
    }
    if (value.message) return value.message;
  }
  return 'Sipariş durumu değiştirilemedi. Stok veya güncel sipariş durumu nedeniyle işlem reddedilmiş olabilir.';
}

type AuthState = { user: FirebaseUser | null; loading: boolean };
const AuthContext = createContext<AuthState>({ user: null, loading: true });
const useAuthState = () => useContext(AuthContext);

function FirebaseAuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });
  const client = useQueryClient();
  const previousUid = useRef<string | null | undefined>(undefined);

  useEffect(() => onAuthStateChanged(firebaseAuth, (user) => {
    const uid = user?.uid ?? null;
    if (previousUid.current !== undefined && previousUid.current !== uid) client.clear();
    previousUid.current = uid;
    setState({ user, loading: false });
  }), [client]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
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
  const logout = async () => { await signOut(firebaseAuth); };
  return <button type="button" className="signout" onClick={logout} data-testid="button-sign-out">Oturumu kapat</button>;
}

function AuthLoading() {
  return <div className="state" role="status"><span className="skeleton" /><span className="skeleton short" /><p>Çalışan hesabı doğrulanıyor</p></div>;
}

function ProfileGate() {
  const authQuery = useGetAuthMe({
    query: { queryKey: getGetAuthMeQueryKey(), staleTime: 30000, refetchOnWindowFocus: true },
  });
  if (authQuery.isLoading) return <AuthLoading />;
  if (authQuery.isError || !authQuery.data) {
    return <div className="access-page"><section className="access-card" role="alert">
      <span className="access-mark"><CircleAlert size={20} /></span><span className="eyebrow">HESAP DOĞRULANAMADI</span>
      <h1>Bir dakika.</h1><p className="error-copy">Çalışan profilinize ulaşılamadı. Oturumunuzu kontrol edip yeniden deneyin.</p>
      <button className="retry" onClick={() => authQuery.refetch()} data-testid="button-profile-retry"><RefreshCw size={13} /> Yeniden dene</button>
      <LogoutButton />
    </section></div>;
  }
  if (authQuery.data.role !== 'kitchen') {
    return <div className="access-page"><section className="access-card" role="status" data-testid="status-access-denied">
      <span className="access-mark"><LockKeyhole size={20} /></span><span className="eyebrow">PERSONEL ERİŞİMİ</span>
      <h1>Bu ekran size açık değil.</h1>
      <p>Bu mutfak panosu yalnızca mutfak ekibi içindir. Hesabınızın rolü: <strong>{authQuery.data.role}</strong>.</p>
      <LogoutButton />
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
          <h2 className="auth-card-title">Mutfak ekranına geçin</h2>
          <p>Devam etmek için Café Verün personel hesabınızla oturum açın.</p>
          <a className="action" href={`${basePath}/sign-in`} data-testid="link-staff-sign-in" style={{ marginTop: 12, textDecoration: 'none' }}>Giriş yap <LockKeyhole size={14} /></a>
        </div>
      </section>
    </main>
    <footer className="footer" style={{ margin: '0 clamp(18px,4vw,58px)' }}><span>CAFÉ VERÜN · MAHALLEMİZİN KAHVESİ</span><span>Güvenli personel alanı</span></footer>
  </div>;
}

function AuthFrame({ children, accountLabel = 'PERSONEL GİRİŞİ' }: { children: React.ReactNode; accountLabel?: string }) {
  return <div className="kitchen-app">
    <header className="topbar"><div className="brand"><img src={`${import.meta.env.BASE_URL}brand/cafe-verun-logo.png`} alt="Café Verün" /><span className="brand-divider" /><span className="brand-caption">{accountLabel}</span></div></header>
    <main className="auth-page">
      <section className="auth-copy"><span className="eyebrow">CAFÉ VERÜN · MUTFAK</span><h1>Ekibimize<br /><em>hoş geldiniz.</em></h1><p>Güvenli personel hesabınızla mutfak sipariş sırasına giriş yapın.</p></section>
      <div className="auth-widget">{children}</div>
    </main>
  </div>;
}

function firebaseMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'E-posta veya şifre hatalı.';
  if (code === 'auth/email-already-in-use') return 'Bu e-posta ile zaten bir hesap bulunuyor. Giriş yapmayı deneyin.';
  if (code === 'auth/weak-password') return 'Şifreniz en az 6 karakter olmalı.';
  if (code === 'auth/invalid-email') return 'Geçerli bir e-posta adresi girin.';
  if (code === 'auth/too-many-requests') return 'Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.';
  return 'İşlem tamamlanamadı. Bilgilerinizi kontrol edip yeniden deneyin.';
}

function SignInPage() {
  const { user } = useAuthState();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState<FirebaseUser | null>(null);
  const [resent, setResent] = useState(false);
  useEffect(() => {
    if (user?.emailVerified) setMessage('');
  }, [user]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage(''); setBusy(true);
    try {
      const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      if (!credential.user.emailVerified) {
        setUnverified(credential.user);
        await sendEmailVerification(credential.user);
        await signOut(firebaseAuth);
        setMessage('E-posta adresiniz henüz doğrulanmamış. Yeni bir doğrulama bağlantısı gönderdik; lütfen e-postanızı doğruladıktan sonra giriş yapın.');
      }
    } catch (error) { setMessage(firebaseMessage(error)); }
    finally { setBusy(false); }
  };
  const googleSignIn = async () => {
    setBusy(true); setMessage('');
    try {
      const credential = await signInWithGoogle();
      await credential.user.reload();
      if (!firebaseAuth.currentUser?.emailVerified) {
        if (firebaseAuth.currentUser) await sendEmailVerification(firebaseAuth.currentUser);
        await signOut(firebaseAuth);
        setMessage('Google e-posta adresiniz doğrulanmamış. Doğruladıktan sonra yeniden giriş yapın.');
      } else {
        window.location.assign(`${basePath}/`);
      }
    } catch (error) { setMessage(googleSignInErrorMessage(error)); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    if (!unverified) return;
    setBusy(true);
    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      const current = firebaseAuth.currentUser;
      if (current && !current.emailVerified) await sendEmailVerification(current);
      await signOut(firebaseAuth);
      setResent(true);
      setMessage('Doğrulama bağlantısı yeniden gönderildi. E-postanızı doğruladıktan sonra giriş yapabilirsiniz.');
    } catch (error) { setMessage(firebaseMessage(error)); }
    finally { setBusy(false); }
  };
  return <AuthFrame><section className="auth-form-card">
    <span className="access-mark"><LockKeyhole size={20} /></span><span className="eyebrow">PERSONEL GİRİŞİ</span>
    <h2 className="auth-card-title">Mutfak ekranına geçin</h2>
    <p>Yetkili personel hesabınızla oturum açın.</p>
    <form onSubmit={submit} className="auth-form">
      <label htmlFor="signin-email">E-posta</label><input id="signin-email" data-testid="input-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
      <label htmlFor="signin-password">Şifre</label><input id="signin-password" data-testid="input-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
      {message && <p className="auth-message" role="status" data-testid="status-auth-message">{message}</p>}
      <button className="action auth-submit" type="submit" disabled={busy} data-testid="button-sign-in">{busy ? <LoaderCircle size={14} className="spin" /> : <LockKeyhole size={14} />} Giriş yap</button>
    </form>
    <button className="action auth-submit" type="button" onClick={() => void googleSignIn()} disabled={busy}><span className="font-bold text-[#4285f4]">G</span> Google ile devam et</button>
    {unverified && !resent && <button className="text-action" type="button" onClick={resend} disabled={busy}>Doğrulama e-postasını yeniden gönder</button>}
    <a className="auth-link" href={`${basePath}/forgot-password`}>Şifremi unuttum</a>
    <div className="auth-separator" />
    <p className="auth-footnote">Personel hesabınız yok mu? <a href={`${basePath}/sign-up`}>Hesap oluşturun</a></p>
  </section></AuthFrame>;
}

function SignUpPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
      if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
      await sendEmailVerification(credential.user);
      await signOut(firebaseAuth);
      setComplete(true);
    } catch (error) { setMessage(firebaseMessage(error)); }
    finally { setBusy(false); }
  };
  const googleSignIn = async () => {
    setBusy(true); setMessage('');
    try {
      const credential = await signInWithGoogle();
      await credential.user.reload();
      if (!firebaseAuth.currentUser?.emailVerified) {
        if (firebaseAuth.currentUser) await sendEmailVerification(firebaseAuth.currentUser);
        await signOut(firebaseAuth);
        setMessage('Google e-posta adresiniz doğrulanmamış. Doğruladıktan sonra yeniden giriş yapın.');
      } else {
        window.location.assign(`${basePath}/`);
      }
    } catch (error) { setMessage(googleSignInErrorMessage(error)); }
    finally { setBusy(false); }
  };
  return <AuthFrame accountLabel={'PERSONEL\\nHESABI'}><section className="auth-form-card">
    <span className="access-mark"><ChefHat size={20} /></span><span className="eyebrow">PERSONEL HESABI</span>
    {complete ? <>
      <h2 className="auth-card-title">E-postanızı doğrulayın</h2>
      <p><strong>{email}</strong> adresine doğrulama bağlantısı gönderdik. Giriş yapmadan önce e-postanızı doğrulayın.</p>
      <div className="auth-message" role="status">Personel rolünüz ve şube erişiminiz ancak aynı e-posta ile oluşturulmuş bekleyen personel kaydı varsa etkinleşir. Yönetici size bir personel kaydı oluşturmadıysa yöneticinizle görüşün.</div>
      <a className="action auth-submit" href={`${basePath}/sign-in`}>Giriş sayfasına dön <LockKeyhole size={14} /></a>
    </> : <>
      <h2 className="auth-card-title">Personel hesabı oluştur</h2>
      <p>Hesabınız, yöneticinizin oluşturduğu bekleyen personel kaydıyla aynı e-posta üzerinden eşleşir.</p>
      <form onSubmit={submit} className="auth-form">
        <label htmlFor="signup-name">Ad soyad</label><input id="signup-name" data-testid="input-name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} />
        <label htmlFor="signup-email">E-posta</label><input id="signup-email" data-testid="input-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
        <label htmlFor="signup-password">Şifre</label><input id="signup-password" data-testid="input-password" type="password" autoComplete="new-password" minLength={6} required value={password} onChange={event => setPassword(event.target.value)} />
        {message && <p className="auth-message" role="alert">{message}</p>}
        <button className="action auth-submit" type="submit" disabled={busy} data-testid="button-sign-up">{busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Hesap oluştur</button>
      </form>
      <button className="action auth-submit" type="button" onClick={() => void googleSignIn()} disabled={busy}><span className="font-bold text-[#4285f4]">G</span> Google ile devam et</button>
      <p className="auth-footnote">Zaten hesabınız var mı? <a href={`${basePath}/sign-in`}>Giriş yapın</a></p>
    </>}
  </section></AuthFrame>;
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim());
      setMessage('Şifre yenileme bağlantısı e-posta adresinize gönderildi.');
    } catch (error) { setMessage(firebaseMessage(error)); }
    finally { setBusy(false); }
  };
  return <AuthFrame><section className="auth-form-card">
    <span className="access-mark"><LockKeyhole size={20} /></span><span className="eyebrow">HESAP GÜVENLİĞİ</span>
    <h2 className="auth-card-title">Şifrenizi yenileyin</h2>
    <p>Hesabınızla ilişkili e-posta adresine yenileme bağlantısı gönderelim.</p>
    <form onSubmit={submit} className="auth-form">
      <label htmlFor="reset-email">E-posta</label><input id="reset-email" data-testid="input-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
      {message && <p className="auth-message" role="status">{message}</p>}
      <button className="action auth-submit" type="submit" disabled={busy} data-testid="button-reset-password">{busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Bağlantı gönder</button>
    </form>
    <p className="auth-footnote"><a href={`${basePath}/sign-in`}>Giriş sayfasına dön</a></p>
  </section></AuthFrame>;
}

function AuthStatusPage() {
  const { user, loading } = useAuthState();
  if (loading) return <AuthLoading />;
  if (!user) return <StaffLanding />;
  if (!user.emailVerified) return <UnverifiedPage user={user} />;
  return <ProfileGate />;
}

function UnverifiedPage({ user }: { user: FirebaseUser }) {
  const [message, setMessage] = useState('Bu hesap henüz doğrulanmadı. E-posta bağlantısını doğruladıktan sonra giriş yapabilirsiniz.');
  const [busy, setBusy] = useState(false);
  const resend = async () => {
    setBusy(true);
    try { await sendEmailVerification(user); setMessage('Doğrulama bağlantısı yeniden gönderildi.'); }
    catch { setMessage('E-posta gönderilemedi. Biraz sonra yeniden deneyin.'); }
    finally { setBusy(false); }
  };
  return <div className="access-page"><section className="access-card">
    <span className="access-mark"><CircleAlert size={20} /></span><span className="eyebrow">E-POSTA DOĞRULAMASI</span>
    <h1>E-postanızı doğrulayın.</h1><p>{message}</p>
    <button className="action auth-submit" onClick={resend} disabled={busy} data-testid="button-resend-verification">{busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Bağlantıyı yeniden gönder</button>
    <button className="signout" onClick={() => signOut(firebaseAuth)} data-testid="button-unverified-sign-out">Oturumu kapat</button>
  </section></div>;
}

function UnknownRoute() { return <Redirect to="/" />; }

function AppRoutes() {
  return <Switch>
    <Route path="/" component={AuthStatusPage} />
    <Route path="/sign-in" component={SignInPage} />
    <Route path="/sign-up" component={SignUpPage} />
    <Route path="/forgot-password" component={ForgotPasswordPage} />
    <Route component={UnknownRoute} />
  </Switch>;
}

function App() {
  return <WouterRouter base={basePath}>
    <QueryClientProvider client={queryClient}>
      <FirebaseAuthProvider><AppRoutes /></FirebaseAuthProvider>
    </QueryClientProvider>
  </WouterRouter>;
}

export default App;
