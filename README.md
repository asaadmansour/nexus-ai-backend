# Nexus AI Backend

NestJS backend for the Nexus AI project.

## Requirements

- Node.js `24.x`
- npm `11.x`
- PostgreSQL 17 with the `pgvector`, `pgcrypto`, and `citext` extensions
- A Redis URL, for example from a hosted Redis provider

Use the pinned local version:

```bash
nvm use
```

Install dependencies from the lockfile:

```bash
npm ci
```

## Environment

Create a local `.env` file from the template:

```bash
cp .env.example .env
```

Then fill in:

```env
DATABASE_URL=postgresql://nexus:nexus_local@localhost:5432/nexus_ai
DATABASE_SSL=false
REDIS_URL="redis://..."
PORT=3001
```

Do not commit `.env`.

## Development

```bash
npm run start:dev
```

The app listens on `http://localhost:3001` with the supplied local environment.

## Database

For local development, start PostgreSQL with pgvector and Redis:

```bash
docker compose up -d postgres redis
npm run db:show
npm run db:migrate
```

If Docker is unavailable on macOS, install PostgreSQL and pgvector with
Homebrew:

```bash
brew install postgresql@17 pgvector redis
brew services start postgresql@17
brew services start redis
createdb nexus_ai
```

For the Homebrew database, use your macOS username in the local URL, for
example:

```env
DATABASE_URL=postgresql://your-user@localhost:5432/nexus_ai
DATABASE_SSL=false
REDIS_URL=redis://localhost:6379
```

Always inspect pending migrations before applying them:

```bash
npm run db:show
npm run db:migrate
npm run db:show
```

Do not use TypeORM schema synchronization. Committed migrations are the schema
source of truth.

TypeORM is configured through:

```txt
src/database/database.module.ts
src/database/data-source.ts
```

Entity classes should live inside feature folders when you add models later, for example:

```txt
src/users/entities/user.entity.ts
src/projects/entities/project.entity.ts
```

Create a migration file:

```bash
npm run db:create -- src/database/migrations/CreateSprintOneTables
```

Generate a migration from entity changes:

```bash
npm run db:generate -- src/database/migrations/CreateSprintOneTables
```

Run committed migrations:

```bash
npm run db:migrate
```

Revert the latest migration:

```bash
npm run db:revert
```

## Project Structure

```txt
src/
  main.ts
  app.module.ts
  common/       # shared guards, pipes, filters, interceptors, decorators
  config/       # environment/config validation
  database/     # TypeORM connection and CLI data source
  redis/        # Redis module and services
  <feature>/    # feature modules, controllers, services, DTOs
```

Prefer creating new features as Nest modules:

```bash
npx nest g module users
npx nest g controller users
npx nest g service users
```

## Checks

```bash
npm run build
npm run lint
npm run test
```
