import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';
import { buildReportHtml } from './reports.template.js';
import { getReportsDir } from './reports.storage.js';

/**
 * Generate a PDF file for report data and return absolute file path.
 */
export async function generateReportPdf(reportId, reportData) {
  const reportsDir = await getReportsDir();
  const fileName = `report-${reportId}.pdf`;
  const absolutePath = path.join(reportsDir, fileName);

  const html = buildReportHtml(reportData);

  let browser;
  try {
    const launchOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    };

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    await page.pdf({
      path: absolutePath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="width:100%;font-size:9px;color:#6b7280;padding:0 14mm;display:flex;justify-content:space-between;">
          <span>SEO Automation Dashboard</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
      `,
      margin: {
        top: '16mm',
        bottom: '18mm',
        left: '14mm',
        right: '14mm',
      },
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  await fs.access(absolutePath);
  return absolutePath;
}
