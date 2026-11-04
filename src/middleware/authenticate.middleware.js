import ApiError from '../utils/ApiError.js';
import prisma from '../config/prisma.js';
import { verifyAccessToken } from '../utils/token.js';
import { toPublicUser } from '../utils/user.serializer.js';

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      throw new ApiError(401, 'Authentication required');
    }

    const token = header.slice(7).trim();

    if (!token) {
      throw new ApiError(401, 'Authentication required');
    }

    let payload;

    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new ApiError(401, 'Invalid or expired access token');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new ApiError(401, 'Invalid or expired access token');
    }

    req.user = toPublicUser(user);
    req.auth = {
      userId: user.id,
      role: user.role,
      clientId: user.clientId ?? null,
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

export default authenticate;
