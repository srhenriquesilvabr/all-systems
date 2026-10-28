import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { isValidCnpj, isValidCpf, normalizeCnpj, normalizePhone, onlyDigits } from '../customers/br';
import type { Address } from '../customers/schema';
import { tenants } from '../db/schema';
import { TenantDb } from '../db/tenant-db';
import { FilesService, type UploadedFile } from '../files/files.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { checkLogo, LogoError } from './logo';

/** Dono lógico do arquivo do logo em `files`. Não sai pelo download genérico, só pela rota pública. */
export const LOGO_OWNER = 'company_logo';

export interface CompanyInput {
  name: string;
  legalName: string | null;
  document: string | null;
  stateRegistration: string | null;
  municipalRegistration: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  address: Address | null;
  brandColor: string | null;
}

/** Endereço público do logo. O `v` muda a cada logo novo, então o navegador pode guardar por muito tempo. */
export function companyLogoUrl(tenant: { slug: string | null; logoFileId: string | null }): string | null {
  return tenant.slug && tenant.logoFileId ? `/api/public/company/${tenant.slug}/logo?v=${tenant.logoFileId}` : null;
}

/** Contraste mínimo do texto branco sobre o botão (WCAG AA para texto normal). */
export const MIN_BUTTON_CONTRAST = 4.5;

/**
 * Contraste do texto branco sobre a cor (WCAG 2). O admin confere também a versão do tema
 * escuro, que ele mesmo calcula; aqui fica a garantia para quem chama a API direto.
 */
export function whiteTextContrast(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return 1.05 / (luminance + 0.05);
}

/** Dados cadastrais e marca (logo e cor) da empresa logada. */
@Injectable()
export class CompanyService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
  ) {
    files.protectOwner(LOGO_OWNER);
  }

  async get() {
    const { tenantId } = requestContext.require();
    const [row] = await this.tdb.run((tx) => tx.select().from(tenants).where(eq(tenants.id, tenantId)));
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Empresa não encontrada' });
    return toDto(row);
  }

  async update(input: Partial<CompanyInput>) {
    const { tenantId } = requestContext.require();
    const data = normalize(input);
    return this.tdb.run(async (tx) => {
      const [before] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update');
      if (!before) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Empresa não encontrada' });
      if (!Object.keys(data).length) return toDto(before);
      const [row] = await tx.update(tenants).set(data).where(eq(tenants.id, tenantId)).returning();
      const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(data[k] ?? null));
      if (changed.length) {
        await this.audit.log(tx, {
          action: 'company.updated',
          entity: 'tenant',
          entityId: tenantId,
          data: { changed, ...(changed.includes('brandColor') && { brandColor: { from: before.brandColor, to: data.brandColor } }) },
        });
      }
      return toDto(row!);
    });
  }

  async setLogo(file: UploadedFile) {
    const { tenantId } = requestContext.require();
    let checked: ReturnType<typeof checkLogo>;
    try {
      checked = checkLogo(file);
    } catch (err) {
      if (err instanceof LogoError) throw new BadRequestException({ code: err.code, message: err.message });
      throw err;
    }
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[checked.mime];
    return this.tdb.run(async (tx) => {
      // Trava a linha da empresa: dois envios ao mesmo tempo não deixam logo órfão.
      const [current] = await tx.select({ logoFileId: tenants.logoFileId }).from(tenants).where(eq(tenants.id, tenantId)).for('update');
      const saved = await this.files.saveCheckedInTx(
        tx,
        { buffer: checked.content, mimetype: checked.mime, size: checked.content.length, originalname: `logo.${ext}` },
        { entity: LOGO_OWNER, id: tenantId },
      );
      const [row] = await tx.update(tenants).set({ logoFileId: saved.id }).where(eq(tenants.id, tenantId)).returning();
      await this.audit.log(tx, { action: 'company.logo_updated', entity: 'tenant', entityId: tenantId, data: { fileId: saved.id, mime: saved.mime, size: saved.size } });
      // Por último: o conteúdo do logo anterior sai do storage na hora (não volta com rollback).
      if (current?.logoFileId) await this.removeLogoFile(tx, current.logoFileId, tenantId);
      return toDto(row!);
    });
  }

  async removeLogo() {
    const { tenantId } = requestContext.require();
    await this.tdb.run(async (tx) => {
      const [current] = await tx.select({ logoFileId: tenants.logoFileId }).from(tenants).where(eq(tenants.id, tenantId)).for('update');
      if (!current?.logoFileId) return;
      await tx.update(tenants).set({ logoFileId: null }).where(eq(tenants.id, tenantId));
      await this.audit.log(tx, { action: 'company.logo_removed', entity: 'tenant', entityId: tenantId, data: { fileId: current.logoFileId } });
      await this.removeLogoFile(tx, current.logoFileId, tenantId);
    });
  }

  /** Empresa e arquivo do logo pelo endereço público (sem login). `null` = sem logo. */
  async publicLogo(slug: string) {
    const tenant = await this.tenancy.tenantBySlug(slug);
    if (!tenant?.logoFileId) return null;
    return { tenantId: tenant.id, fileId: tenant.logoFileId };
  }

  /** Conteúdo do logo, no escopo da empresa dona (o RLS de `files` exige o tenant). */
  openLogo(tenantId: string, fileId: string) {
    return requestContext.run({ tenantId }, () => this.files.open(fileId, LOGO_OWNER));
  }

  private async removeLogoFile(tx: Tx, fileId: string, tenantId: string) {
    await this.files.removeInTx(tx, fileId, { entity: LOGO_OWNER, id: tenantId }).catch((err: unknown) => {
      // Arquivo já apagado: só o vínculo importa.
      if (!(err instanceof NotFoundException)) throw err;
    });
  }
}

