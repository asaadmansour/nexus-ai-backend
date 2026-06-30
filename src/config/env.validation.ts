type Env = Record<string, string | undefined>;

export function validateEnv(config: Env): Env {
  const requiredKeys = ['DATABASE_URL'];
  const missingKeys = requiredKeys.filter((key) => !config[key]);

  if (missingKeys.length > 0) {
    throw new Error(`Missing environment variables: ${missingKeys.join(', ')}`);
  }

  return config;
}
