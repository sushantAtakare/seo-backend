/**
 * Deterministic PageSpeed Insights mock payload.
 */
export function getMockPageSpeedResults(url, strategy = 'mobile') {
  const isMobile = strategy === 'mobile';
  const seed = Math.abs(
    [...String(url)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  );

  const performance = isMobile ? 72 + (seed % 8) : 84 + (seed % 6);
  const accessibility = 90 + (seed % 5);
  const bestPractices = 88 + (seed % 7);
  const seo = 91 + (seed % 4);

  return {
    url,
    strategy,
    scores: {
      performance,
      accessibility,
      bestPractices,
      seo,
    },
    coreWebVitals: {
      lcpMs: isMobile ? 2800 + (seed % 400) : 1900 + (seed % 300),
      cls: Number((0.05 + (seed % 5) / 100).toFixed(2)),
      inpMs: isMobile ? 180 + (seed % 40) : 120 + (seed % 30),
      fcpMs: isMobile ? 1600 + (seed % 200) : 1100 + (seed % 150),
      ttfbMs: 400 + (seed % 120),
    },
    opportunities: [
      {
        id: 'unused-javascript',
        title: 'Reduce unused JavaScript',
        description: 'Remove unused JS to reduce bytes consumed by network activity.',
        savingsMs: isMobile ? 450 : 220,
      },
      {
        id: 'render-blocking-resources',
        title: 'Eliminate render-blocking resources',
        description: 'Resources are blocking the first paint of your page.',
        savingsMs: isMobile ? 320 : 140,
      },
    ],
    diagnostics: [
      {
        id: 'dom-size',
        title: 'Avoid an excessive DOM size',
        description: 'A large DOM can increase memory usage and style recalculation cost.',
      },
      {
        id: 'legacy-javascript',
        title: 'Avoid serving legacy JavaScript to modern browsers',
        description: 'Polyfills increase bundle size for browsers that do not need them.',
      },
    ],
  };
}

export function getMockPageSpeedBundle(url) {
  return {
    mobile: getMockPageSpeedResults(url, 'mobile'),
    desktop: getMockPageSpeedResults(url, 'desktop'),
  };
}
