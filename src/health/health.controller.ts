import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthResponseDto } from './dto/health-response.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Health check',
    description: 'Lightweight deployment health probe.',
  })
  @ApiOkResponse({
    description: 'Service is healthy.',
    type: HealthResponseDto,
  })
  check(): HealthResponseDto {
    return { status: 'ok' };
  }
}
