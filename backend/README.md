# AI Text Analysis Agent - Backend

NestJS backend for the Text -> Structured Report pipeline.

## Architecture

- `POST /analyze` receives free text and creates a job.
- `LlmService` decides which tasks to execute:
  - `summarize`
  - `extract_keywords`
  - `classify`
  - `suggest_improvements`
- Each task is published to RabbitMQ queue `text_tasks`.
- `WorkerService` consumes tasks and executes each prompt via Groq.
- `ResultStoreService` tracks job states (`queued`, `processing`, `completed`, `failed`) and stores final aggregated result.

## Prerequisites

- Node.js 20+
- RabbitMQ
- Groq API key

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

3. Start RabbitMQ from repository root:

```bash
docker compose up -d
```

4. Start backend:

```bash
npm run start:dev
```

## API Contract

### `POST /analyze`

Request:

```json
{
  "text": "some input"
}
```

Response:

```json
{
  "jobId": "uuid",
  "status": "queued"
}
```

### `GET /analyze/:jobId`

Response while processing:

```json
{
  "jobId": "uuid",
  "status": "processing",
  "progress": {
    "completed": 2,
    "total": 4
  }
}
```

Response when complete:

```json
{
  "jobId": "uuid",
  "status": "completed",
  "progress": {
    "completed": 4,
    "total": 4
  },
  "result": {
    "summary": "...",
    "keywords": ["..."],
    "category": "...",
    "suggestions": ["...", "..."]
  }
}
```

## Environment Variables

- `PORT` (default `3000`)
- `FRONTEND_ORIGIN` (default `http://localhost:5173`)
- `RABBITMQ_URL` (default `amqp://guest:guest@localhost:5672`)
- `GROQ_API_KEY` (required)
- `GROQ_MODEL` (default `llama-3.1-8b-instant`)
