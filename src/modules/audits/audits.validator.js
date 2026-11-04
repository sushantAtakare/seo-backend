import { body, param, query } from 'express-validator';

const AUDIT_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'];

export const auditIdParam = [
  param('id').trim().notEmpty().withMessage('Audit id is required'),
];

export const createAuditRules = [
  body('siteId')
    .trim()
    .notEmpty()
    .withMessage('siteId is required')
    .isString()
    .withMessage('siteId must be a string'),
  body().custom((_, { req }) => {
    const allowed = new Set(['siteId']);
    const extra = Object.keys(req.body || {}).filter((key) => !allowed.has(key));

    if (extra.length > 0) {
      throw new Error(
        `Unsupported audit fields: ${extra.join(', ')}. Configuration is not available yet.`
      );
    }

    return true;
  }),
];

export const listAuditRules = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page must be a positive integer')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be between 1 and 100')
    .toInt(),
  query('status')
    .optional()
    .isIn(AUDIT_STATUSES)
    .withMessage(`status must be one of: ${AUDIT_STATUSES.join(', ')}`),
  query('siteId')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('siteId cannot be empty'),
];

export const updateAuditRules = [
  ...auditIdParam,
  body('status')
    .optional()
    .isIn(AUDIT_STATUSES)
    .withMessage(`status must be one of: ${AUDIT_STATUSES.join(', ')}`),
  body('overallScore')
    .optional({ nullable: true })
    .isInt({ min: 0, max: 100 })
    .withMessage('overallScore must be an integer between 0 and 100'),
  body('startedAt')
    .optional({ nullable: true })
    .isISO8601()
    .withMessage('startedAt must be a valid ISO 8601 date'),
  body('completedAt')
    .optional({ nullable: true })
    .isISO8601()
    .withMessage('completedAt must be a valid ISO 8601 date'),
  body().custom((_, { req }) => {
    const allowed = new Set([
      'status',
      'overallScore',
      'startedAt',
      'completedAt',
    ]);
    const keys = Object.keys(req.body || {});
    const extra = keys.filter((key) => !allowed.has(key));

    if (extra.length > 0) {
      throw new Error(`Unsupported update fields: ${extra.join(', ')}`);
    }

    if (keys.length === 0) {
      throw new Error('At least one field is required for update');
    }

    return true;
  }),
];
