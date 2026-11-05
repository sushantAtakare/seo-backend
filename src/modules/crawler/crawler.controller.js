import ApiResponse from '../../utils/ApiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';
import * as crawlerService from './crawler.service.js';

export const crawlAudit = asyncHandler(async (req, res) => {
  const result = await crawlerService.crawlAudit(req.user, req.params.id, {
    maxPages: req.body.maxPages,
    maxDepth: req.body.maxDepth,
    timeoutMs: req.body.timeoutMs,
    sameDomainOnly: req.body.sameDomainOnly,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, result, 'Crawl completed successfully'));
});
