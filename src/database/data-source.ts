import 'dotenv/config';
import { DataSource } from 'typeorm';

const useSsl = (process.env.DATABASE_SSL ?? 'true') === 'true';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
});
