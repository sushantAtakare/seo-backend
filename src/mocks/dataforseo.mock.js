/**
 * Deterministic DataForSEO mock payload.
 */
export function getMockDataForSeoResults(domain, seedKeyword = null) {
  const keyword =
    seedKeyword ||
    `${String(domain || 'example.com').split('.')[0]} seo`;

  return {
    domain,
    keyword,
    keywordInfo: {
      keyword,
      locationCode: 2840,
      languageCode: 'en',
      searchVolume: 5400,
      cpc: 2.35,
      competition: 0.47,
      competitionLevel: 'MEDIUM',
      keywordDifficulty: 38,
    },
    serp: {
      keyword,
      seResultsCount: 148000000,
      items: [
        {
          rankGroup: 1,
          rankAbsolute: 1,
          domain: 'moz.com',
          url: 'https://moz.com/learn/seo',
          title: 'Beginner’s Guide to SEO',
        },
        {
          rankGroup: 2,
          rankAbsolute: 2,
          domain: 'ahrefs.com',
          url: 'https://ahrefs.com/seo',
          title: 'SEO: The Complete Guide',
        },
        {
          rankGroup: 3,
          rankAbsolute: 3,
          domain,
          url: `https://${domain}/`,
          title: `${domain} — SEO platform`,
        },
      ],
    },
    competitors: [
      {
        domain: 'semrush.com',
        avgPosition: 4.2,
        intersections: 186,
        visibility: 0.62,
      },
      {
        domain: 'ahrefs.com',
        avgPosition: 5.1,
        intersections: 142,
        visibility: 0.55,
      },
      {
        domain: 'moz.com',
        avgPosition: 6.4,
        intersections: 97,
        visibility: 0.41,
      },
    ],
  };
}
