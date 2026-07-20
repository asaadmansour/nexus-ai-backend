import 'dotenv/config';

export function areQueuesEnabled(): boolean {
  return (process.env.QUEUES_ENABLED ?? 'true').toLowerCase() !== 'false';
}
