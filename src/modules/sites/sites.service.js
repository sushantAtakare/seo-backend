import { Prisma } from '@prisma/client';
import prisma from '../../config/prisma.js';
import ApiError from '../../utils/ApiError.js';
import { assertCanAccessClient } from '../../utils/access.js';
import { resolveSiteIdentity } from '../../utils/siteUrl.js';

function mapSite(site) {
  if (!site) {
    return null;
  }

  return {
    id: site.id,
    clientId: site.clientId,
    domain: site.domain,
    url: site.url,
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
  };
}

function isUniqueConflict(error) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

async function ensureClientExists(clientId) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true },
  });

  if (!client) {
    throw new ApiError(404, 'Client not found');
  }
}

export async function createSite(actor, clientId, data) {
  assertCanAccessClient(actor, clientId);
  await ensureClientExists(clientId);

  const identity = resolveSiteIdentity({
    url: data.url,
    domain: data.domain,
  });

  try {
    const site = await prisma.site.create({
      data: {
        clientId,
        url: identity.url,
        domain: identity.domain,
      },
    });

    return mapSite(site);
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new ApiError(
        409,
        'A website with this domain or URL already exists for this client'
      );
    }

    throw error;
  }
}

export async function listSitesForClient(actor, clientId) {
  assertCanAccessClient(actor, clientId);
  await ensureClientExists(clientId);

  const sites = await prisma.site.findMany({
    where: { clientId },
    orderBy: { createdAt: 'desc' },
  });

  return sites.map(mapSite);
}

export async function getSiteById(actor, siteId) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
  });

  if (!site) {
    throw new ApiError(404, 'Site not found');
  }

  assertCanAccessClient(actor, site.clientId);

  return mapSite(site);
}

export async function updateSite(actor, siteId, data) {
  const existing = await prisma.site.findUnique({
    where: { id: siteId },
  });

  if (!existing) {
    throw new ApiError(404, 'Site not found');
  }

  // Only admins mutate sites; still guard ownership path for safety
  if (actor.role !== 'ADMIN') {
    throw new ApiError(403, 'Forbidden: insufficient permissions');
  }

  const identity = resolveSiteIdentity({
    url: data.url ?? existing.url,
    domain: data.domain,
  });

  try {
    const site = await prisma.site.update({
      where: { id: siteId },
      data: {
        url: identity.url,
        domain: identity.domain,
      },
    });

    return mapSite(site);
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new ApiError(
        409,
        'A website with this domain or URL already exists for this client'
      );
    }

    throw error;
  }
}

export async function deleteSite(actor, siteId) {
  const existing = await prisma.site.findUnique({
    where: { id: siteId },
    include: {
      _count: {
        select: { audits: true },
      },
    },
  });

  if (!existing) {
    throw new ApiError(404, 'Site not found');
  }

  if (actor.role !== 'ADMIN') {
    throw new ApiError(403, 'Forbidden: insufficient permissions');
  }

  if (existing._count.audits > 0) {
    throw new ApiError(409, 'Cannot delete site with existing audits');
  }

  await prisma.site.delete({
    where: { id: siteId },
  });

  return { id: siteId, deleted: true };
}
