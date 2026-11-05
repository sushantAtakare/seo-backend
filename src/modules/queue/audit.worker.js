import { Worker, UnrecoverableError } from 'bullmq';
import { getRedisOptions } from '../../config/redis.js';
import {
  SEO_AUDIT_QUEUE_NAME,
  AUDIT_JOB_NAMES,
  auditWorkerOptions,
} from '../../config/queue.js';
import ApiError from '../../utils/ApiError.js';
import { processAuditCrawl } from '../crawler/crawler.service.js';
import { enrichAuditWithIntegrations } from '../integrations/integrations.service.js';
import env from '../../config/env.js';

function isPermanentCrawlError(error) {
  if (error instanceof UnrecoverableError) {
    return true;
  }

  if (!(error instanceof ApiError)) {
    return false;
  }

  // Validation / SSRF / unsupported content / not found — do not retry
  return [400, 403, 404, 409].includes(error.statusCode);
}

/**
 * Create the SEO audit BullMQ worker (does not auto-start beyond construction).
 */
export function createAuditWorker() {
  const worker = new Worker(
    SEO_AUDIT_QUEUE_NAME,
    async (job) => {
      if (job.name !== AUDIT_JOB_NAMES.CRAWL_AUDIT) {
        throw new UnrecoverableError(`Unknown job name: ${job.name}`);
      }

      const { auditId, crawlConfig = {} } = job.data || {};

      if (!auditId) {
        throw new UnrecoverableError('Job is missing auditId');
      }

      await job.updateProgress(5);

      try {
        const result = await processAuditCrawl(
          auditId,
          {
            ...crawlConfig,
            allowPrivateNetworks:
              crawlConfig.allowPrivateNetworks ??
              env.crawler.allowPrivateNetworks,
          },
          {
            onProgress: async (value) => {
              // Reserve 70% of progress for crawl
              await job.updateProgress(Math.min(70, Math.round(value * 0.7)));
            },
          }
        );

        await job.updateProgress(75);

        // Integrations run after a successful crawl and must not discard crawl results
        let integrations = null;
        try {
          integrations = await enrichAuditWithIntegrations(auditId, result);
        } catch (integrationError) {
          console.error(
            `[audit-worker] integrations failed for ${auditId}:`,
            integrationError.message
          );
          integrations = {
            auditId,
            skipped: true,
            reason: 'Integration enrichment failed',
          };
        }

        await job.updateProgress(100);

        return {
          auditId,
          status: result.status,
          overallScore:
            integrations?.overallScore ?? result.overallScore ?? null,
          pagesCrawled: result.pagesCrawled,
          integrations: {
            useMocks: integrations?.integrations?.useMocks ?? null,
            pagespeed: integrations?.integrations?.pagespeed?.success ?? null,
            searchConsole:
              integrations?.integrations?.searchConsole?.success ?? null,
            dataforseo:
              integrations?.integrations?.dataforseo?.success ?? null,
            schema: integrations?.integrations?.schema?.success ?? null,
          },
        };
      } catch (error) {
        if (isPermanentCrawlError(error)) {
          throw new UnrecoverableError(
            error.message || 'Permanent crawl failure'
          );
        }

        throw error;
      }
    },
    {
      connection: getRedisOptions(),
      concurrency: auditWorkerOptions.concurrency,
      lockDuration: auditWorkerOptions.lockDuration,
    }
  );

  worker.on('completed', (job) => {
    console.info(`[audit-worker] completed job ${job.id}`);
  });

  worker.on('failed', (job, error) => {
    console.error(
      `[audit-worker] failed job ${job?.id || 'unknown'}:`,
      error.message
    );
  });

  worker.on('error', (error) => {
    console.error('[audit-worker] error:', error.message);
  });

  return worker;
}
