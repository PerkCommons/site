import { readFile } from 'node:fs/promises';

/**
 * The pinned release's Google Peer Bonus winner URL started returning 404
 * after the report was published. Track this single existing issue without
 * disabling live URL auditing or excusing ANY other broken links.
 *
 * https://github.com/PerkCommons/data/issues/12
 */
const EXISTING_BROKEN_LINK = 'https://opensource.google/programs-and-services/peer-bonus/winner';
const EXISTING_BROKEN_FILE = 'google-open-source-peer-bonus.json';

const [exitArg, reportFile] = process.argv.slice(2);
const auditExit = Number(exitArg);
if (!Number.isInteger(auditExit) || !reportFile || auditExit < 0)
  throw new Error('Usage: node scripts/verify-source-audit.mjs <audit-exit-code> <report-path>');
const report = JSON.parse(await readFile(reportFile, 'utf8'));
if (report.reportVersion !== 2 || !Array.isArray(report.records)) throw new Error('Unrecognized canonical source audit report');
const broken = report.records.filter((record) => record.status === 'broken');
if ((report.counts?.broken ?? 0) !== broken.length) throw new Error('Source audit broken count is inconsistent');
const unexpected = broken.filter((record) =>
  record.file !== EXISTING_BROKEN_FILE ||
  record.url !== EXISTING_BROKEN_LINK ||
  !['sourceUrl','officialUrl'].includes(record.field) ||
  record.httpStatus !== 404,
);
if (unexpected.length) {
  console.error('New broken source URLs require canonical data review:', JSON.stringify(unexpected));
  process.exitCode = 1;
} else if (auditExit !== 0 && !broken.length) {
  console.error(`Source audit failed (exit code ${auditExit}) without any reported broken URL.`);
  process.exitCode = 1;
} else if (broken.length > 2) {
  console.error('Unexpected duplicate known-link failure count:', broken.length);
  process.exitCode = 1;
} else if (broken.length) {
  console.warn(`Warning: ${broken.length} known Google Peer Bonus URL result(s) returned HTTP 404. See PerkCommons/data#12. Any other broken source remains a CI failure.`);
} else {
  console.log('Canonical source URL audit: no broken links.');
}
