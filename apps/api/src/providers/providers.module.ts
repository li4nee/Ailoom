// SPDX-License-Identifier: AGPL-3.0-only
import { type DynamicModule, type ModuleMetadata, Module, type Type } from '@nestjs/common';

import { Clock, SystemClock } from '../common/clock';
import { Llm } from './llm.service';
import { ProviderOps } from './provider-ops.service';
import { ProviderRegistry } from './registry';
import { CREDENTIAL_RESOLVER, type CredentialResolver } from './types';

export interface ProvidersModuleOptions {
  /** Modules the resolver's own dependencies come from. */
  imports?: ModuleMetadata['imports'];
  /** Loads credentials within a workspace; provided by the credentials feature. */
  resolver: Type<CredentialResolver>;
}

/** The model layer: `Llm` and `ProviderRegistry`. Needs the global `APP_CONFIG`. */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest dynamic module
export class ProvidersModule {
  static forRoot(options: ProvidersModuleOptions): DynamicModule {
    return {
      module: ProvidersModule,
      imports: options.imports ?? [],
      providers: [
        ProviderRegistry,
        ProviderOps,
        Llm,
        { provide: Clock, useClass: SystemClock },
        { provide: CREDENTIAL_RESOLVER, useClass: options.resolver },
      ],
      exports: [Llm, ProviderOps, ProviderRegistry],
    };
  }
}
