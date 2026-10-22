export interface Address {
  zip?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
}

export interface Customer {
  id: string;
  type: 'person' | 'company';
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  address: Address | null;
  notes: string | null;
  customFields: Record<string, unknown>;
  anonymizedAt: string | null;
  createdAt: string;
}

export type ConsentPurpose = 'service_notifications' | 'marketing_email' | 'marketing_whatsapp';

export interface CustomerDetail extends Customer {
  consents: Partial<Record<ConsentPurpose, { granted: boolean; at: string; source: string }>>;
}

export interface CustomField {
  id: string;
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'select';
  options: string[] | null;
  required: boolean;
  position: number;
}

export interface Duplicate {
  id: string;
  name: string;
  matchedOn: ('document' | 'email' | 'phone')[];
}
