import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { ConfigService } from './config.service';
import { AppKeyParamDto } from './dto/app-key.param.dto';
import { NotFoundResponseDto } from './dto/not-found-response.dto';
import { RuntimeConfigDocumentDto } from './dto/runtime-config.dto';

@ApiTags('Runtime Config')
@Controller('api/v1/config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get(':appKey')
  @ApiOperation({
    summary: 'Get runtime configuration by application key',
    description:
      'Returns the public runtime configuration JSON document for the given application key. The document is returned directly (no wrapper).',
  })
  @ApiParam({
    name: 'appKey',
    description:
      'Stable application key used to retrieve runtime configuration.',
    example: 'education-mapping',
  })
  @ApiOkResponse({
    description: 'Runtime configuration returned successfully.',
    type: RuntimeConfigDocumentDto,
  })
  @ApiNotFoundResponse({
    description: 'Application configuration not found.',
    type: NotFoundResponseDto,
  })
  getConfig(@Param() params: AppKeyParamDto): Promise<Prisma.JsonValue> {
    return this.configService.getConfigByAppKey(params.appKey);
  }
}