function toDto(row: typeof tenants.$inferSelect) {
  return {
    name: row.name,
    slug: row.slug,
    legalName: row.legalName,
    document: row.document,
    stateRegistration: row.stateRegistration,
    municipalRegistration: row.municipalRegistration,
    email: row.email,
    phone: row.phone,
    website: row.website,
    instagram: row.instagram,
    address: row.address ?? null,
    brandColor: row.brandColor,
    logoUrl: companyLogoUrl(row),
  };
}

/**
 * Normaliza documento, telefone, site e Instagram e recusa o que não confere. Só os campos
 * enviados entram no resultado (PATCH): ausente = mantém, nulo = apaga.
 */
function normalize(input: Partial<CompanyInput>): Partial<CompanyInput> {
  const errors: string[] = [];

  let document: string | null = null;
  if (input.document) {
    const digits = onlyDigits(input.document);
    const cnpj = normalizeCnpj(input.document);
    if (cnpj.length === 14) {
      if (isValidCnpj(cnpj)) document = cnpj;
      else errors.push('document: CNPJ inválido');
    } else if (digits.length === 11 && digits === cnpj) {
      if (isValidCpf(digits)) document = digits;
      else errors.push('document: CPF inválido');
    } else errors.push('document: informe um CPF (11 dígitos) ou CNPJ (14 caracteres)');
  }

  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone) errors.push('phone: telefone inválido (inclua o DDD)');

  let website: string | null = null;
  if (input.website) {
    const raw = /^https?:\/\//i.test(input.website) ? input.website : `https://${input.website}`;
    try {
      const url = new URL(raw);
      if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) throw new Error();
      website = url.href.replace(/\/$/, '');
    } catch {
      errors.push('website: endereço inválido');
    }
  }

  let instagram: string | null = null;
  if (input.instagram) {
    const handle = input.instagram
      .trim()
      .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '')
      .replace(/^@/, '')
      .replace(/[/?#].*$/, '');
    if (/^[A-Za-z0-9._]{1,30}$/.test(handle)) instagram = handle.toLowerCase();
    else errors.push('instagram: informe o usuário (ex.: @suaempresa)');
  }

  const brandColor = input.brandColor ? input.brandColor.toLowerCase() : null;
  if (brandColor && whiteTextContrast(brandColor) < MIN_BUTTON_CONTRAST) {
    errors.push('brandColor: cor clara demais, o texto branco dos botões fica ilegível. Escolha um tom mais escuro');
  }

  if (errors.length) throw new BadRequestException({ code: 'VALIDATION', message: errors });

  const address = input.address && Object.values(input.address).some(Boolean) ? cleanAddress(input.address) : null;
  const all: CompanyInput = {
    name: input.name ?? '',
    legalName: input.legalName ?? null,
    document,
    stateRegistration: input.stateRegistration ?? null,
    municipalRegistration: input.municipalRegistration ?? null,
    email: input.email ? input.email.toLowerCase() : null,
    phone,
    website,
    instagram,
    address,
    brandColor,
  };
  return Object.fromEntries(Object.entries(all).filter(([k]) => input[k as keyof CompanyInput] !== undefined));
}

function cleanAddress(address: Address): Address {
  const out: Address = {};
  for (const [k, v] of Object.entries(address) as [keyof Address, string | undefined][]) if (v) out[k] = v;
  if (out.zip) out.zip = onlyDigits(out.zip).replace(/^(\d{5})(\d{3})$/, '$1-$2');
  if (out.state) out.state = out.state.toUpperCase();
  return out;
}
