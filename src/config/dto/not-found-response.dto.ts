import { ApiProperty } from '@nestjs/swagger';

/**
 * NestJS default NotFoundException body shape.
 */
export class NotFoundResponseDto {
  @ApiProperty({
    description: 'HTTP status code',
    example: 404,
  })
  statusCode!: number;

  @ApiProperty({
    description: 'Human-readable error message',
    example: 'Application with key "does-not-exist" was not found',
  })
  message!: string;

  @ApiProperty({
    description: 'HTTP error label',
    example: 'Not Found',
  })
  error!: string;
}
