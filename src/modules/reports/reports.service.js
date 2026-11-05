import path from 'path';
import prisma from '../../config/prisma.js';
import ApiError from '../../utils/ApiError.js';
import { assertCanAccessClient } from '../../utils/access.js';
import { buildReportData, mapReport } from './reports.mapper.js';
import { generateReportPdf } from './reports.pdf.js';
import { deletePdfIfExists, pdfFileExists } from './reports.storage.js';

const REPORT_STATUSES = {
  GENERATING: 'GENERATING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

const reportInclude = {
  audit: {
    select: {
      id: true,
      clientId: true,
      siteId: true,
      status: true,
      overallScore: true,
      site: {
        select: { id: true, domain: true, url: true },
      },
    },
  },
};

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

    return { audit: { clientId: actor.clientId } };
  }

  throw new ApiError(403, 'Forbidden: insufficient permissions');
}

async function getAccessibleReport(actor, reportId) {
  const report = await prisma.report.findFirst({
    where: {
      id: reportId,
      ...ownershipWhere(actor),
    },
    include: reportInclude,
  });

  if (!report) {
    if (actor.role === 'CLIENT') {
      const exists = await prisma.report.findUnique({
        where: { id: reportId },
        include: { audit: { select: { clientId: true } } },
      });

      if (exists && exists.audit.clientId !== actor.clientId) {
        throw new ApiError(403, 'Forbidden: cannot access another client');
      }
    }

    throw new ApiError(404, 'Report not found');
  }

  return report;
}

/**
 * Generate (or regenerate) a PDF report for a completed audit.
 */
export async function generateReportForAudit(actor, auditId) {
  const audit = await prisma.audit.findUnique({
    where: { id: auditId },
    include: {
      site: { select: { id: true, domain: true, url: true } },
      result: true,
      report: true,
    },
  });

  if (!audit) {
    throw new ApiError(404, 'Audit not found');
  }

  assertCanAccessClient(actor, audit.clientId);

  if (audit.status !== 'COMPLETED') {
    throw new ApiError(
      400,
      `Reports can only be generated for COMPLETED audits (current status: ${audit.status})`
    );
  }

  if (!audit.result) {
    throw new ApiError(
      400,
      'Audit has no results available. Complete a crawl before generating a report.'
    );
  }

  let report =
    audit.report ||
    (await prisma.report.create({
      data: {
        auditId: audit.id,
        status: REPORT_STATUSES.GENERATING,
        filePath: null,
        generatedAt: null,
      },
    }));

  if (audit.report) {
    report = await prisma.report.update({
      where: { id: audit.report.id },
      data: {
        status: REPORT_STATUSES.GENERATING,
      },
    });
  }

  const previousPath = audit.report?.filePath || null;

  try {
    const reportData = buildReportData(audit);
    const absolutePath = await generateReportPdf(report.id, reportData);

    if (previousPath && previousPath !== absolutePath) {
      await deletePdfIfExists(previousPath);
    }

    const completed = await prisma.report.update({
      where: { id: report.id },
      data: {
        status: REPORT_STATUSES.COMPLETED,
        filePath: absolutePath,
        generatedAt: new Date(),
      },
      include: reportInclude,
    });

    const mapped = mapReport(completed);
    mapped.fileAvailable = true;
    return mapped;
  } catch (error) {
    await prisma.report.update({
      where: { id: report.id },
      data: {
        status: REPORT_STATUSES.FAILED,
        filePath: previousPath,
      },
    });

    throw new ApiError(
      500,
      `PDF generation failed: ${error.message || 'unknown error'}`
    );
  }
}

export async function listReports(actor, query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const where = {
    ...ownershipWhere(actor),
  };

  if (query.status) {
    where.status = query.status;
  }

  if (query.auditId) {
    where.auditId = query.auditId;
  }

  if (query.clientId) {
    if (actor.role === 'CLIENT' && query.clientId !== actor.clientId) {
      throw new ApiError(403, 'Forbidden: cannot access another client');
    }
    where.audit = {
      ...(where.audit || {}),
      clientId: query.clientId,
    };
  }

  if (query.siteId) {
    where.audit = {
      ...(where.audit || {}),
      siteId: query.siteId,
    };

    if (actor.role === 'CLIENT') {
      const site = await prisma.site.findFirst({
        where: { id: query.siteId, clientId: actor.clientId },
        select: { id: true },
      });

      if (!site) {
        throw new ApiError(403, 'Forbidden: cannot access another client');
      }
    }
  }

  const [total, reports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: reportInclude,
    }),
  ]);

  const items = await Promise.all(
    reports.map(async (report) => {
      const mapped = mapReport(report);
      mapped.fileAvailable = await pdfFileExists(report.filePath);
      return mapped;
    })
  );

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

export async function getReportById(actor, reportId) {
  const report = await getAccessibleReport(actor, reportId);
  const mapped = mapReport(report);
  mapped.fileAvailable = await pdfFileExists(report.filePath);
  return mapped;
}

/**
 * Return absolute PDF path for download after authz checks.
 */
export async function getReportDownload(actor, reportId) {
  const report = await getAccessibleReport(actor, reportId);

  if (report.status !== REPORT_STATUSES.COMPLETED) {
    throw new ApiError(
      409,
      `Report is not ready for download (status: ${report.status})`
    );
  }

  if (!report.filePath) {
    throw new ApiError(404, 'Report PDF file is missing');
  }

  const exists = await pdfFileExists(report.filePath);
  if (!exists) {
    throw new ApiError(
      404,
      'Report PDF file is missing or was deleted from storage'
    );
  }

  return {
    filePath: report.filePath,
    fileName: path.basename(report.filePath),
    report: mapReport(report),
  };
}
