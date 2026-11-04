import prisma from '../../config/prisma.js';
import ApiError from '../../utils/ApiError.js';
import { assertCanAccessClient } from '../../utils/access.js';
import { parseWebsiteUrl } from '../../utils/siteUrl.js';

function mapClient(client) {
  if (!client) {
    return null;
  }

  return {
    id: client.id,
    businessName: client.businessName,
    website: client.website,
    contactPerson: client.contactPerson,
    contactEmail: client.contactEmail,
    industry: client.industry,
    status: client.status,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    _count: client._count,
  };
}

export async function createClient(data) {
  parseWebsiteUrl(data.website);

  const client = await prisma.client.create({
    data: {
      businessName: data.businessName.trim(),
      website: data.website.trim(),
      contactPerson: data.contactPerson.trim(),
      contactEmail: data.contactEmail.trim().toLowerCase(),
      industry: data.industry.trim(),
      status: data.status || 'ACTIVE',
    },
    include: {
      _count: {
        select: { sites: true, users: true, audits: true },
      },
    },
  });

  return mapClient(client);
}

export async function listClients(actor) {
  if (actor.role !== 'ADMIN') {
    throw new ApiError(403, 'Forbidden: only admins can list all clients');
  }

  const clients = await prisma.client.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { sites: true, users: true, audits: true },
      },
    },
  });

  return clients.map(mapClient);
}

export async function getClientById(actor, clientId) {
  assertCanAccessClient(actor, clientId);

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      _count: {
        select: { sites: true, users: true, audits: true },
      },
    },
  });

  if (!client) {
    throw new ApiError(404, 'Client not found');
  }

  return mapClient(client);
}

export async function updateClient(clientId, data) {
  const existing = await prisma.client.findUnique({
    where: { id: clientId },
  });

  if (!existing) {
    throw new ApiError(404, 'Client not found');
  }

  if (data.website) {
    parseWebsiteUrl(data.website);
  }

  const client = await prisma.client.update({
    where: { id: clientId },
    data: {
      ...(data.businessName !== undefined && {
        businessName: data.businessName.trim(),
      }),
      ...(data.website !== undefined && { website: data.website.trim() }),
      ...(data.contactPerson !== undefined && {
        contactPerson: data.contactPerson.trim(),
      }),
      ...(data.contactEmail !== undefined && {
        contactEmail: data.contactEmail.trim().toLowerCase(),
      }),
      ...(data.industry !== undefined && { industry: data.industry.trim() }),
      ...(data.status !== undefined && { status: data.status }),
    },
    include: {
      _count: {
        select: { sites: true, users: true, audits: true },
      },
    },
  });

  return mapClient(client);
}

export async function deleteClient(clientId) {
  const existing = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      _count: {
        select: { users: true, audits: true, sites: true },
      },
    },
  });

  if (!existing) {
    throw new ApiError(404, 'Client not found');
  }

  if (existing._count.audits > 0) {
    throw new ApiError(
      409,
      'Cannot delete client with existing audits'
    );
  }

  if (existing._count.users > 0) {
    throw new ApiError(
      409,
      'Cannot delete client while user accounts are linked'
    );
  }

  await prisma.client.delete({
    where: { id: clientId },
  });

  return { id: clientId, deleted: true };
}
