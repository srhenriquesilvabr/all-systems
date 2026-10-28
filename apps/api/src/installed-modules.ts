import { coreManifests } from '@all/core';
import { BankingModule, bankingManifest } from '@all/banking';
import { VehiclesModule, vehiclesManifest } from '@all/vehicles';
import { RealEstateModule, realEstateManifest } from '@all/realestate';
import { ConsortiumModule, consortiumManifest } from '@all/consortium';
import { AccountingModule, accountingManifest } from '@all/accounting';
import { HrModule, hrManifest } from '@all/hr';
import { HrConsultingModule, hrConsultingManifest } from '@all/hr-consulting';
import { BakeryModule, bakeryManifest } from '@all/bakery';
import { BeautyModule, beautyManifest } from '@all/beauty';
import { AestheticsModule, aestheticsManifest } from '@all/aesthetics';
import { LaundryModule, laundryManifest } from '@all/laundry';
import { LegalModule, legalManifest } from '@all/legal';
import { MedicalRecordsModule, medicalRecordsManifest } from '@all/medical-records';
import { NotificationsModule, notificationsManifest } from '@all/notifications';
import { OrthodonticsModule, orthodonticsManifest } from '@all/orthodontics';
import { PaymentsModule, paymentsManifest } from '@all/payments';
import { PetsModule, petsManifest } from '@all/pets';
import { PetshopModule, petshopManifest } from '@all/petshop';
import { SalesModule, salesManifest } from '@all/sales';
import { SchedulingModule, schedulingManifest } from '@all/scheduling';
import { ServiceOrdersModule, serviceOrdersManifest } from '@all/service-orders';
import { VetModule, vetManifest } from '@all/vet';
import { WhatsAppModule, whatsappManifest } from '@all/whatsapp';
import { RecruitingModule, recruitingManifest } from '@all/recruiting';

/**
 * Módulos instalados nesta build. Para adicionar uma vertical: criar o pacote em
 * modules/verticals/, registrar o manifesto e o Nest module aqui e as telas em apps/admin/src/modules.ts.
 * O que cada tenant usa é decidido em runtime (tabela tenant_modules).
 */
export const manifests = [
  ...coreManifests,
  notificationsManifest,
  serviceOrdersManifest,
  schedulingManifest,
  petsManifest,
  medicalRecordsManifest,
  salesManifest,
  paymentsManifest,
  whatsappManifest,
  bankingManifest,
  laundryManifest,
  beautyManifest,
  petshopManifest,
  vetManifest,
  aestheticsManifest,
  orthodonticsManifest,
  bakeryManifest,
  legalManifest,
  vehiclesManifest,
  realEstateManifest,
  consortiumManifest,
  accountingManifest,
  hrManifest,
  // Consultoria de RH: empresas atendidas e honorários (estende o RH pelo HrEmployersRegistry).
  hrConsultingManifest,
  // Head hunter: vagas, candidaturas e funil com nota de aderência (contratável por qualquer ramo).
  recruitingManifest,
];

export const featureModules = [NotificationsModule, ServiceOrdersModule, SchedulingModule, PetsModule, MedicalRecordsModule, SalesModule, PaymentsModule, WhatsAppModule, BankingModule, LaundryModule, BeautyModule, PetshopModule, VetModule, AestheticsModule, OrthodonticsModule, BakeryModule, LegalModule, VehiclesModule, RealEstateModule, ConsortiumModule, AccountingModule, HrModule, HrConsultingModule, RecruitingModule];
