/**
 * report-generator.js
 * QA 검증 결과를 JSON / CSV 형식으로 reports 폴더에 저장한다.
 */

import { formatResultStatus } from './link-validator.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ISO 날짜 문자열을 파일명용 형식으로 변환한다.
 * 예: 2026-06-22T10:30:00.000Z → 2026-06-22_10-30-00
 * @param {string} isoString - ISO 8601 날짜
 * @returns {string} 파일명용 타임스탬프
 */
function toFileTimestamp(isoString) {
  return isoString.replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * CSV 필드값에 쉼표/줄바꿈/따옴표가 포함될 경우 이스케이프 처리한다.
 * @param {string|null|undefined} value - CSV 셀 값
 * @returns {string} 이스케이프된 문자열
 */
function escapeCsvField(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * 단일 검증 세션 결과를 CSV 문자열로 변환한다.
 * 검사날짜는 파일/블록 상단에 별도 기록하므로 데이터 행에는 포함하지 않는다.
 * @param {object} sessionResult - runLinkCheck() 반환값
 * @returns {string} CSV 본문
 */
function sessionToCsv(sessionResult) {
  const headers = [
    '국가코드',
    '영역',
    '디바이스',
    'CTA명',
    '링크경로',
    '최종URL',
    '결과',
    '실패원인',
  ];

  const rows = sessionResult.results.map((r) => [
    sessionResult.countryCode,
    sessionResult.areaId,
    sessionResult.deviceLabel || sessionResult.deviceType || '',
    r.ctaName,
    r.linkPath,
    r.finalUrl || '',
    formatResultStatus(r.status),
    r.reason || '',
  ]);

  const sessionHeader = `# ${sessionResult.countryCode} / ${sessionResult.areaId} / ${sessionResult.deviceLabel || sessionResult.deviceType}`;

  const lines = [
    sessionHeader,
    headers.map(escapeCsvField).join(','),
    ...rows.map((row) => row.map(escapeCsvField).join(',')),
  ];

  return lines.join('\n');
}

/**
 * 전체 세션 결과를 하나의 CSV 문자열로 조합한다.
 * 검사날짜는 맨 위에 한 번만 기록한다.
 * @param {object[]} allResults - 검증 세션 결과 배열
 * @returns {string} CSV 본문
 */
function buildCsvContent(allResults) {
  const inspectedAt = allResults[0]?.inspectedAt || new Date().toISOString();
  const dateLine = `검사날짜,${escapeCsvField(inspectedAt)}`;
  const sessionBlocks = allResults.map((session) => sessionToCsv(session));

  return [dateLine, '', ...sessionBlocks].join('\n\n');
}

/**
 * 여러 세션 결과를 하나의 JSON 리포트 파일로 저장한다.
 * @param {object[]} allResults - 검증 세션 결과 배열
 * @param {string} outputDir - 저장 디렉터리 경로
 * @returns {string} 저장된 파일 경로
 */
function writeJsonReport(allResults, outputDir) {
  const timestamp = toFileTimestamp(allResults[0]?.inspectedAt || new Date().toISOString());
  const filename = `link-qa-report_${timestamp}.json`;
  const filePath = join(outputDir, filename);

  const report = {
    generatedAt: new Date().toISOString(),
    totalSessions: allResults.length,
    sessions: allResults,
  };

  writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
  return filePath;
}

/**
 * 여러 세션 결과를 하나의 CSV 리포트 파일로 저장한다.
 * @param {object[]} allResults - 검증 세션 결과 배열
 * @param {string} outputDir - 저장 디렉터리 경로
 * @returns {string} 저장된 파일 경로
 */
function writeCsvReport(allResults, outputDir) {
  const timestamp = toFileTimestamp(allResults[0]?.inspectedAt || new Date().toISOString());
  const filename = `link-qa-report_${timestamp}.csv`;
  const filePath = join(outputDir, filename);

  const content = buildCsvContent(allResults);
  // Excel(Windows)에서 UTF-8 한글이 깨지지 않도록 BOM 추가
  writeFileSync(filePath, `\uFEFF${content}`, 'utf-8');
  return filePath;
}

/**
 * settings.report.formats 에 따라 JSON/CSV 리포트를 생성한다.
 * @param {object[]} allResults - 전체 검증 세션 결과
 * @param {object} reportConfig - settings.json의 report 객체
 * @returns {string[]} 생성된 파일 경로 목록
 */
export function generateReports(allResults, reportConfig) {
  const outputDir = reportConfig.outputDir || 'reports';
  mkdirSync(outputDir, { recursive: true });

  const savedFiles = [];
  const formats = reportConfig.formats || ['json'];

  if (formats.includes('json')) {
    savedFiles.push(writeJsonReport(allResults, outputDir));
  }

  if (formats.includes('csv')) {
    savedFiles.push(writeCsvReport(allResults, outputDir));
  }

  return savedFiles;
}

/**
 * 콘솔에 검증 요약 테이블을 출력한다.
 * @param {object[]} allResults - 전체 검증 세션 결과
 */
export function printSummary(allResults) {
  console.log('\n========== QA 검증 요약 ==========');

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalNeedsCheck = 0;

  for (const session of allResults) {
    const { summary } = session;
    totalPassed += summary.passed;
    totalFailed += summary.failed;
    totalSkipped += summary.skipped;
    totalNeedsCheck += summary.needsCheck ?? 0;

    const deviceLabel = session.deviceLabel || session.deviceType || '';
    const needsCheckPart =
      (summary.needsCheck ?? 0) > 0 ? ` | 체크필요 ${summary.needsCheck}` : '';
    console.log(
      `[${session.countryCode}] ${session.areaId} (${deviceLabel}): ` +
        `총 ${summary.total} | Pass ${summary.passed} | Fail ${summary.failed} | Skip ${summary.skipped}${needsCheckPart}`
    );
  }

  console.log('----------------------------------');
  const needsCheckTotalPart = totalNeedsCheck > 0 ? ` | 체크필요 ${totalNeedsCheck}` : '';
  console.log(
    `전체: Pass ${totalPassed} | Fail ${totalFailed} | Skip ${totalSkipped}${needsCheckTotalPart}`
  );
  console.log('==================================\n');
}
