import fs from 'fs';
import ApiResponse from '../../utils/ApiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';
import * as reportsService from './reports.service.js';

export const generateReport = asyncHandler(async (req, res) => {
  const report = await reportsService.generateReportForAudit(
    req.user,
    req.params.auditId
  );

  return res
    .status(201)
    .json(new ApiResponse(201, report, 'Report generated successfully'));
});

export const listReports = asyncHandler(async (req, res) => {
  const result = await reportsService.listReports(req.user, {
    page: req.query.page,
    limit: req.query.limit,
    status: req.query.status,
    auditId: req.query.auditId,
    clientId: req.query.clientId,
    siteId: req.query.siteId,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, result, 'Reports retrieved successfully'));
});

export const getReport = asyncHandler(async (req, res) => {
  const report = await reportsService.getReportById(req.user, req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, report, 'Report retrieved successfully'));
});

export const downloadReport = asyncHandler(async (req, res) => {
  const { filePath, fileName } = await reportsService.getReportDownload(
    req.user,
    req.params.id
  );

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fileName}"`
  );

  return fs.createReadStream(filePath).pipe(res);
});
