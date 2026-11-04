import ApiResponse from '../../utils/ApiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';
import * as authService from './auth.service.js';

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password);

  return res
    .status(200)
    .json(new ApiResponse(200, result, 'Login successful'));
});

export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const result = await authService.refresh(refreshToken);

  return res
    .status(200)
    .json(new ApiResponse(200, result, 'Token refreshed successfully'));
});

export const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const result = await authService.logout(refreshToken);

  return res
    .status(200)
    .json(new ApiResponse(200, result, 'Logout successful'));
});

export const me = asyncHandler(async (req, res) => {
  const profile = await authService.getProfile(req.user.id);

  return res
    .status(200)
    .json(new ApiResponse(200, profile, 'Authenticated user profile'));
});

export const adminCheck = asyncHandler(async (req, res) => {
  return res.status(200).json(
    new ApiResponse(
      200,
      { role: req.user.role },
      'Admin access granted'
    )
  );
});
