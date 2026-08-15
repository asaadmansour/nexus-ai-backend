// E2E tests exercise the HTTP application without starting persistent BullMQ
// workers. Queue behavior has focused unit/integration coverage of its own.
process.env.QUEUES_ENABLED = 'false';
