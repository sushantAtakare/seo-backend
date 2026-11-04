import { validationResult } from 'express-validator';
import ApiError from '../utils/ApiError.js';

const validate = (req, res, next) => {
  const result = validationResult(req);

  if (!result.isEmpty()) {
    const errors = result.array().map((item) => ({
      field: item.path,
      message: item.msg,
    }));

    return next(new ApiError(400, 'Validation failed', errors));
  }

  return next();
};

export default validate;
