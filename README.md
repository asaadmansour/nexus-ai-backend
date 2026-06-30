# Nexus AI Backend

NestJS backend for the Nexus AI project.

## Requirements

- Node.js `24.x`
- npm `11.x`
- A Postgres database URL, for example from Supabase
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
DATABASE_URL="postgresql://..."
DATABASE_SSL=true
REDIS_URL="redis://..."
PORT=3000
```

Do not commit `.env`.

## Development

```bash
npm run start:dev
```

The app listens on `http://localhost:3000` by default.

## Database

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

Create a migration file when you are ready later:

```bash
npm run db:create -- src/database/migrations/CreateSprintOneTables
```

Generate a migration from entity changes later:

```bash
npm run db:generate -- src/database/migrations/CreateSprintOneTables
```

Run committed migrations later:

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
