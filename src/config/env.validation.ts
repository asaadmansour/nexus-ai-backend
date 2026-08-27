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
    requiredKeys.push(
      'STRIPE_WEBHOOK_SECRET',
      'SMTP_USER',
      'SMTP_PASSWORD',
      'EVALUATION_SANDBOX_MODE',
      'GITHUB_TOKEN',
      'GITHUB_OWNER',
      'GITHUB_WEBHOOK_SECRET',
    );
    if ((config.PHONE_VERIFICATION_REQUIRED ?? 'false') === 'true') {
      requiredKeys.push(
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_VERIFY_SERVICE_SID',
      );
    }
    if (
      (config.REQUIREMENTS_DOCUMENT_MALWARE_SCAN_REQUIRED ?? 'true') === 'true'
    ) {
      requiredKeys.push('CLAMAV_HOST');
    }
  }
  const missingKeys = requiredKeys.filter((key) => !config[key]);

  if (missingKeys.length > 0) {
    throw new Error(`Missing environment variables: ${missingKeys.join(', ')}`);
  }

  const frontendUrl = parseUrl(config.FRONTEND_URL!, 'FRONTEND_URL');
  const googleCallbackUrl = parseUrl(
    config.GOOGLE_CALLBACK_URL!,
    'GOOGLE_CALLBACK_URL',
  );
  if (googleCallbackUrl.pathname !== '/api/auth/google/callback') {
    throw new Error(
      'GOOGLE_CALLBACK_URL must end with /api/auth/google/callback',
    );
  }
  if (
    config.NODE_ENV === 'production' &&
    (frontendUrl.protocol !== 'https:' ||
      googleCallbackUrl.protocol !== 'https:')
  ) {
    throw new Error(
      'FRONTEND_URL and GOOGLE_CALLBACK_URL must use HTTPS in production',
    );
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
    if (config.EVALUATION_SANDBOX_MODE !== 'kubernetes') {
      throw new Error(
        'EVALUATION_SANDBOX_MODE must be kubernetes in production',
      );
    }
    const secretKeys = [
      'GOOGLE_CLIENT_SECRET',
      'CLOUDINARY_API_SECRET',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'SMTP_PASSWORD',
      'GITHUB_TOKEN',
      'GITHUB_WEBHOOK_SECRET',
    ];
    if ((config.PHONE_VERIFICATION_REQUIRED ?? 'false') === 'true') {
      secretKeys.push('TWILIO_AUTH_TOKEN');
    }
    const placeholderKeys = secretKeys.filter(
      (key) => config[key] === 'change-me',
    );
    if (placeholderKeys.length > 0) {
      throw new Error(
        `Production secrets still use placeholder values: ${placeholderKeys.join(', ')}`,
      );
    }
  }

  return config;
}

function parseUrl(value: string, key: string) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${key} must be a valid absolute URL`);
  }
}
