import { load } from 'cheerio';
import {
  buildIntegrationResponse,
  sanitizeIntegrationError,
} from '../integrationResponse.js';

const REQUIRED_BY_TYPE = {
  Organization: ['name', 'url'],
  WebSite: ['name', 'url'],
  WebPage: ['name', 'url'],
  Article: ['headline', 'author', 'datePublished'],
  BlogPosting: ['headline', 'author', 'datePublished'],
  Product: ['name'],
  BreadcrumbList: ['itemListElement'],
  FAQPage: ['mainEntity'],
  LocalBusiness: ['name', 'address'],
};

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function collectTypes(node) {
  return asArray(node?.['@type']).map(String);
}

function extractJsonLdFromHtml(html) {
  const $ = load(html || '');
  const blocks = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (raw && raw.trim()) {
      blocks.push(raw.trim());
    }
  });

  return blocks;
}

function validateNode(node, issues, path = '$') {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (node['@graph']) {
    asArray(node['@graph']).forEach((child, index) => {
      validateNode(child, issues, `${path}.@graph[${index}]`);
    });
    return;
  }

  const types = collectTypes(node);
  if (!types.length) {
    issues.push({
      severity: 'warning',
      code: 'MISSING_TYPE',
      message: 'Structured data node is missing @type',
      path,
    });
  }

  for (const type of types) {
    const required = REQUIRED_BY_TYPE[type] || [];
    for (const field of required) {
      if (
        node[field] === undefined ||
        node[field] === null ||
        (typeof node[field] === 'string' && node[field].trim() === '')
      ) {
        issues.push({
          severity: 'important',
          code: 'MISSING_REQUIRED_PROPERTY',
          message: `${type} is missing required property "${field}"`,
          path,
          type,
          property: field,
        });
      }
    }
  }
}

/**
 * Validate JSON-LD structured data from raw blocks and/or HTML.
 */
export function validateSchemaMarkup({ html = '', jsonLdBlocks = [] } = {}) {
  const source = 'schema';

  try {
    const blocks = [
      ...jsonLdBlocks.filter(Boolean),
      ...extractJsonLdFromHtml(html),
    ];

    const uniqueBlocks = [...new Set(blocks)];
    const issues = [];
    const detectedTypes = new Set();
    const parsedBlocks = [];

    if (!uniqueBlocks.length) {
      issues.push({
        severity: 'important',
        code: 'NO_JSON_LD',
        message: 'No JSON-LD structured data found',
      });
    }

    for (const [index, raw] of uniqueBlocks.entries()) {
      try {
        const parsed = JSON.parse(raw);
        parsedBlocks.push(parsed);

        asArray(parsed).forEach((node, nodeIndex) => {
          collectTypes(node).forEach((type) => detectedTypes.add(type));
          if (node?.['@graph']) {
            asArray(node['@graph']).forEach((child) => {
              collectTypes(child).forEach((type) => detectedTypes.add(type));
            });
          }
          validateNode(
            node,
            issues,
            `blocks[${index}]${Array.isArray(parsed) ? `[${nodeIndex}]` : ''}`
          );
        });
      } catch {
        issues.push({
          severity: 'critical',
          code: 'INVALID_JSON_LD',
          message: 'Malformed JSON-LD structured data',
          blockIndex: index,
        });
      }
    }

    const critical = issues.filter((i) => i.severity === 'critical').length;
    const important = issues.filter((i) => i.severity === 'important').length;
    const warnings = issues.filter((i) => i.severity === 'warning').length;

    const score = Math.max(
      0,
      Math.min(100, 100 - critical * 25 - important * 12 - warnings * 5)
    );

    return buildIntegrationResponse({
      source,
      success: true,
      mock: false,
      data: {
        detectedTypes: [...detectedTypes],
        blocksFound: uniqueBlocks.length,
        parsedBlocksCount: parsedBlocks.length,
        score,
        issues,
        summary: {
          critical,
          important,
          warnings,
          hasStructuredData: uniqueBlocks.length > 0,
        },
      },
    });
  } catch (error) {
    return buildIntegrationResponse({
      source,
      success: false,
      mock: false,
      errors: [sanitizeIntegrationError(error)],
    });
  }
}
