import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { AnalyzeService } from './analyze.service';
import type {
  AnalyzeJobCreatedDto,
  AnalyzeJobStatusDto,
  AnalyzeRequestDto,
} from '../common/analysis.types';

@Controller()
export class AnalyzeController {
  constructor(private readonly analyzeService: AnalyzeService) {}

  @Post('analyze')
  async analyze(@Body() body: AnalyzeRequestDto): Promise<AnalyzeJobCreatedDto> {
    if (!body?.text || !body.text.trim()) {
      throw new BadRequestException('`text` is required');
    }

    return this.analyzeService.startAnalysis(body.text.trim());
  }

  @Get('analyze/:jobId')
  getAnalyzeStatus(@Param('jobId') jobId: string): AnalyzeJobStatusDto {
    const jobStatus = this.analyzeService.getAnalysisStatus(jobId);
    if (!jobStatus) {
      throw new NotFoundException('Job not found');
    }

    return jobStatus;
  }
}
