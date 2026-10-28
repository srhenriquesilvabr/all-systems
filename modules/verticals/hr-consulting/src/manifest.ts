import { defineModule } from '@all/module-sdk';

/**
 * Ramo das consultorias de RH. Por enquanto só o RH (colaboradores e folha da própria consultoria);
 * empresas-clientes e head hunter (vagas, candidatos) entram na próxima fase.
 */
export const hrConsultingManifest = defineModule({
  key: 'hr_consulting',
  name: 'Consultoria de RH',
  layer: 'vertical',
  description: 'Consultoria de RH e recrutamento: departamento pessoal hoje; empresas-clientes e head hunter em breve.',
  icon: 'user-search',
  version: '1.0.0',
  dependsOn: ['hr'],
});
