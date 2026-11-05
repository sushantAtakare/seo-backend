import { Queue } from 'bullmq';
import { getRedisOptions } from '../../config/redis.js';
import {
  SEO_AUDIT_QUEUE_NAME,
  auditJobOptions,
} from '../../config/queue.js';

let auditQueue = null;

export function getAuditQueue() {
  if (!auditQueue) {
    auditQueue = new Queue(SEO_AUDIT_QUEUE_NAME, {
      connection: getRedisOptions(),
      defaultJobOptions: auditJobOptions,
    });
  }

  return auditQueue;
}

export async function closeAuditQueue() {
  if (auditQueue) {
    await auditQueue.close();
    auditQueue = null;
  }
}
