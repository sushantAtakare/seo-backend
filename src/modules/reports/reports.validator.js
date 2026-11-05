import { param, query } from 'express-validator';

const REPORT_STATUSES = ['GENERATING', 'COMPLETED', 'FAILED'];

export const auditIdParam = [
  param('auditId').trim().notEmpty().withMessage('Audit id is required'),
];

export const reportIdParam = [
  param('id').trim().notEmpty().withMessage('Report id is required'),
];

export const listReportRules = [
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
    .isIn(REPORT_STATUSES)
    .withMessage(`status must be one of: ${REPORT_STATUSES.join(', ')}`),
  query('auditId')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('auditId cannot be empty'),
  query('clientId')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('clientId cannot be empty'),
  query('siteId')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('siteId cannot be empty'),
];
