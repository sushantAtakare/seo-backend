/**
 * Strip sensitive fields before sending user data to clients.
 */
export function toPublicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    clientId: user.clientId ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
