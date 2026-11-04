import { body, param } from 'express-validator';

export const clientIdParam = [
  param('clientId').trim().notEmpty().withMessage('Client id is required'),
];

export const siteIdParam = [
  param('id').trim().notEmpty().withMessage('Site id is required'),
];

export const createSiteRules = [
  ...clientIdParam,
  body('url')
    .trim()
    .notEmpty()
    .withMessage('Site URL is required')
    .isURL({
      require_protocol: true,
      protocols: ['http', 'https'],
    })
    .withMessage('Site URL must be a valid http(s) URL'),
  body('domain')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Domain cannot be empty')
    .isLength({ min: 3, max: 253 })
    .withMessage('Domain must be between 3 and 253 characters'),
];

export const updateSiteRules = [
  ...siteIdParam,
  body('url')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Site URL cannot be empty')
    .isURL({
      require_protocol: true,
      protocols: ['http', 'https'],
    })
    .withMessage('Site URL must be a valid http(s) URL'),
  body('domain')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Domain cannot be empty')
    .isLength({ min: 3, max: 253 })
    .withMessage('Domain must be between 3 and 253 characters'),
  body().custom((_, { req }) => {
    if (req.body?.url === undefined && req.body?.domain === undefined) {
      throw new Error('At least one of url or domain is required for update');
    }

    return true;
  }),
];
