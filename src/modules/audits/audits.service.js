import prisma from '../../config/prisma.js';
import ApiError from '../../utils/ApiError.js';
import { assertCanAccessClient } from '../../utils/access.js';

const STATUS_TRANSITIONS = {
  PENDING: ['PROCESSING', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED', 'PENDING'],
  COMPLETED: [],
  FAILED: ['PENDING'],
};

const auditInclude = {
  site: {
    select: { id: true, domain: true, url: true },
  },
  result: { select: { id: true } },
  report: { select: { id: true } },
};

function mapAudit(audit) {
  if (!audit) {
    return null;
  }

  return {
    id: audit.id,
    clientId: audit.clientId,
    siteId: audit.siteId,
    status: audit.status,
    overallScore: audit.overallScore,
    startedAt: audit.startedAt,
    completedAt: audit.completedAt,
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
    site: audit.site
      ? {
          id: audit.site.id,
          domain: audit.site.domain,
          url: audit.site.url,
        }
      : undefined,
    hasResult: Boolean(audit.result),
    hasReport: Boolean(audit.report),
  };
}

function ownershipWhere(actor) {
  if (actor.role === 'ADMIN') {
    return {};
  }

  if (actor.role === 'CLIENT') {
    if (!actor.clientId) {
      throw new ApiError(
        403,
        'Client account is not linked to a business profile'
      );
    }

    return { clientId: actor.clientId };
  }

  throw new ApiError(403, 'Forbidden: insufficient permissions');
}

function assertStatusTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) {
    return;
  }

  const allowed = STATUS_TRANSITIONS[fromStatus] || [];

  if (!allowed.includes(toStatus)) {
    throw new ApiError(
      400,
      `Invalid status transition from ${fromStatus} to ${toStatus}`
    );
  }
}

export async function createAudit(actor, { siteId }) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, clientId: true },
  });

  if (!site) {
    throw new ApiError(404, 'Site not found');
  }

  assertCanAccessClient(actor, site.clientId);

  const audit = await prisma.audit.create({
    data: {
      siteId: site.id,
      clientId: site.clientId,
      status: 'PENDING',
    },
    include: auditInclude,
  });

  return mapAudit(audit);
}

export async function listAudits(actor, query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const where = {
    ...ownershipWhere(actor),
  };

  if (query.status) {
    where.status = query.status;
  }

  if (query.siteId) {
    where.siteId = query.siteId;
  }

  if (actor.role === 'CLIENT' && query.siteId) {
    const site = await prisma.site.findFirst({
      where: {
        id: query.siteId,
        clientId: actor.clientId,
      },
      select: { id: true },
    });

    if (!site) {
      throw new ApiError(403, 'Forbidden: cannot access another client');
    }
  }

  const [total, audits] = await Promise.all([
    prisma.audit.count({ where }),
    prisma.audit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: auditInclude,
    }),
  ]);

  return {
    items: audits.map(mapAudit),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

export async function getAuditById(actor, auditId) {
  const audit = await prisma.audit.findFirst({
    where: {
      id: auditId,
      ...ownershipWhere(actor),
    },
    include: auditInclude,
  });

  if (!audit) {
    if (actor.role === 'CLIENT') {
      const exists = await prisma.audit.findUnique({
        where: { id: auditId },
        select: { id: true, clientId: true },
      });

      if (exists && exists.clientId !== actor.clientId) {
        throw new ApiError(403, 'Forbidden: cannot access another client');
      }
    }

    throw new ApiError(404, 'Audit not found');
  }

  return mapAudit(audit);
}

export async function updateAudit(actor, auditId, data) {
  if (actor.role !== 'ADMIN') {
    throw new ApiError(403, 'Forbidden: insufficient permissions');
  }

  const existing = await prisma.audit.findUnique({
    where: { id: auditId },
  });

  if (!existing) {
    throw new ApiError(404, 'Audit not found');
  }

  const nextStatus = data.status ?? existing.status;

  if (data.status) {
    assertStatusTransition(existing.status, data.status);
  }

  const updateData = {};

  if (data.status !== undefined) {
    updateData.status = data.status;
  }

  if (data.overallScore !== undefined) {
    if (nextStatus !== 'COMPLETED' && data.overallScore !== null) {
      throw new ApiError(
        400,
        'overallScore can only be set when audit status is COMPLETED'
      );
    }

    updateData.overallScore = data.overallScore;
  }

  if (data.startedAt !== undefined) {
    updateData.startedAt = data.startedAt ? new Date(data.startedAt) : null;
  }

  if (data.completedAt !== undefined) {
    updateData.completedAt = data.completedAt
      ? new Date(data.completedAt)
      : null;
  }

  if (data.status === 'PROCESSING' && data.startedAt === undefined) {
    updateData.startedAt = existing.startedAt ?? new Date();
    updateData.completedAt = null;
  }

  if (
    (data.status === 'COMPLETED' || data.status === 'FAILED') &&
    data.completedAt === undefined
  ) {
    updateData.completedAt = new Date();
  }

  if (data.status === 'PENDING' && existing.status === 'FAILED') {
    updateData.startedAt = null;
    updateData.completedAt = null;
    updateData.overallScore = null;
  }

  const audit = await prisma.audit.update({
    where: { id: auditId },
    data: updateData,
    include: auditInclude,
  });

  return mapAudit(audit);
}

export async function deleteAudit(actor, auditId) {
  if (actor.role !== 'ADMIN') {
    throw new ApiError(403, 'Forbidden: insufficient permissions');
  }

  const existing = await prisma.audit.findUnique({
    where: { id: auditId },
    include: {
      result: { select: { id: true } },
      report: { select: { id: true } },
    },
  });

  if (!existing) {
    throw new ApiError(404, 'Audit not found');
  }

  await prisma.$transaction(async (tx) => {
    if (existing.report) {
      await tx.report.delete({ where: { auditId } });
    }

    if (existing.result) {
      await tx.auditResult.delete({ where: { auditId } });
    }

    await tx.audit.delete({ where: { id: auditId } });
  });

  return {
    id: auditId,
    deleted: true,
    removedResult: Boolean(existing.result),
    removedReport: Boolean(existing.report),
  };
}
