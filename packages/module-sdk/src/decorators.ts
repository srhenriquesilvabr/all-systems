import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'all:public';
export const MODULE_KEY = 'all:module';
export const PERMISSIONS_KEY = 'all:permissions';

/** Rota sem autenticação (login, recuperação de senha). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** A rota pertence a este módulo: responde 403 MODULE_NOT_ENABLED se o tenant não o contratou. */
export const ModuleRoute = (moduleKey: string) => SetMetadata(MODULE_KEY, moduleKey);

/** Exige todas as permissões listadas. */
export const RequirePermission = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
