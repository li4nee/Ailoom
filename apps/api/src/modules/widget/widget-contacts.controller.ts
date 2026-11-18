// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Post } from '@nestjs/common';

import type { IdentifyContactResponse } from '@app/shared';

import { Public } from '../auth';
import { CurrentVisitor } from './current-visitor.decorator';
import type { CurrentVisitorData } from './widget-rate-limits';
import { WidgetService } from './widget.service';

/** The identified contact surface for the host application's widget integration. */
@Public()
@Controller('widget/v1/contacts')
export class WidgetContactsController {
  constructor(private readonly widget: WidgetService) {}

  @Post('identify')
  async identify(
    @CurrentVisitor() visitor: CurrentVisitorData,
    @Body() body: unknown,
  ): Promise<IdentifyContactResponse> {
    return this.widget.identify(visitor, body);
  }
}
