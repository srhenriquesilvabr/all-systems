import { aestheticsWeb } from '@all/aesthetics/web';
import { bakeryWeb } from '@all/bakery/web';
import { beautyWeb } from '@all/beauty/web';
import { laundryWeb } from '@all/laundry/web';
import { legalWeb } from '@all/legal/web';
import { medicalRecordsWeb } from '@all/medical-records/web';
import type { WebModule } from '@all/module-sdk/web';
import { bankingWeb } from '@all/banking/web';
import { vehiclesWeb } from '@all/vehicles/web';
import { realEstateWeb } from '@all/realestate/web';
import { consortiumWeb } from '@all/consortium/web';
import { accountingWeb } from '@all/accounting/web';
import { hrWeb } from '@all/hr/web';
import { hrConsultingWeb } from '@all/hr-consulting/web';
import { notificationsWeb } from '@all/notifications/web';
import { orthodonticsWeb } from '@all/orthodontics/web';
import { paymentsWeb } from '@all/payments/web';
import { petsWeb } from '@all/pets/web';
import { petshopWeb } from '@all/petshop/web';
import { salesWeb } from '@all/sales/web';
import { schedulingWeb } from '@all/scheduling/web';
import { serviceOrdersWeb } from '@all/service-orders/web';
import { vetWeb } from '@all/vet/web';
import { whatsappWeb } from '@all/whatsapp/web';
import { recruitingWeb } from '@all/recruiting/web';

/** Telas dos módulos instalados. Só as dos módulos ativos no tenant viram rotas. */
export const webModules: WebModule[] = [notificationsWeb, serviceOrdersWeb, schedulingWeb, petsWeb, medicalRecordsWeb, salesWeb, paymentsWeb, whatsappWeb, bankingWeb, laundryWeb, beautyWeb, petshopWeb, vetWeb, aestheticsWeb, orthodonticsWeb, bakeryWeb, legalWeb, vehiclesWeb, realEstateWeb, consortiumWeb, accountingWeb, hrWeb, hrConsultingWeb, recruitingWeb];
