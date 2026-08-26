import { validateEnv } from './env.validation';

const validConfig = {
  DATABASE_URL: 'postgresql://localhost/nexus',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(64),
  FRONTEND_URL: 'http://localhost:3001',
  AI_SERVICE_URL: 'http://localhost:8000',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3000/api/auth/google/callback',
  CLOUDINARY_CLOUD_NAME: 'cloud',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
  STRIPE_SECRET_KEY: 'stripe-secret',
  EVALUATION_SANDBOX_MODE: 'http',
  GITHUB_TOKEN: 'github-token',
  GITHUB_OWNER: 'nexus-owner',
  GITHUB_WEBHOOK_SECRET: 'github-webhook-secret',
  TWILIO_ACCOUNT_SID: 'AC123',
  TWILIO_AUTH_TOKEN: 'twilio-token',
  TWILIO_VERIFY_SERVICE_SID: 'VA123',
  CLAMAV_HOST: 'clamav',
};

describe('environment validation', () => {
  it('reports integrations that would otherwise fail during startup', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        GOOGLE_CLIENT_SECRET: undefined,
        STRIPE_SECRET_KEY: undefined,
      }),
    ).toThrow('GOOGLE_CLIENT_SECRET, STRIPE_SECRET_KEY');
  });

  it('requires isolated artifact evaluation in production', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        NODE_ENV: 'production',
        STRIPE_WEBHOOK_SECRET: 'webhook-secret',
        SMTP_USER: 'smtp-user',
        SMTP_PASSWORD: 'smtp-password',
      }),
    ).toThrow('EVALUATION_SANDBOX_MODE must be kubernetes');
  });

  it('rejects weak or placeholder production secrets', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        NODE_ENV: 'production',
        JWT_SECRET: 'change-me',
        STRIPE_WEBHOOK_SECRET: 'webhook-secret',
        SMTP_USER: 'smtp-user',
        SMTP_PASSWORD: 'smtp-password',
      }),
    ).toThrow('JWT_SECRET must be a non-placeholder value');
  });

  it('does not require Twilio when phone verification is disabled', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        NODE_ENV: 'production',
        EVALUATION_SANDBOX_MODE: 'kubernetes',
        STRIPE_WEBHOOK_SECRET: 'webhook-secret',
        SMTP_USER: 'smtp-user',
        SMTP_PASSWORD: 'smtp-password',
        PHONE_VERIFICATION_REQUIRED: 'false',
        TWILIO_ACCOUNT_SID: undefined,
        TWILIO_AUTH_TOKEN: undefined,
        TWILIO_VERIFY_SERVICE_SID: undefined,
      }),
    ).not.toThrow();
  });

  it('requires Twilio when phone verification is explicitly enabled', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        NODE_ENV: 'production',
        EVALUATION_SANDBOX_MODE: 'kubernetes',
        STRIPE_WEBHOOK_SECRET: 'webhook-secret',
        SMTP_USER: 'smtp-user',
        SMTP_PASSWORD: 'smtp-password',
        PHONE_VERIFICATION_REQUIRED: 'true',
        TWILIO_ACCOUNT_SID: undefined,
        TWILIO_AUTH_TOKEN: undefined,
        TWILIO_VERIFY_SERVICE_SID: undefined,
      }),
    ).toThrow(
      'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID',
    );
  });

  it('requires a malware scanner for production document uploads', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        NODE_ENV: 'production',
        EVALUATION_SANDBOX_MODE: 'kubernetes',
        STRIPE_WEBHOOK_SECRET: 'webhook-secret',
        SMTP_USER: 'smtp-user',
        SMTP_PASSWORD: 'smtp-password',
        CLAMAV_HOST: undefined,
      }),
    ).toThrow('CLAMAV_HOST');
  });
});
