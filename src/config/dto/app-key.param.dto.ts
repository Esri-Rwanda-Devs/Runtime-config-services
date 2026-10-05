import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class AppKeyParamDto {
  @ApiProperty({
    name: 'appKey',
    description:
      'Stable application key used to retrieve runtime configuration.',
    example: 'education-mapping',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'appKey must be a lowercase kebab-case identifier (e.g. education-mapping)',
  })
  appKey!: string;
}
