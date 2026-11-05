export const SEO_AUDIT_QUEUE_NAME = 'seo-audit-queue';

export const AUDIT_JOB_NAMES = {
  CRAWL_AUDIT: 'crawl-audit',
};

export const auditJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  // Per-job processing timeout (ms)
  timeout: 60_000,
  removeOnComplete: {
    age: 3600,
    count: 100,
  },
  removeOnFail: {
    age: 24 * 3600,
    count: 200,
  },
};

export const auditWorkerOptions = {
  concurrency: 2,
  lockDuration: 90_000,
};

export function buildAuditCrawlJobId(auditId) {
  return `crawl-${auditId}`;
}
