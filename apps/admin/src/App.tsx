import { SessionContext, useSession } from '@all/module-sdk/web';
import { Alert, Button, Spinner } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useContext, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth/auth';
import { AppLayout } from './layout/AppLayout';
import { useWebModules } from './modules';
import { AuditPage } from './pages/AuditPage';
import { CompanyPage } from './pages/CompanyPage';
import { EditCustomerPage, NewCustomerPage } from './pages/customers/CustomerFormPage';
import { CustomerPage } from './pages/customers/CustomerPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { SegmentsPage } from './pages/segmentation/SegmentsPage';
import { CustomFieldsPage } from './pages/customers/CustomFieldsPage';
import { FinanceEntriesPage } from './pages/finance/FinanceEntriesPage';
import { FinanceOverviewPage } from './pages/finance/FinanceOverviewPage';
import { FinanceRegistryPage } from './pages/finance/FinanceRegistryPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { ManualPage } from './pages/manual/ManualPage';
import { RolesPage } from './pages/RolesPage';
import { SetPasswordPage } from './pages/SetPasswordPage';
import { SignupPage } from './pages/SignupPage';
import { Forbidden, NotFound } from './pages/StatusPages';
import { UsersPage } from './pages/UsersPage';
import { TeamPage } from './pages/team/TeamPage';

// Páginas públicas: cada visitante baixa só a página que abriu.
const PublicBookingPage = lazy(() => import('@all/scheduling/web').then((m) => ({ default: m.PublicBookingPage })));
const PublicJobsPage = lazy(() => import('@all/recruiting/web').then((m) => ({ default: m.PublicJobsPage })));
const PublicSimulatorPage = lazy(() => import('@all/consortium/web').then((m) => ({ default: m.PublicSimulatorPage })));
const PublicStorePage = lazy(() => import('@all/store/web').then((m) => ({ default: m.PublicStorePage })));

/**
 * Primeiro trecho dos caminhos do consórcio no admin (cotas, leads…). Qualquer outro em
 * /consorcio/<trecho> é o simulador público de uma empresa (o trecho é o slug dela).
 */
async function loadConsortiumAdminSegments() {
  const { consortiumWeb } = await import('@all/consortium/web');
  return consortiumWeb.routes.map((r) => r.path).filter((p) => p.startsWith('consorcio/')).map((p) => p.split('/')[1]!);
}

function FullScreenSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

const PublicPage = ({ children }: { children: ReactNode }) => <Suspense fallback={<FullScreenSpinner />}>{children}</Suspense>;

