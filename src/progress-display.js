/**
 * progress-display.js
 * CLI 터미널에 QA 검증 진행 상황을 간략하게 출력하는 모듈
 */

/**
 * 긴 문자열을 CLI 한 줄에 맞게 잘라낸다.
 * @param {string} text - 원본 문자열
 * @param {number} maxLen - 최대 길이
 * @returns {string} 잘린 문자열
 */
function truncate(text, maxLen = 45) {
  const str = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 3)}...`;
}

/**
 * 전체 QA 실행의 진행 상황을 추적하고 CLI에 출력한다.
 */
export class ProgressTracker {
  /**
   * @param {number} totalSessions - 국가×영역 조합 총 개수
   */
  constructor(totalSessions) {
    this.totalSessions = totalSessions;
    this.currentSession = 0;
    this.sessionLabel = '';
    this.linkTotal = 0;
    this.linkCurrent = 0;
  }

  /**
   * @param {number} sessionIndex
   * @param {string} countryCode
   * @param {string} countryName
   * @param {string} areaId
   * @param {string} areaName
   * @param {string} [deviceLabel] - PC | Mobile
   */
  startSession(sessionIndex, countryCode, countryName, areaId, areaName, deviceLabel) {
    this.currentSession = sessionIndex;
    const devicePart = deviceLabel ? ` (${deviceLabel})` : '';
    this.sessionLabel = `[${countryCode}] ${countryName} / ${areaId}${devicePart}`;
    this.linkTotal = 0;
    this.linkCurrent = 0;

    console.log(
      `\n━━━ [${sessionIndex}/${this.totalSessions}] ${this.sessionLabel} ━━━`
    );
  }

  /**
   * 페이지 로딩 단계 출력
   * @param {string} baseUrl - 접속 URL
   */
  logPageLoading(baseUrl) {
    console.log(`  ⏳ 페이지 로딩... ${truncate(baseUrl, 60)}`);
  }

  /**
   * 링크 수집 완료 출력
   * @param {number} linkCount - 수집된 링크 수
   */
  logLinksCollected(linkCount) {
    this.linkTotal = linkCount;
    console.log(`  📋 링크 ${linkCount}개 발견, 검증 시작`);
  }

  /**
   * 영역 selector 미발견 등 세션 단위 오류 출력
   * @param {string} message - 오류 메시지
   */
  logSessionError(message) {
    console.log(`  ✗ 오류: ${message}`);
  }

  /**
   * 단일 링크 검증 결과 출력
   * @param {object} params
   * @param {number} params.index - 현재 링크 순번 (1-based)
   * @param {number} params.total - 전체 링크 수
   * @param {string} params.status - pass | fail | skipped | needs_check
   * @param {string} params.ctaName - CTA명
   * @param {string} params.href - 링크 경로
   * @param {string|null} params.reason - 실패/스킵 사유
   */
  logLinkResult({ index, total, status, ctaName, href, reason }) {
    this.linkCurrent = index;

    const statusIcon = { pass: '✓', fail: '✗', skipped: '−', needs_check: '?' }[status] ?? '?';
    const prefix = `[${index}/${total}]`;

    console.log(
      `  ${prefix} ${statusIcon} ${truncate(ctaName, 30)} → ${truncate(href, 35)}`
    );

    // fail/skipped일 때만 사유 한 줄 추가
    if (reason && status !== 'pass') {
      console.log(`         └ ${truncate(reason, 55)}`);
    }
  }

  /**
   * 세션 완료 요약 출력
   * @param {{ passed: number, failed: number, skipped: number, needsCheck?: number, total: number }} summary
   */
  logSessionComplete(summary) {
    const needsCheckPart =
      (summary.needsCheck ?? 0) > 0 ? ` | 체크필요 ${summary.needsCheck}` : '';
    console.log(
      `  ✅ 완료 — Pass ${summary.passed} | Fail ${summary.failed} | Skip ${summary.skipped}${needsCheckPart} (총 ${summary.total})`
    );
  }

  /**
   * @param {number} countryCount
   * @param {number} areaCount
   * @param {Array} inspectionTasks - expandInspectionTasks() 결과
   * @param {boolean} showBrowser
   */
  static logRunStart(countryCount, areaCount, inspectionTasks, showBrowser, parallelCountries = false) {
    const deviceSummary = inspectionTasks
      .map((t) => `${t.area.id}(${t.deviceLabel})`)
      .join(', ');

    const parallelLabel = parallelCountries && countryCount > 1 ? ' | 국가 병렬: ON' : '';

    console.log('\n========================================');
    console.log('  Link QA 검증 실행');
    console.log(`  국가 ${countryCount}개 × 검사 ${inspectionTasks.length}건 (영역 ${areaCount}개)${parallelLabel}`);
    console.log(`  검사 대상: ${deviceSummary}`);
    console.log(`  브라우저: ${showBrowser ? '표시 (Headed)' : '숨김 (Headless)'}`);
    console.log('========================================');
  }
}

/**
 * settings.json과 CLI 옵션에서 브라우저 UI 표시 여부를 결정한다.
 * 우선순위: CLI --headed/--headless > settings.browser.showBrowser > settings.browser.headless(legacy)
 * @param {object} settings - settings.json
 * @param {object} options - { headless: boolean|null }
 * @returns {boolean} true면 브라우저 UI 표시
 */
export function resolveShowBrowser(settings, options = {}) {
  // CLI에서 headless 명시 시 showBrowser는 그 반대값
  if (options.headless !== null && options.headless !== undefined) {
    return !options.headless;
  }

  // settings.json showBrowser 옵션 (권장)
  if (settings.browser?.showBrowser !== undefined) {
    return settings.browser.showBrowser;
  }

  // 하위 호환: headless 옵션이 있으면 반전
  if (settings.browser?.headless !== undefined) {
    return !settings.browser.headless;
  }

  return false;
}
