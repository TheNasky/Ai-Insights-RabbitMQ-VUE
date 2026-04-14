import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AnalyzeController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/analyze (POST) should require text', () => {
    return request(app.getHttpServer())
      .post('/analyze')
      .send({ text: '' })
      .expect(400);
  });

  afterEach(async () => {
    await app.close();
  });
});
