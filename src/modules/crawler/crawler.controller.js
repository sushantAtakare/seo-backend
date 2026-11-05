import ApiResponse from '../../utils/ApiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';
import * as crawlerService from './crawler.service.js';
import { getAuditJobs as listAuditJobs } from '../queue/audit.jobs.js';
import { assertCanAccessClient } from '../../utils/access.js';
import prisma from '../../config/prisma.js';
import ApiError from '../../utils/ApiError.js';

export const crawlAudit = asyncHandler(async (req, res) => {
  const result = await crawlerService.enqueueAuditCrawl(
    req.user,
    req.params.id,
    {
      maxPages: req.body.maxPages,
      maxDepth: req.body.maxDepth,
      timeoutMs: req.body.timeoutMs,
      sameDomainOnly: req.body.sameDomainOnly,
    }
  );

  return res
    .status(202)
    .json(new ApiResponse(202, result, 'Audit crawl job accepted'));
});

export const getAuditJobs = asyncHandler(async (req, res) => {
  const audit = await prisma.audit.findUnique({
    where: { id: req.params.id },
    select: { id: true, clientId: true },
  });

  if (!audit) {
    throw new ApiError(404, 'Audit not found');
  }

  assertCanAccessClient(req.user, audit.clientId);

  const jobs = await listAuditJobs(audit.id);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        auditId: audit.id,
        jobs,
      },
      'Audit jobs retrieved successfully'
    )
  );
});
