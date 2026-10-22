// Só as tabelas do core, sem Nest: outros módulos referenciam (FKs) daqui, e o drizzle-kit
// carrega estes arquivos ao gerar migrations.
export * from './db/schema';
export * from './customers/schema';
export * from './finance/schema';
export * from './events/schema';
