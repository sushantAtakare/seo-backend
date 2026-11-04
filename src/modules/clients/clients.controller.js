import ApiResponse from '../../utils/ApiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';
import * as clientsService from './clients.service.js';

export const createClient = asyncHandler(async (req, res) => {
  const client = await clientsService.createClient(req.body);

  return res
    .status(201)
    .json(new ApiResponse(201, client, 'Client created successfully'));
});

export const listClients = asyncHandler(async (req, res) => {
  const clients = await clientsService.listClients(req.user);

  return res
    .status(200)
    .json(new ApiResponse(200, clients, 'Clients retrieved successfully'));
});

export const getClient = asyncHandler(async (req, res) => {
  const client = await clientsService.getClientById(req.user, req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, client, 'Client retrieved successfully'));
});

export const updateClient = asyncHandler(async (req, res) => {
  const client = await clientsService.updateClient(req.params.id, req.body);

  return res
    .status(200)
    .json(new ApiResponse(200, client, 'Client updated successfully'));
});

export const deleteClient = asyncHandler(async (req, res) => {
  const result = await clientsService.deleteClient(req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, result, 'Client deleted successfully'));
});
