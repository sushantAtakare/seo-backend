import { body, param } from 'express-validator';

export const clientIdParam = [
  param('id').trim().notEmpty().withMessage('Client id is required'),
];

export const createClientRules = [
  body('businessName')
    .trim()
    .notEmpty()
    .withMessage('Business name is required')
    .isLength({ min: 2, max: 150 })
    .withMessage('Business name must be between 2 and 150 characters'),
  body('website')
    .trim()
    .notEmpty()
    .withMessage('Website is required')
    .isURL({
      require_protocol: true,
      protocols: ['http', 'https'],
    })
    .withMessage('Website must be a valid http(s) URL'),
  body('contactPerson')
    .trim()
    .notEmpty()
    .withMessage('Contact person is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Contact person must be between 2 and 100 characters'),
  body('contactEmail')
    .trim()
    .notEmpty()
    .withMessage('Contact email is required')
    .isEmail()
    .withMessage('Contact email must be valid')
    .normalizeEmail(),
  body('industry')
    .trim()
    .notEmpty()
    .withMessage('Industry is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Industry must be between 2 and 100 characters'),
  body('status')
    .optional()
    .isIn(['ACTIVE', 'INACTIVE'])
    .withMessage('Status must be ACTIVE or INACTIVE'),
];

export const updateClientRules = [
  ...clientIdParam,
  body('businessName')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Business name cannot be empty')
    .isLength({ min: 2, max: 150 })
    .withMessage('Business name must be between 2 and 150 characters'),
  body('website')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Website cannot be empty')
    .isURL({
      require_protocol: true,
      protocols: ['http', 'https'],
    })
    .withMessage('Website must be a valid http(s) URL'),
  body('contactPerson')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Contact person cannot be empty')
    .isLength({ min: 2, max: 100 })
    .withMessage('Contact person must be between 2 and 100 characters'),
  body('contactEmail')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Contact email cannot be empty')
    .isEmail()
    .withMessage('Contact email must be valid')
    .normalizeEmail(),
  body('industry')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Industry cannot be empty')
    .isLength({ min: 2, max: 100 })
    .withMessage('Industry must be between 2 and 100 characters'),
  body('status')
    .optional()
    .isIn(['ACTIVE', 'INACTIVE'])
    .withMessage('Status must be ACTIVE or INACTIVE'),
  body().custom((_, { req }) => {
    const allowed = [
      'businessName',
      'website',
      'contactPerson',
      'contactEmail',
      'industry',
      'status',
    ];
    const hasUpdate = allowed.some((key) => req.body?.[key] !== undefined);

    if (!hasUpdate) {
      throw new Error('At least one field is required for update');
    }

    return true;
  }),
];
