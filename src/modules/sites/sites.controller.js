import ApiResponse from '../../utils/ApiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';
import * as sitesService from './sites.service.js';

export const createSite = asyncHandler(async (req, res) => {
  const site = await sitesService.createSite(
    req.user,
    req.params.clientId,
    req.body
  );

  return res
    .status(201)
    .json(new ApiResponse(201, site, 'Site created successfully'));
});

export const listSites = asyncHandler(async (req, res) => {
  const sites = await sitesService.listSitesForClient(
    req.user,
    req.params.clientId
  );

  return res
    .status(200)
    .json(new ApiResponse(200, sites, 'Sites retrieved successfully'));
});

export const getSite = asyncHandler(async (req, res) => {
  const site = await sitesService.getSiteById(req.user, req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, site, 'Site retrieved successfully'));
});

export const updateSite = asyncHandler(async (req, res) => {
  const site = await sitesService.updateSite(
    req.user,
    req.params.id,
    req.body
  );

  return res
    .status(200)
    .json(new ApiResponse(200, site, 'Site updated successfully'));
});

export const deleteSite = asyncHandler(async (req, res) => {
  const result = await sitesService.deleteSite(req.user, req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, result, 'Site deleted successfully'));
});
