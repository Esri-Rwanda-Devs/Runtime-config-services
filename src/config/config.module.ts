import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { ThemeController } from './theme.controller';

@Module({
  controllers: [ConfigController, ThemeController],
  providers: [ConfigService],
})
export class ConfigModule {}
