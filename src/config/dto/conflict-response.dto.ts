import { ApiProperty } from '@nestjs/swagger';

export class ConflictResponseDto {
  @ApiProperty({ example: 409 })
  statusCode!: number;

  @ApiProperty({
    example: 'Application with key "inspection-hub" already exists',
  })
  message!: string;

  @ApiProperty({ example: 'Conflict' })
  error!: string;
}
