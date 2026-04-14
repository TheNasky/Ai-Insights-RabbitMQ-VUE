# AI Insights Platform (web)

Vue 3 + TypeScript + Vite client for the AI Insights Platform. npm package name: `ai-insights-web`.

## Purpose

This app provides the user interface for:

- Submitting free-form text to `POST /analyze`
- Showing loading/error states
- Displaying a structured report:
  - summary
  - keywords
  - category
  - suggestions

## Tech

- Vue 3 (`<script setup>`)
- TypeScript
- Vite
- Tailwind CSS

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

3. Start local development:

```bash
npm run dev
```

4. Build for production:

```bash
npm run build
```

## Environment Variables

- `VITE_API_BASE_URL`: backend base URL (default: `http://localhost:3000`)
