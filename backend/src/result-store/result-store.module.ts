import { Module } from '@nestjs/common';
import { ResultStoreService } from './result-store.service';

@Module({
  providers: [ResultStoreService],
  exports: [ResultStoreService],
})
export class ResultStoreModule {}
