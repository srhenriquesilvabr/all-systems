import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/** Onde o conteúdo dos arquivos fica: disco local em dev e testes, R2 em produção (prefixo por tenant). */
export abstract class FileStorage {
  abstract put(key: string, content: Buffer, mime: string): Promise<void>;
  abstract read(key: string): Promise<Readable>;
  abstract remove(key: string): Promise<void>;
}

/** Disco local, para desenvolvimento e testes. */
export class LocalDiskStorage extends FileStorage {
  constructor(private readonly root: string) {
    super();
  }

  async put(key: string, content: Buffer): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }

  async read(key: string): Promise<Readable> {
    return createReadStream(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  /** As chaves são geradas pelo sistema, mas o caminho é conferido para nunca sair da raiz. */
  private resolve(key: string) {
    const file = path.resolve(this.root, key);
    if (!file.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Chave de arquivo inválida');
    return file;
  }
}

/** O que usamos do binding R2 do Cloudflare (bucket privado; o download passa sempre pela API). */
export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream } | null>;
  delete(key: string): Promise<void>;
}

export class R2Storage extends FileStorage {
  constructor(private readonly bucket: R2BucketLike) {
    super();
  }

  async put(key: string, content: Buffer, mime: string): Promise<void> {
    await this.bucket.put(key, content, { httpMetadata: { contentType: mime } });
  }

  async read(key: string): Promise<Readable> {
    const object = await this.bucket.get(key);
    if (!object) throw new Error(`Arquivo ausente no storage: ${key}`);
    return Readable.fromWeb(object.body as WebReadableStream);
  }

  async remove(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
