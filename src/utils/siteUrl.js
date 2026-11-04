import ApiError from './ApiError.js';

/**
 * Normalize and validate an absolute http(s) URL.
 * @param {string} rawUrl
 * @returns {URL}
 */
export function parseWebsiteUrl(rawUrl) {
  let parsed;

  try {
    parsed = new URL(String(rawUrl).trim());
  } catch {
    throw new ApiError(400, 'Website URL must be a valid absolute URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ApiError(400, 'Website URL must use http or https');
  }

  if (!parsed.hostname) {
    throw new ApiError(400, 'Website URL must include a valid domain');
  }

  return parsed;
}

/**
 * Extract a normalized domain (hostname without leading www).
 * @param {string} rawUrlOrDomain
 * @returns {string}
 */
export function normalizeDomain(rawUrlOrDomain) {
  const value = String(rawUrlOrDomain).trim().toLowerCase();

  if (!value) {
    throw new ApiError(400, 'Domain is required');
  }

  try {
    if (value.includes('://')) {
      return parseWebsiteUrl(value).hostname.replace(/^www\./, '');
    }

    // Treat bare domains as https hosts for validation
    const hostname = parseWebsiteUrl(`https://${value}`).hostname.replace(
      /^www\./,
      ''
    );

    if (!hostname.includes('.') && hostname !== 'localhost') {
      throw new ApiError(400, 'Domain must be a valid hostname');
    }

    return hostname;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(400, 'Domain must be a valid hostname');
  }
}

/**
 * Build canonical site url + domain from request input.
 * @param {{ url: string, domain?: string }} input
 */
export function resolveSiteIdentity(input) {
  const parsedUrl = parseWebsiteUrl(input.url);
  const url = parsedUrl.toString();
  const derivedDomain = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
  const domain = input.domain
    ? normalizeDomain(input.domain)
    : derivedDomain;

  if (domain !== derivedDomain) {
    throw new ApiError(
      400,
      'Domain must match the hostname of the provided URL'
    );
  }

  return { url, domain };
}
