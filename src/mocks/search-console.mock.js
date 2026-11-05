/**
 * Deterministic Google Search Console mock payload.
 */
export function getMockSearchConsoleResults(siteUrl, { startDate, endDate } = {}) {
  const host = (() => {
    try {
      return new URL(siteUrl).hostname;
    } catch {
      return 'example.com';
    }
  })();

  const clicks = 1280;
  const impressions = 24600;

  return {
    siteUrl,
    dateRange: {
      startDate: startDate || '2026-10-01',
      endDate: endDate || '2026-10-31',
    },
    totals: {
      clicks,
      impressions,
      ctr: Number((clicks / impressions).toFixed(4)),
      position: 12.4,
    },
    topQueries: [
      {
        query: `${host.split('.')[0]} seo audit`,
        clicks: 210,
        impressions: 3200,
        ctr: 0.0656,
        position: 8.2,
      },
      {
        query: `best ${host.split('.')[0]} tools`,
        clicks: 160,
        impressions: 4100,
        ctr: 0.039,
        position: 14.1,
      },
      {
        query: `${host} pricing`,
        clicks: 95,
        impressions: 1800,
        ctr: 0.0528,
        position: 6.7,
      },
    ],
    topPages: [
      {
        page: `https://${host}/`,
        clicks: 420,
        impressions: 9000,
        ctr: 0.0467,
        position: 9.8,
      },
      {
        page: `https://${host}/blog/seo-checklist`,
        clicks: 260,
        impressions: 5200,
        ctr: 0.05,
        position: 11.2,
      },
      {
        page: `https://${host}/features`,
        clicks: 140,
        impressions: 3100,
        ctr: 0.0452,
        position: 13.5,
      },
    ],
  };
}
