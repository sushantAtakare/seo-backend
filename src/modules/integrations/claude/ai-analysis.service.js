import prisma from '../../../config/prisma.js';
import { analyzeSeoWithClaude } from './claude.service.js';

function buildAiContext(audit) {
  const recommendations =
    audit.result?.recommendations &&
    typeof audit.result.recommendations === 'object'
      ? audit.result.recommendations
      : {};

  return {
    auditId: audit.id,
    url: audit.site?.url || null,
    domain: audit.site?.domain || null,
    scores: {
      overallScore: audit.overallScore ?? null,
      technicalSeo: audit.result?.technicalSeo ?? null,
      onPageSeo: audit.result?.onPageSeo ?? null,
      performance: audit.result?.performance ?? null,
      mobileFriendliness: audit.result?.mobileFriendliness ?? null,
      contentQuality: audit.result?.contentQuality ?? null,
      schemaMarkup: audit.result?.schemaMarkup ?? null,
    },
    criticalIssues: audit.result?.criticalIssues || [],
    importantIssues: audit.result?.importantIssues || [],
    warnings: audit.result?.warnings || [],
    passedChecks: audit.result?.passedChecks || [],
    crawl: recommendations.crawl || null,
    integrations: recommendations.integrations || null,
  };
}

/**
 * Run Claude AI SEO analysis for an audit and persist under recommendations.aiAnalysis.
 * Never erases crawl/integration data. AI failure is recorded without failing the audit.
 */
export async function enrichAuditWithAiAnalysis(auditId) {
  const audit = await prisma.audit.findUnique({
    where: { id: auditId },
    include: {
      site: true,
      result: true,
    },
  });

  if (!audit?.result) {
    return {
      auditId,
      skipped: true,
      reason: 'AuditResult not found',
    };
  }

  const context = buildAiContext(audit);
  const aiAnalysis = await analyzeSeoWithClaude(context);

  const existingRecommendations =
    audit.result.recommendations &&
    typeof audit.result.recommendations === 'object'
      ? { ...audit.result.recommendations }
      : {};

  // Preserve crawl + integrations; only set/replace aiAnalysis envelope
  existingRecommendations.aiAnalysis = aiAnalysis;

  await prisma.auditResult.update({
    where: { auditId },
    data: {
      recommendations: existingRecommendations,
    },
  });

  // Optionally adopt AI overallScore only when present and audit already has a score baseline
  if (
    aiAnalysis.success &&
    typeof aiAnalysis.data?.overallScore === 'number' &&
    typeof audit.overallScore === 'number'
  ) {
    const blended = Math.round(
      audit.overallScore * 0.7 + aiAnalysis.data.overallScore * 0.3
    );

    await prisma.audit.update({
      where: { id: auditId },
      data: {
        overallScore: blended,
        status: 'COMPLETED',
      },
    });
  }

  return {
    auditId,
    skipped: false,
    success: aiAnalysis.success,
    mock: aiAnalysis.mock,
    aiAnalysis,
  };
}
