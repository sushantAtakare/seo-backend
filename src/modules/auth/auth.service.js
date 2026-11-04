import crypto from 'crypto';
import prisma from '../../config/prisma.js';
import ApiError from '../../utils/ApiError.js';
import { comparePassword } from '../../utils/password.js';
import {
  getRefreshTokenExpiryDate,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/token.js';
import { toPublicUser } from '../../utils/user.serializer.js';

function buildAccessPayload(user) {
  return {
    sub: user.id,
    role: user.role,
    clientId: user.clientId ?? null,
  };
}

async function issueTokenPair(user) {
  const accessToken = signAccessToken(buildAccessPayload(user));
  // jti ensures refresh tokens are unique even when issued in the same second
  const refreshToken = signRefreshToken({
    sub: user.id,
    jti: crypto.randomUUID(),
  });
  const tokenHash = hashToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: getRefreshTokenExpiryDate(),
    },
  });

  return { accessToken, refreshToken };
}

export async function login(email, password) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user || !user.passwordHash) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const passwordMatches = await comparePassword(password, user.passwordHash);

  if (!passwordMatches) {
    throw new ApiError(401, 'Invalid email or password');
  }

  if (user.role === 'CLIENT' && !user.clientId) {
    throw new ApiError(403, 'Client account is not linked to a business profile');
  }

  const tokens = await issueTokenPair(user);

  return {
    user: toPublicUser(user),
    ...tokens,
  };
}

export async function refresh(refreshToken) {
  let payload;

  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const tokenHash = hashToken(refreshToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
  });

  if (
    !storedToken ||
    storedToken.revokedAt ||
    storedToken.expiresAt.getTime() <= Date.now() ||
    storedToken.userId !== payload.sub
  ) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const user = await prisma.user.findUnique({
    where: { id: storedToken.userId },
  });

  if (!user) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  // Rotate inside a transaction: revoke current, then issue a new pair
  const tokens = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    const accessToken = signAccessToken(buildAccessPayload(user));
    const nextRefreshToken = signRefreshToken({
      sub: user.id,
      jti: crypto.randomUUID(),
    });
    const nextHash = hashToken(nextRefreshToken);

    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: nextHash,
        expiresAt: getRefreshTokenExpiryDate(),
      },
    });

    return {
      accessToken,
      refreshToken: nextRefreshToken,
    };
  });

  return {
    user: toPublicUser(user),
    ...tokens,
  };
}

export async function logout(refreshToken) {
  const tokenHash = hashToken(refreshToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
  });

  if (storedToken && !storedToken.revokedAt) {
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });
  }

  return { revoked: true };
}

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  return toPublicUser(user);
}
