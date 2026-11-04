import ApiResponse from '../../utils/ApiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';
import * as auditsService from './audits.service.js';

export const createAudit = asyncHandler(async (req, res) => {
  const audit = await auditsService.createAudit(req.user, req.body);

  return res
    .status(201)
    .json(new ApiResponse(201, audit, 'Audit created successfully'));
});

export const listAudits = asyncHandler(async (req, res) => {
  const result = await auditsService.listAudits(req.user, {
    page: req.query.page,
    limit: req.query.limit,
    status: req.query.status,
    siteId: req.query.siteId,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, result, 'Audits retrieved successfully'));
});

export const getAudit = asyncHandler(async (req, res) => {
  const audit = await auditsService.getAuditById(req.user, req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, audit, 'Audit retrieved successfully'));
});

export const updateAudit = asyncHandler(async (req, res) => {
  const audit = await auditsService.updateAudit(
    req.user,
    req.params.id,
    req.body
  );

  return res
    .status(200)
    .json(new ApiResponse(200, audit, 'Audit updated successfully'));
});

export const deleteAudit = asyncHandler(async (req, res) => {
  const result = await auditsService.deleteAudit(req.user, req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, result, 'Audit deleted successfully'));
});
