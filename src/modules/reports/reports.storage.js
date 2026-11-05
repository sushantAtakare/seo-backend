import fs from 'fs/promises';
import path from 'path';
import env from '../../config/env.js';

/**
 * Resolve absolute reports directory and ensure it exists.
 */
export async function getReportsDir() {
  const configured = env.reports.dir || 'storage/reports';
  const absolute = path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);

  await fs.mkdir(absolute, { recursive: true });
  return absolute;
}

/**
 * Check whether a PDF file exists on disk.
 */
export async function pdfFileExists(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort delete of a previous PDF file.
 */
export async function deletePdfIfExists(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch {
    // ignore missing/unreadable files
  }
}
