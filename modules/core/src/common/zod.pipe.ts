import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, infer as Infer } from 'zod';

/** `@Body(new ZodPipe(schema)) body` — valida e devolve o dado já tipado e normalizado. */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, Infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): Infer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION',
        message: result.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)),
      });
    }
    return result.data;
  }
}
