import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyzeModule } from './analyze/analyze.module';
import { WorkerModule } from './worker/worker.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AnalyzeModule, WorkerModule],
})
export class AppModule {}
