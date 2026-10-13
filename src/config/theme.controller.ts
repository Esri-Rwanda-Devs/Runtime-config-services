import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from './config.service';
import { renderTypographyCss } from './typography-css';

@ApiTags('Runtime Config')
@Controller('api/v1/theme')
export class ThemeController {
  constructor(private readonly configService: ConfigService) {}

  @Get('typography.css')
  @Header('Content-Type', 'text/css; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Shared typography as a stylesheet',
    description:
      'CSS overrides built from the active "shared-theme" application\'s branding.typography, targeting the class names of the deployed apps (no rebuild needed). Returns a stylesheet with no rules when the shared theme is missing or invalid.',
  })
  @ApiOkResponse({
    description: 'text/css stylesheet.',
    content: { 'text/css': { schema: { type: 'string' } } },
  })
  async getTypographyCss(): Promise<string> {
    return renderTypographyCss(await this.configService.getSharedTypography());
  }
}
