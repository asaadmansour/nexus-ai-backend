import 'dotenv/config';
import { join } from 'path';
import { DataSource } from 'typeorm';

const useSsl = (process.env.DATABASE_SSL ?? 'true') === 'true';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
});
