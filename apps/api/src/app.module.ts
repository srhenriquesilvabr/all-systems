import { CoreModule, type CoreModuleOptions } from '@all/core';
import { DynamicModule, Module } from '@nestjs/common';
import { featureModules, manifests } from './installed-modules';

type RuntimeOptions = Pick<CoreModuleOptions, 'storage' | 'syncModulesOnBoot'>;

@Module({})
export class AppModule {
  static forRoot(env: Record<string, string | undefined> = process.env, runtime: RuntimeOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot({ manifests, env, ...runtime }), ...featureModules],
    };
  }
}
