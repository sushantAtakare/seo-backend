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
          group: 'auth',
          basePath: '/api/v1/auth',
          description: 'Authentication and role-based access',
        },
        {
          group: 'clients',
          basePath: '/api/v1/clients',
          description: 'Client account management',
        },
        {
          group: 'sites',
          basePath: '/api/v1/sites',
          description: 'Website / domain management',
        },
        {
          group: 'audits',
          basePath: '/api/v1/audits',
          description: 'SEO audit request management',
        },
        {
          group: 'crawler',
          basePath: '/api/v1/audits/:id/crawl',
          description: 'Queued on-page SEO crawl for an audit',
        },
        {
          group: 'integrations',
          basePath: 'worker:/seo-audit-queue',
          description:
            'PageSpeed, Search Console, DataForSEO and Schema analysis after crawl',
        },
        {
          group: 'api',
          basePath: '/api/v1',
          description: 'Versioned REST API root',
        },
      ],
    },
    'API information'
  );

  return res.status(200).json(payload);
};
