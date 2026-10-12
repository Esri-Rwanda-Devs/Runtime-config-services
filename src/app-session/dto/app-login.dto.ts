import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class AppKeyBodyDto {
  @ApiProperty({ example: 'infrastructure-mapping' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'appKey must be a lowercase kebab-case identifier',
  })
  appKey!: string;
}

export class AppLoginBodyDto extends AppKeyBodyDto {
  @ApiProperty({ description: 'Portal username of the signing-in user' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  username!: string;

  @ApiProperty({ description: 'Portal password (verified, never stored)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;
}

export class OptionalAppKeyQueryDto {
  @ApiPropertyOptional({ example: 'infrastructure-mapping' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'appKey must be a lowercase kebab-case identifier',
  })
  appKey?: string;
}
