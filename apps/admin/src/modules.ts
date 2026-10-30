import { SessionContext, type WebModule } from '@all/module-sdk/web';
import { useQuery } from '@tanstack/react-query';
import { useContext } from 'react';

/**
 * Telas dos módulos instalados, cada um em seu arquivo: o navegador só baixa as dos módulos
 * ativos na empresa (o ramo contratado, seus recursos e os módulos adicionais).
 */
const loaders: Record<string, () => Promise<WebModule>> = {
  'shared.notifications': () => import('@all/notifications/web').then((m) => m.notificationsWeb),
  'shared.service-orders': () => import('@all/service-orders/web').then((m) => m.serviceOrdersWeb),
  'shared.scheduling': () => import('@all/scheduling/web').then((m) => m.schedulingWeb),
  'shared.pets': () => import('@all/pets/web').then((m) => m.petsWeb),
  'shared.medical-records': () => import('@all/medical-records/web').then((m) => m.medicalRecordsWeb),
  'shared.sales': () => import('@all/sales/web').then((m) => m.salesWeb),
  'integration.payments': () => import('@all/payments/web').then((m) => m.paymentsWeb),
  'integration.whatsapp': () => import('@all/whatsapp/web').then((m) => m.whatsappWeb),
  'integration.banking': () => import('@all/banking/web').then((m) => m.bankingWeb),
  'integration.credit_bureau': () => import('@all/credit-bureau/web').then((m) => m.creditBureauWeb),
  'integration.fiscal': () => import('@all/fiscal/web').then((m) => m.fiscalWeb),
  laundry: () => import('@all/laundry/web').then((m) => m.laundryWeb),
  beauty: () => import('@all/beauty/web').then((m) => m.beautyWeb),
  petshop: () => import('@all/petshop/web').then((m) => m.petshopWeb),
  vet: () => import('@all/vet/web').then((m) => m.vetWeb),
  aesthetics: () => import('@all/aesthetics/web').then((m) => m.aestheticsWeb),
  orthodontics: () => import('@all/orthodontics/web').then((m) => m.orthodonticsWeb),
  bakery: () => import('@all/bakery/web').then((m) => m.bakeryWeb),
  legal: () => import('@all/legal/web').then((m) => m.legalWeb),
  vehicles: () => import('@all/vehicles/web').then((m) => m.vehiclesWeb),
  real_estate: () => import('@all/realestate/web').then((m) => m.realEstateWeb),
  consortium: () => import('@all/consortium/web').then((m) => m.consortiumWeb),
  accounting: () => import('@all/accounting/web').then((m) => m.accountingWeb),
  hr: () => import('@all/hr/web').then((m) => m.hrWeb),
  hr_consulting: () => import('@all/hr-consulting/web').then((m) => m.hrConsultingWeb),
  recruiting: () => import('@all/recruiting/web').then((m) => m.recruitingWeb),
  store: () => import('@all/store/web').then((m) => m.storeWeb),
};

/**
 * Carrega as telas dos módulos ativos na sessão. Ao contratar um módulo, a lista anterior
 * continua valendo até as telas novas chegarem, sem piscar a tela de carregamento.
 */
export function useWebModules() {
  const session = useContext(SessionContext);
  const keys = (session?.modules ?? []).map((m) => m.key).filter((key) => key in loaders).sort();
  return useQuery({
    queryKey: ['web-modules', keys.join(',')],
    queryFn: () => Promise.all(keys.map((key) => loaders[key]!())),
    enabled: !!session,
    staleTime: Infinity,
    gcTime: Infinity,
    placeholderData: (previous) => previous,
  });
}
