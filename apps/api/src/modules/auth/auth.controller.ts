// SPDX-License-Identifier: AGPL-3.0-only
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { NodeRequest, NodeResponse } from '@nestjs/platform-node';
import { createZodDto } from 'nestjs-zod';

import type { MeResponse, SessionDto } from '@app/shared';
import {
  emailTokenRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
  signupRequestSchema,
  updateMeRequestSchema,
} from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../../common/config';
import { RateLimit } from '../../common/security/rate-limit';
import { AccountRecoveryService } from './account-recovery.service';
import { AuthService } from './auth.service';
import { clearedCookies, readCookie, REFRESH_COOKIE, sessionCookies } from './cookies';
import { CurrentPrincipal, Public } from './decorators';
import type { Principal } from './principal';
import type { SessionMeta } from './sessions.service';

class SignupDto extends createZodDto(signupRequestSchema) {}
class LoginDto extends createZodDto(loginRequestSchema) {}
class UpdateMeDto extends createZodDto(updateMeRequestSchema) {}
class EmailTokenDto extends createZodDto(emailTokenRequestSchema) {}
class ForgotPasswordDto extends createZodDto(forgotPasswordRequestSchema) {}
class ResetPasswordDto extends createZodDto(resetPasswordRequestSchema) {}

function metaOf(request: NodeRequest): SessionMeta {
  const agent = request.headers['user-agent'];
  return {
    userAgent: typeof agent === 'string' ? agent : '',
    ip: request.socket.remoteAddress ?? '',
  };
}

/** Spec §17.2. Verification and password recovery endpoints are added in Task 1.8. */
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly recovery: AccountRecoveryService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @RateLimit('signup')
  @Post('signup')
  async signup(@Body() body: SignupDto, @Req() request: NodeRequest): Promise<{ id: string }> {
    return this.auth.signup(body, metaOf(request));
  }

  @Public()
  @RateLimit('login')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() request: NodeRequest,
    @Res({ passthrough: true }) response: NodeResponse,
  ): Promise<MeResponse> {
    const result = await this.auth.login(body, metaOf(request));
    response.setHeader('Set-Cookie', sessionCookies(result, this.config));
    return result.me;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: NodeRequest,
    @Res({ passthrough: true }) response: NodeResponse,
  ): Promise<void> {
    await this.auth.logout(readCookie(request.headers.cookie, REFRESH_COOKIE));
    response.setHeader('Set-Cookie', clearedCookies());
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) response: NodeResponse,
  ): Promise<void> {
    await this.auth.logoutAll(principal);
    response.setHeader('Set-Cookie', clearedCookies());
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: NodeRequest,
    @Res({ passthrough: true }) response: NodeResponse,
  ): Promise<{ ok: true }> {
    const tokens = await this.auth.refresh(
      readCookie(request.headers.cookie, REFRESH_COOKIE),
      metaOf(request),
    );
    response.setHeader('Set-Cookie', sessionCookies(tokens, this.config));
    return { ok: true };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: EmailTokenDto): Promise<{ ok: true }> {
    await this.recovery.verifyEmail(body.token);
    return { ok: true };
  }

  @Post('resend-verification')
  @RateLimit('forgot')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resendVerification(@CurrentPrincipal() principal: Principal): Promise<void> {
    await this.recovery.resendVerification(principal);
  }

  @Public()
  @Post('forgot-password')
  @RateLimit('forgot')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<{ ok: true }> {
    await this.recovery.forgotPassword(body.email);
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() body: ResetPasswordDto): Promise<{ ok: true }> {
    await this.recovery.resetPassword(body.token, body.password);
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentPrincipal() principal: Principal): Promise<MeResponse> {
    return this.auth.me(principal);
  }

  @Patch('me')
  async updateMe(
    @CurrentPrincipal() principal: Principal,
    @Body() body: UpdateMeDto,
    @Req() request: NodeRequest,
    @Res({ passthrough: true }) response: NodeResponse,
  ): Promise<MeResponse> {
    const result = await this.auth.updateMe(principal, body, metaOf(request));
    if (result.tokens !== null) {
      response.setHeader('Set-Cookie', sessionCookies(result.tokens, this.config));
    }
    return result.me;
  }

  @Get('sessions')
  async sessions(@CurrentPrincipal() principal: Principal): Promise<SessionDto[]> {
    return this.auth.listSessions(principal);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentPrincipal() principal: Principal,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    await this.auth.revokeSession(principal, sessionId);
  }
}
