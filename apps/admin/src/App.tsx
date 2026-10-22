import { SessionContext, useSession } from '@all/module-sdk/web';
import { Spinner } from '@all/ui';
import { useContext, type ComponentType } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth/auth';
import { AppLayout } from './layout/AppLayout';
import { webModules } from './modules';
import { AuditPage } from './pages/AuditPage';
import { CustomerPage } from './pages/customers/CustomerPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { CustomFieldsPage } from './pages/customers/CustomFieldsPage';
import { FinanceEntriesPage } from './pages/finance/FinanceEntriesPage';
import { FinanceOverviewPage } from './pages/finance/FinanceOverviewPage';
import { FinanceRegistryPage } from './pages/finance/FinanceRegistryPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RolesPage } from './pages/RolesPage';
import { SetPasswordPage } from './pages/SetPasswordPage';
import { Forbidden, NotFound } from './pages/StatusPages';
import { UsersPage } from './pages/UsersPage';

export function App() {
  const { status } = useAuth();
  const session = useContext(SessionContext);
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Abrindo sua sessão…" />
      </div>
    );
  }

  // Só os módulos ativos no tenant viram rotas; os demais simplesmente não existem no admin.
  const activeModules = new Set(session?.modules.map((m) => m.key));
  const moduleRoutes = webModules
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
      {status === 'anonymous' ? (
        <>
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/entrar" replace state={{ from: location.pathname }} />} />
        </>
      ) : (
        <Route element={<AppLayout />}>
          <Route path="/entrar" element={<Navigate to={location.state?.from ?? '/'} replace />} />
          <Route index element={<HomePage />} />
          <Route path="configuracoes/usuarios" element={<Guarded permission="core.users.read" Component={UsersPage} />} />
          <Route path="configuracoes/papeis" element={<Guarded permission="core.access.read" Component={RolesPage} />} />
          <Route path="configuracoes/auditoria" element={<Guarded permission="core.audit.read" Component={AuditPage} />} />
          <Route path="configuracoes/campos-de-clientes" element={<Guarded permission="core.customers.fields" Component={CustomFieldsPage} />} />
          <Route path="clientes" element={<Guarded permission="core.customers.read" Component={CustomersPage} />} />
          <Route path="clientes/:id" element={<Guarded permission="core.customers.read" Component={CustomerPage} />} />
          <Route path="financeiro" element={<Guarded permission="core.finance.read" Component={FinanceOverviewPage} />} />
          <Route path="financeiro/lancamentos" element={<Guarded permission="core.finance.read" Component={FinanceEntriesPage} />} />
          <Route path="financeiro/cadastros" element={<Guarded permission="core.finance.manage" Component={FinanceRegistryPage} />} />
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
