/**
 * report-generator.js
 * QA 검증 결과를 JSON / CSV 형식으로 reports 폴더에 저장한다.
 */

import { formatResultStatus } from './link-validator.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 리포트·파일명에 사용하는 한국 표준시 타임존 */
const KST_TIMEZONE = 'Asia/Seoul';

/**
 * Date 또는 ISO 문자열을 한국 시간(KST) 기준 연·월·일·시·분·초로 분해한다.
 * @param {string|Date} dateInput - ISO 8601 문자열 또는 Date 객체
 * @returns {{ year: string, month: string, day: string, hour: string, minute: string, second: string }}
 */
function toKstParts(dateInput) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/**
 * 한국 시간 기준 표시용 날짜 문자열 (CSV 검사날짜 등)
 * 예: 2026-06-22 19:30:00
 * @param {string|Date} dateInput - ISO 8601 문자열 또는 Date 객체
 * @returns {string}
 */
function formatKstDateTime(dateInput) {
  const { year, month, day, hour, minute, second } = toKstParts(dateInput);
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * 한국 시간 기준 파일명용 타임스탬프
 * 예: 2026-06-22_19-30-00
 * @param {string|Date} dateInput - ISO 8601 문자열 또는 Date 객체
 * @returns {string}
 */
function toKstFileTimestamp(dateInput) {
  const { year, month, day, hour, minute, second } = toKstParts(dateInput);
  return `${year}-${month}-${day}_${hour}-${minute}-${second}`;
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

function formatNewTabLabel(isNewTab) {
  return isNewTab ? 'Y' : 'N';
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
    '새창',
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
    formatNewTabLabel(r.isNewTab),
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
  const dateLine = `검사날짜,${escapeCsvField(formatKstDateTime(inspectedAt))}`;
  const sessionBlocks = allResults.map((session) => sessionToCsv(session));

  return [dateLine, '', ...sessionBlocks].join('\n\n');
}

/**
 * 세션 결과를 국가코드별로 그룹화한다.
 * @param {object[]} allResults
 * @returns {Map<string, object[]>}
 */
function groupResultsByCountry(allResults) {
  const groups = new Map();

  for (const session of allResults) {
    const code = session.countryCode;
    if (!groups.has(code)) {
      groups.set(code, []);
    }
    groups.get(code).push(session);
  }

  return groups;
}

/**
 * 리포트 파일명을 생성한다. (국가코드 suffix 포함)
 * @param {string} timestamp - KST 파일명용 타임스탬프
 * @param {string} countryCode - 국가 코드
 * @param {'json'|'csv'} ext
 */
function buildReportFilename(timestamp, countryCode, ext) {
  return `link-qa-report_${timestamp}_${countryCode}.${ext}`;
}

/**
 * 여러 세션 결과를 하나의 JSON 리포트 파일로 저장한다.
 * @param {object[]} countryResults - 단일 국가의 검증 세션 결과
 * @param {string} outputDir
 * @param {string} countryCode
 * @returns {string} 저장된 파일 경로
 */
function writeJsonReport(countryResults, outputDir, countryCode) {
  const reportDate = countryResults[0]?.inspectedAt || new Date();
  const timestamp = toKstFileTimestamp(reportDate);
  const filename = buildReportFilename(timestamp, countryCode, 'json');
  const filePath = join(outputDir, filename);

  const report = {
    generatedAt: formatKstDateTime(new Date()),
    generatedAtTimezone: 'Asia/Seoul',
    countryCode,
    totalSessions: countryResults.length,
    sessions: countryResults,
  };

  writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
  return filePath;
}

/**
 * 여러 세션 결과를 하나의 CSV 리포트 파일로 저장한다.
 * @param {object[]} countryResults - 단일 국가의 검증 세션 결과
 * @param {string} outputDir
 * @param {string} countryCode
 * @returns {string} 저장된 파일 경로
 */
function writeCsvReport(countryResults, outputDir, countryCode) {
  const reportDate = countryResults[0]?.inspectedAt || new Date();
  const timestamp = toKstFileTimestamp(reportDate);
  const filename = buildReportFilename(timestamp, countryCode, 'csv');
  const filePath = join(outputDir, filename);

  const content = buildCsvContent(countryResults);
  writeFileSync(filePath, `\uFEFF${content}`, 'utf-8');
  return filePath;
}

/**
 * settings.report 설정에서 JSON/CSV 생성 여부를 해석한다.
 * - json / csv boolean 우선 (기본값: json false, csv true)
 * - formats 배열은 하위 호환용
 * @param {object} reportConfig - settings.json의 report 객체
 * @returns {{ outputDir: string, json: boolean, csv: boolean }}
 */
function resolveReportOptions(reportConfig = {}) {
  const outputDir = reportConfig.outputDir || 'reports';

  // legacy: formats: ["json", "csv"]
  if (Array.isArray(reportConfig.formats)) {
    return {
      outputDir,
      json: reportConfig.formats.includes('json'),
      csv: reportConfig.formats.includes('csv'),
    };
  }

  return {
    outputDir,
    json: reportConfig.json ?? false,
    csv: reportConfig.csv ?? true,
  };
}

/**
 * settings.report 설정에 따라 JSON/CSV 리포트를 생성한다.
 * @param {object[]} allResults - 전체 검증 세션 결과
 * @param {object} reportConfig - settings.json의 report 객체
 * @returns {string[]} 생성된 파일 경로 목록
 */
export function generateReports(allResults, reportConfig) {
  const { outputDir, json, csv } = resolveReportOptions(reportConfig);
  mkdirSync(outputDir, { recursive: true });

  const savedFiles = [];
  const countryGroups = groupResultsByCountry(allResults);

  for (const [countryCode, countryResults] of countryGroups) {
    if (json) {
      savedFiles.push(writeJsonReport(countryResults, outputDir, countryCode));
    }

    if (csv) {
      savedFiles.push(writeCsvReport(countryResults, outputDir, countryCode));
    }
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
