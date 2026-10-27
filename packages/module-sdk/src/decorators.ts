import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'all:public';
export const MODULE_KEY = 'all:module';
export const PERMISSIONS_KEY = 'all:permissions';
export const ANY_PERMISSION_KEY = 'all:any-permission';

/** Rota sem autenticação (login, recuperação de senha). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** A rota pertence a este módulo: responde 403 MODULE_NOT_ENABLED se o tenant não o contratou. */
export const ModuleRoute = (moduleKey: string) => SetMetadata(MODULE_KEY, moduleKey);

/** Exige todas as permissões listadas. */
export const RequirePermission = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Exige ao menos uma das permissões listadas (ex.: o caixa e o estoquista consultam produtos). */
export const RequireAnyPermission = (...permissions: string[]) => SetMetadata(ANY_PERMISSION_KEY, permissions);
