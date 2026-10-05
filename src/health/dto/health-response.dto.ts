import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({
    description: 'Service health status',
    example: 'ok',
  })
  status!: string;
}
