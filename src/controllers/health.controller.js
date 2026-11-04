import ApiResponse from '../utils/ApiResponse.js';

export const getHealth = (req, res) => {
  const payload = new ApiResponse(
    200,
    { status: 'healthy' },
    'SEO Backend is running'
  );

  return res.status(200).json(payload);
};

export const getApiInfo = (req, res) => {
  const payload = new ApiResponse(
    200,
    {
      name: 'SEO Automation Dashboard API',
      version: 'v1',
      routeGroups: [
        {
          group: 'health',
          basePath: '/health',
          description: 'Service health check',
        },
        {
          group: 'api',
          basePath: '/api/v1',
          description: 'Versioned REST API root (domain routes TBD)',
        },
      ],
    },
    'API information'
  );

  return res.status(200).json(payload);
};
