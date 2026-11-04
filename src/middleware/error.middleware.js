import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const errorMiddleware = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errors = err.errors || [];

  if (!(err instanceof ApiError) && statusCode === 500) {
    message = env.isProduction ? 'Internal Server Error' : message;
  }

  if (env.isProduction && statusCode === 500 && !(err instanceof ApiError)) {
    message = 'Internal Server Error';
    errors = [];
  }

  const response = {
    success: false,
    message,
    data: null,
    errors,
  };

  if (!env.isProduction && err.stack) {
    response.stack = err.stack;
  }

  if (!env.isProduction) {
    console.error(`[Error] ${req.method} ${req.originalUrl}`, {
      statusCode,
      message: err.message,
    });
  } else {
    console.error(`[Error] ${req.method} ${req.originalUrl} → ${statusCode}`);
  }

  return res.status(statusCode).json(response);
};

export default errorMiddleware;
