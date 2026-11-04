import ApiError from '../utils/ApiError.js';

/**
 * Restrict route access to one or more roles.
 * @param {...('ADMIN'|'CLIENT')} roles
 */
const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Authentication required'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Forbidden: insufficient permissions'));
    }

    return next();
  };

export default authorize;
