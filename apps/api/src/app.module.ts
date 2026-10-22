import { CoreModule } from '@all/core';
import { DynamicModule, Module } from '@nestjs/common';
import { featureModules, manifests } from './installed-modules';

@Module({})
export class AppModule {
  static forRoot(env: Record<string, string | undefined> = process.env): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot({ manifests, env }), ...featureModules],
    };
  }
}
