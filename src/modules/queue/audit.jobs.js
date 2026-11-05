import ApiError from '../../utils/ApiError.js';
import {
  AUDIT_JOB_NAMES,
  buildAuditCrawlJobId,
} from '../../config/queue.js';
import { getAuditQueue } from './audit.queue.js';

const ACTIVE_STATES = new Set(['waiting', 'active', 'delayed', 'paused', 'waiting-children']);

/**
 * Enqueue a crawl job for an audit. Uses a deterministic jobId to prevent duplicates.
 */
export async function enqueueAuditCrawlJob({
  auditId,
  siteId,
  clientId,
  crawlConfig = {},
  requestedBy = null,
}) {
  const queue = getAuditQueue();
  const jobId = buildAuditCrawlJobId(auditId);

  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (ACTIVE_STATES.has(state)) {
      throw new ApiError(409, 'Audit crawl already in progress');
    }

    // Allow re-queue after completed/failed by removing stale job id
    try {
      await existing.remove();
    } catch {
      // If remove races, fall through and let add() fail clearly
    }
  }

  const job = await queue.add(
    AUDIT_JOB_NAMES.CRAWL_AUDIT,
    {
      auditId,
      siteId,
      clientId,
      crawlConfig,
      requestedBy,
      enqueuedAt: new Date().toISOString(),
    },
    {
      jobId,
    }
  );

  return {
    jobId: job.id,
    name: job.name,
    auditId,
  };
}

/**
 * List jobs associated with an audit (deterministic crawl job id).
 */
export async function getAuditJobs(auditId) {
  const queue = getAuditQueue();
  const jobId = buildAuditCrawlJobId(auditId);
  const job = await queue.getJob(jobId);

  if (!job) {
    return [];
  }

  const state = await job.getState();
  const progress =
    typeof job.progress === 'number'
      ? job.progress
      : Number(job.progress) || 0;

  return [
    {
      auditId,
      jobId: job.id,
      name: job.name,
      status: state,
      progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason
        ? sanitizeJobError(job.failedReason)
        : null,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      processedAt: job.processedOn
        ? new Date(job.processedOn).toISOString()
        : null,
      completedAt: job.finishedOn
        ? new Date(job.finishedOn).toISOString()
        : null,
    },
  ];
}

function sanitizeJobError(message) {
  const text = String(message || '');
  // Avoid leaking stack / connection strings
  return text.split('\n')[0].slice(0, 300);
}