export function App() {
  const { status } = useAuth();
  const session = useContext(SessionContext);
  const location = useLocation();
  const webModules = useWebModules();
  const consortiumSlug = /^\/consorcio\/([^/]+)\/?$/.exec(location.pathname)?.[1];
  const consortiumAdmin = useQuery({ queryKey: ['consortium-admin-segments'], queryFn: loadConsortiumAdminSegments, enabled: !!consortiumSlug, staleTime: Infinity });

  // Agendamento online: página pública, não depende de sessão.
  if (location.pathname.startsWith('/agendar/')) {
    return (
      <Routes>
        <Route path="/agendar/:slug" element={<PublicPage><PublicBookingPage /></PublicPage>} />
      </Routes>
    );
  }

  // Simulador de consórcio da empresa: página pública, não depende de sessão.
  if (consortiumSlug && consortiumAdmin.isPending) return <FullScreenSpinner />;
  if (consortiumSlug && !consortiumAdmin.data?.includes(consortiumSlug)) {
    return (
      <Routes>
        <Route path="/consorcio/:slug" element={<PublicPage><PublicSimulatorPage /></PublicPage>} />
      </Routes>
    );
  }

  // Vagas e candidatura (Head hunter): página pública, não depende de sessão.
  if (location.pathname.startsWith('/vagas/')) {
    return (
      <Routes>
        <Route path="/vagas/:slug" element={<PublicPage><PublicJobsPage /></PublicPage>} />
        <Route path="/vagas/:slug/:jobId" element={<PublicPage><PublicJobsPage /></PublicPage>} />
      </Routes>
    );
  }

  // Lojinha: vitrine, produto, carrinho e checkout públicos, não dependem de sessão.
  if (location.pathname.startsWith('/loja/')) {
    return (
      <Routes>
        <Route path="/loja/:slug" element={<PublicPage><PublicStorePage /></PublicPage>} />
        <Route path="/loja/:slug/produto/:productId" element={<PublicPage><PublicStorePage /></PublicPage>} />
        <Route path="/loja/:slug/carrinho" element={<PublicPage><PublicStorePage /></PublicPage>} />
        <Route path="/loja/:slug/finalizar" element={<PublicPage><PublicStorePage /></PublicPage>} />
      </Routes>
    );
  }

  if (status === 'loading') {
    return <FullScreenSpinner label="Abrindo sua sessão…" />;
  }

  // Telas do ramo e dos módulos da empresa: baixadas depois do login, só as que ela usa.
  if (status === 'authenticated' && !webModules.data) {
    if (webModules.isError) {
      return (
        <div className="mx-auto max-w-md space-y-4 p-8">
          <Alert>Não foi possível carregar as telas. Verifique sua conexão.</Alert>
          <Button onClick={() => window.location.reload()}>Tentar de novo</Button>
        </div>
      );
    }
    return <FullScreenSpinner label="Abrindo sua empresa…" />;
  }

  // Só os módulos ativos no tenant viram rotas; os demais simplesmente não existem no admin.
  const activeModules = new Set(session?.modules.map((m) => m.key));
  const moduleRoutes = (webModules.data ?? [])
    .filter((m) => activeModules.has(m.key))
    .flatMap((m) =>
      m.routes.map((r) => (
        <Route key={`${m.key}:${r.path}`} path={r.path} element={<Guarded permission={r.permission} Component={r.Component} />} />
      )),
    );

  return (
    <Routes>
      <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
      <Route path="/definir-senha" element={<SetPasswordPage />} />
      <Route path="/contratar" element={status === 'anonymous' ? <SignupPage /> : <Navigate to="/" replace />} />
      {status === 'anonymous' ? (
        <>
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/entrar" replace state={{ from: location.pathname }} />} />
        </>
      ) : (
        <Route element={<AppLayout />}>
          <Route path="/entrar" element={<Navigate to={location.state?.from ?? '/'} replace />} />
          <Route index element={<HomePage />} />
          <Route path="manual" element={<ManualPage />} />
          <Route path="manual/:guide" element={<ManualPage />} />
          <Route path="manual/:guide/:topic" element={<ManualPage />} />
          <Route path="configuracoes/empresa" element={<Guarded permission="core.company.manage" Component={CompanyPage} />} />
          <Route path="configuracoes/usuarios" element={<Guarded permission="core.users.read" Component={UsersPage} />} />
          <Route path="configuracoes/papeis" element={<Guarded permission="core.access.read" Component={RolesPage} />} />
          <Route path="configuracoes/auditoria" element={<Guarded permission="core.audit.read" Component={AuditPage} />} />
          <Route path="configuracoes/campos-de-clientes" element={<Guarded permission="core.customers.fields" Component={CustomFieldsPage} />} />
          <Route path="clientes" element={<Guarded permission="core.customers.read" Component={CustomersPage} />} />
          <Route path="clientes/novo" element={<Guarded permission="core.customers.write" Component={NewCustomerPage} />} />
          <Route path="clientes/:id" element={<Guarded permission="core.customers.read" Component={CustomerPage} />} />
          <Route path="clientes/:id/editar" element={<Guarded permission="core.customers.write" Component={EditCustomerPage} />} />
          <Route path="segmentos" element={<Guarded permission="core.segmentation.read" Component={SegmentsPage} />} />
          <Route path="financeiro" element={<Guarded permission="core.finance.read" Component={FinanceOverviewPage} />} />
          <Route path="financeiro/lancamentos" element={<Guarded permission="core.finance.read" Component={FinanceEntriesPage} />} />
          <Route path="financeiro/cadastros" element={<Guarded permission="core.finance.manage" Component={FinanceRegistryPage} />} />
          <Route path="equipe" element={<Guarded permission="core.team.read" Component={TeamPage} />} />
          <Route path="equipe/:id" element={<Guarded permission="core.team.read" Component={TeamPage} />} />
          {moduleRoutes}
          <Route path="*" element={<NotFound />} />
        </Route>
      )}
    </Routes>
  );
}

function Guarded({ permission, Component }: { permission?: string; Component: ComponentType }) {
  const session = useSession();
  if (permission && !session.permissions.includes(permission)) return <Forbidden />;
  return <Component />;
}
