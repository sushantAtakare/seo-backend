import ApiError from './ApiError.js';

/**
 * Enforce ADMIN access or CLIENT ownership of a clientId.
 * @param {{ role: string, clientId?: string|null }} actor
 * @param {string} clientId
 */
export function assertCanAccessClient(actor, clientId) {
  if (!actor) {
    throw new ApiError(401, 'Authentication required');
  }

  if (actor.role === 'ADMIN') {
    return;
  }

  if (actor.role === 'CLIENT') {
    if (!actor.clientId) {
      throw new ApiError(403, 'Client account is not linked to a business profile');
    }

    if (actor.clientId !== clientId) {
      throw new ApiError(403, 'Forbidden: cannot access another client');
    }

    return;
  }

  throw new ApiError(403, 'Forbidden: insufficient permissions');
}
