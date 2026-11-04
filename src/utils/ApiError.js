class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status code
   * @param {string} message Error message
   * @param {unknown[]} [errors=[]] Optional field/detail errors
   */
  constructor(statusCode, message, errors = []) {
    super(message);
    this.statusCode = statusCode;
    this.success = false;
    this.errors = errors;
    this.isOperational = true;

    Error.captureStackTrace?.(this, this.constructor);
  }
}

export default ApiError;
