import { body, param } from 'express-validator';
import { CRAWLER_LIMITS } from './crawler.utils.js';

export const crawlAuditRules = [
  param('id').trim().notEmpty().withMessage('Audit id is required'),
  body('maxPages')
    .optional()
    .isInt({ min: 1, max: CRAWLER_LIMITS.maxPagesHard })
    .withMessage(`maxPages must be between 1 and ${CRAWLER_LIMITS.maxPagesHard}`)
    .toInt(),
  body('maxDepth')
    .optional()
    .isInt({ min: 0, max: CRAWLER_LIMITS.maxDepthHard })
    .withMessage(`maxDepth must be between 0 and ${CRAWLER_LIMITS.maxDepthHard}`)
    .toInt(),
  body('timeoutMs')
    .optional()
    .isInt({ min: 1000, max: CRAWLER_LIMITS.timeoutMsHard })
    .withMessage(
      `timeoutMs must be between 1000 and ${CRAWLER_LIMITS.timeoutMsHard}`
    )
    .toInt(),
  body('sameDomainOnly')
    .optional()
    .isBoolean()
    .withMessage('sameDomainOnly must be a boolean')
    .toBoolean(),
  body().custom((_, { req }) => {
    const allowed = new Set([
      'maxPages',
      'maxDepth',
      'timeoutMs',
      'sameDomainOnly',
    ]);
    const extra = Object.keys(req.body || {}).filter((key) => !allowed.has(key));

    if (extra.length > 0) {
      throw new Error(`Unsupported crawl fields: ${extra.join(', ')}`);
    }

    return true;
  }),
];
