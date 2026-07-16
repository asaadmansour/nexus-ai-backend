import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { DatabaseExceptionFilter } from './common/filters/database-exception.filter';

function normalizeOrigin(value?: string) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, '');
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
    }),
  );
  app.useGlobalFilters(new DatabaseExceptionFilter());
  app.use(cookieParser());
  const configuredFrontendOrigin = normalizeOrigin(process.env.FRONTEND_URL);
  const corsOrigins = Array.from(
    new Set(
      [
        'http://localhost:3000',
        'http://localhost:3001',
        configuredFrontendOrigin,
      ].filter((origin): origin is string => Boolean(origin)),
    ),
  );

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
