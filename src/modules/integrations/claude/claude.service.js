import integrations, {
  hasAnthropicCredentials,
} from '../../../config/integrations.js';
import { getMockClaudeSeoAnalysis } from '../../../mocks/claude.mock.js';
import {
  buildIntegrationResponse,
  sanitizeIntegrationError,
  withTimeout,
} from '../integrationResponse.js';

const PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);

/**
 * Validate Claude SEO analysis payload before persistence.
 */
export function validateClaudeAnalysisData(data) {
  const errors = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, errors: ['AI data must be an object'], data: null };
  }

  if (
    typeof data.overallAssessment !== 'string' ||
    !data.overallAssessment.trim()
  ) {
    errors.push('overallAssessment must be a non-empty string');
  }

  if (
    data.overallScore !== null &&
    data.overallScore !== undefined &&
    (typeof data.overallScore !== 'number' ||
      Number.isNaN(data.overallScore) ||
      data.overallScore < 0 ||
      data.overallScore > 100)
  ) {
    errors.push('overallScore must be null or a number between 0 and 100');
  }

  if (!Array.isArray(data.issues)) {
    errors.push('issues must be an array');
  } else {
    data.issues.forEach((issue, index) => {
      if (!issue || typeof issue !== 'object') {
        errors.push(`issues[${index}] must be an object`);
        return;
      }
      if (!PRIORITIES.has(issue.priority)) {
        errors.push(`issues[${index}].priority is invalid`);
      }
      if (typeof issue.title !== 'string' || !issue.title.trim()) {
        errors.push(`issues[${index}].title is required`);
      }
    });
  }

  if (!Array.isArray(data.recommendations)) {
    errors.push('recommendations must be an array');
  }

  if (!Array.isArray(data.positiveObservations)) {
    errors.push('positiveObservations must be an array');
  }

  if (
    !data.prioritySummary ||
    typeof data.prioritySummary !== 'object' ||
    Array.isArray(data.prioritySummary)
  ) {
    errors.push('prioritySummary must be an object');
  } else {
    for (const key of PRIORITIES) {
      if (typeof data.prioritySummary[key] !== 'number') {
        errors.push(`prioritySummary.${key} must be a number`);
      }
    }
  }

  if (errors.length) {
    return { valid: false, errors, data: null };
  }

  return {
    valid: true,
    errors: [],
    data: {
      overallAssessment: data.overallAssessment.trim(),
      overallScore:
        data.overallScore === undefined ? null : data.overallScore,
      issues: data.issues,
      recommendations: data.recommendations,
      positiveObservations: data.positiveObservations,
      prioritySummary: data.prioritySummary,
      dataAvailability: data.dataAvailability || null,
    },
  };
}

function buildPrompt(context) {
  return `You are an expert SEO analyst. Analyze ONLY the provided audit JSON.
Do not invent findings that are not supported by the data.
If a source is missing or failed, say so explicitly.
Return ONLY valid JSON with this shape:
{
  "overallAssessment": "string",
  "overallScore": number|null,
  "issues": [{"id":"string","priority":"critical|high|medium|low","title":"string","whyItMatters":"string","suggestedFix":"string","affectedUrls":["string"],"source":"string"}],
  "recommendations": [{"id":"string","priority":"critical|high|medium|low","action":"string","rationale":"string","affectedUrls":["string"]}],
  "positiveObservations": ["string"],
  "prioritySummary": {"critical":0,"high":0,"medium":0,"low":0}
}

AUDIT_CONTEXT:
${JSON.stringify(context)}`;
}

function extractJsonObject(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('Empty AI response');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('AI response was not valid JSON');
  }
}

async function callAnthropic(context) {
  const response = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': integrations.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: integrations.anthropic.model,
        max_tokens: integrations.anthropic.maxTokens,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: buildPrompt(context),
          },
        ],
      }),
    }),
    integrations.timeoutMs,
    'Claude AI'
  );

  if (response.status === 401 || response.status === 403) {
    throw new Error('Claude API authentication failed');
  }

  if (response.status === 429) {
    throw new Error('Claude API rate limit exceeded');
  }

  if (!response.ok) {
    throw new Error(`Claude API unavailable (${response.status})`);
  }

  const json = await response.json();
  const text = (json?.content || [])
    .filter((part) => part?.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();

  return extractJsonObject(text);
}

/**
 * Generate SEO analysis via Claude (mock or live Anthropic API).
 */
export async function analyzeSeoWithClaude(context = {}) {
  const source = 'claude-ai';

  if (!context || typeof context !== 'object') {
    return buildIntegrationResponse({
      source,
      success: false,
      mock: integrations.useMocks,
      errors: ['AI analysis context is required'],
    });
  }

  const hasAnySignal =
    context.crawl ||
    context.integrations ||
    (Array.isArray(context.criticalIssues) && context.criticalIssues.length) ||
    (Array.isArray(context.importantIssues) &&
      context.importantIssues.length) ||
    context.scores;

  if (!hasAnySignal) {
    return buildIntegrationResponse({
      source,
      success: false,
      mock: integrations.useMocks,
      errors: ['Insufficient audit data for AI analysis'],
    });
  }

  if (integrations.useMocks) {
    const mockData = getMockClaudeSeoAnalysis(context);
    const validated = validateClaudeAnalysisData(mockData);

    if (!validated.valid) {
      return buildIntegrationResponse({
        source,
        success: false,
        mock: true,
        errors: validated.errors,
      });
    }

    return buildIntegrationResponse({
      source,
      success: true,
      mock: true,
      data: validated.data,
    });
  }

  if (!hasAnthropicCredentials()) {
    return buildIntegrationResponse({
      source,
      success: false,
      mock: false,
      errors: ['Anthropic API key is not configured'],
    });
  }

  try {
    const raw = await callAnthropic(context);
    const validated = validateClaudeAnalysisData(raw);

    if (!validated.valid) {
      return buildIntegrationResponse({
        source,
        success: false,
        mock: false,
        errors: [
          'Invalid AI response structure',
          ...validated.errors.slice(0, 5),
        ],
      });
    }

    return buildIntegrationResponse({
      source,
      success: true,
      mock: false,
      data: validated.data,
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
