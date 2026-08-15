type Env = Record<string, string | undefined>;

export function validateEnv(config: Env): Env {
  const requiredKeys = [
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_SECRET',
    'FRONTEND_URL',
    'AI_SERVICE_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALLBACK_URL',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'STRIPE_SECRET_KEY',
  ];
  if (config.NODE_ENV === 'production') {
    requiredKeys.push('STRIPE_WEBHOOK_SECRET', 'SMTP_USER', 'SMTP_PASSWORD');
  }
  const missingKeys = requiredKeys.filter((key) => !config[key]);

  if (missingKeys.length > 0) {
    throw new Error(`Missing environment variables: ${missingKeys.join(', ')}`);
  }

  if (
    config.NODE_ENV === 'production' &&
    (config.JWT_SECRET === 'change-me' || config.JWT_SECRET!.length < 32)
  ) {
    throw new Error(
      'JWT_SECRET must be a non-placeholder value of at least 32 characters in production',
    );
  }

  if (config.NODE_ENV === 'production') {
    const placeholderKeys = [
      'GOOGLE_CLIENT_SECRET',
      'CLOUDINARY_API_SECRET',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'SMTP_PASSWORD',
    ].filter((key) => config[key] === 'change-me');
    if (placeholderKeys.length > 0) {
      throw new Error(
        `Production secrets still use placeholder values: ${placeholderKeys.join(', ')}`,
      );
    }
  }

  return config;
}
