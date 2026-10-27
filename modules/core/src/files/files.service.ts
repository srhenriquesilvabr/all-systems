import type { Tx } from '@all/db';
import { uuidv7 } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { TenantDb } from '../db/tenant-db';
import { files } from './schema';
import { FileStorage } from './storage';

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_TYPES = new Set([...IMAGE_TYPES, 'application/pdf']);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export type FileDto = { id: string; filename: string; mime: string; size: number; createdAt: Date };

@Injectable()
export class FilesService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly storage: FileStorage,
  ) {}

  private readonly protectedOwners = new Set<string>();

  /**
   * Arquivos desse tipo de dono não saem pelo download genérico (/files/:id): só pelo módulo dono,
   * que confere a permissão e registra o acesso (ex.: anexos de prontuário).
   */
  protectOwner(entity: string) {
    this.protectedOwners.add(entity);
  }

  /** Grava uma imagem ligada a um dono (ex.: peça da lavanderia), dentro da transação de quem chama. */
  saveImageInTx(tx: Tx, file: UploadedFile, owner: { entity: string; id: string }): Promise<FileDto> {
    if (!IMAGE_TYPES.has(file.mimetype)) {
      throw new BadRequestException({ code: 'INVALID_FILE_TYPE', message: 'Envie uma imagem JPG, PNG ou WebP' });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'A imagem pode ter no máximo 8 MB' });
    }
    return this.store(tx, file, owner);
  }

  /** Imagem ou PDF (exames, laudos, termos assinados). */
  saveDocumentInTx(tx: Tx, file: UploadedFile, owner: { entity: string; id: string }): Promise<FileDto> {
    if (!DOCUMENT_TYPES.has(file.mimetype)) {
      throw new BadRequestException({ code: 'INVALID_FILE_TYPE', message: 'Envie uma imagem (JPG, PNG, WebP) ou um PDF' });
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'O arquivo pode ter no máximo 15 MB' });
    }
    return this.store(tx, file, owner);
  }

  private async store(tx: Tx, file: UploadedFile, owner: { entity: string; id: string }): Promise<FileDto> {
    const { tenantId, userId } = requestContext.requireTenant();
    const id = uuidv7();
    const now = new Date();
    const storageKey = `${tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;

    // Grava primeiro o conteúdo: se a transação falhar depois, sobra um arquivo órfão (limpável),
    // nunca um registro apontando para o nada.
    await this.storage.put(storageKey, file.buffer, file.mimetype);
    const [row] = await tx
      .insert(files)
      .values({
        id,
        tenantId,
        ownerEntity: owner.entity,
        ownerId: owner.id,
        filename: file.originalname.slice(0, 200),
        mime: file.mimetype,
        size: file.size,
        storageKey,
        createdBy: userId ?? null,
      })
      .returning();
    return toDto(row!);
  }

  async listByOwners(tx: Tx, entity: string, ownerIds: string[]): Promise<(FileDto & { ownerId: string })[]> {
    if (!ownerIds.length) return [];
    const rows = await tx
      .select()
      .from(files)
      .where(and(eq(files.ownerEntity, entity), inArray(files.ownerId, ownerIds)))
      .orderBy(asc(files.createdAt));
    return rows.map((r) => ({ ...toDto(r), ownerId: r.ownerId }));
  }

  /**
   * Conteúdo para download. O RLS garante que só arquivos do tenant atual são encontrados.
   * Arquivos de donos protegidos só abrem informando o tipo de dono (o módulo dono é quem chama,
   * e confere o ownerId devolvido).
   */
  async open(id: string, ownerEntity?: string) {
    const [row] = await this.tdb.run((tx) => tx.select().from(files).where(eq(files.id, id)));
    const allowed = ownerEntity ? row?.ownerEntity === ownerEntity : row && !this.protectedOwners.has(row.ownerEntity);
    if (!row || !allowed) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Arquivo não encontrado' });
    return { file: toDto(row), ownerId: row.ownerId, stream: await this.storage.read(row.storageKey) };
  }

  async removeInTx(tx: Tx, id: string, owner: { entity: string; id: string }) {
    const [row] = await tx
      .delete(files)
      .where(and(eq(files.id, id), eq(files.ownerEntity, owner.entity), eq(files.ownerId, owner.id)))
      .returning();
    if (!row) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Arquivo não encontrado' });
    await this.storage.remove(row.storageKey);
  }
}

const toDto = (r: typeof files.$inferSelect): FileDto => ({ id: r.id, filename: r.filename, mime: r.mime, size: r.size, createdAt: r.createdAt });
