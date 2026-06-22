/**
 * link-validator.js
 * 링크 클릭 후 도메인/HTTP 상태/에러 페이지 여부를 판별하는 검증 로직
 */

/**
 * 내부 status 코드를 리포트/CLI 표시용 라벨로 변환한다.
 * needs_check → '체크필요' (새창 링크의 외부·타국가 도메인 등 수동 확인 대상)
 * @param {string} status - pass | fail | skipped | needs_check
 * @returns {string} 표시용 결과 라벨
 */
export function formatResultStatus(status) {
  const labels = {
    pass: 'pass',
    fail: 'fail',
    skipped: 'skipped',
    needs_check: '체크필요',
  };
  return labels[status] ?? status;
}

/**
 * a 태그 target 속성이 새 창(_blank)으로 열리는지 판별한다.
 * @param {string|null|undefined} target - a 태그의 target 속성값
 * @returns {boolean} 새 창 링크이면 true
 */
export function isBlankTarget(target) {
  return (target || '').trim().toLowerCase() === '_blank';
}

/**
 * URL에서 호스트명만 추출한다 (포트 제외, 소문자 정규화).
 * @param {string} urlString - 검사할 URL
 * @returns {string|null} 호스트명 또는 파싱 실패 시 null
 */
export function extractHostname(urlString) {
  try {
    return new URL(urlString).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * baseUrl에서 국가 경로 prefix를 추출한다.
 * 예: https://www.lg.com/uk/business/ → /uk/
 * @param {string} baseUrl - 국가 config의 baseUrl
 * @returns {string|null} 국가 경로 prefix 또는 추출 실패 시 null
 */
export function extractPathPrefixFromBaseUrl(baseUrl) {
  try {
    const segments = new URL(baseUrl).pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    return `/${segments[0]}/`;
  } catch {
    return null;
  }
}

/**
 * pathPrefix 문자열을 /uk/ 형태로 정규화한다.
 * @param {string} pathPrefix - config의 pathPrefix 또는 baseUrl에서 추출한 값
 * @returns {string} 슬래시로 감싼 소문자 prefix (예: /uk/)
 */
function normalizePathPrefix(pathPrefix) {
  let normalized = pathPrefix.trim().toLowerCase();
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  if (!normalized.endsWith('/')) normalized = `${normalized}/`;
  return normalized;
}

/**
 * 최종 URL의 pathname이 선택한 국가 경로 prefix에 해당하는지 확인한다.
 * 같은 도메인(lg.com) 내에서 /uk/ → /global/ 등 다른 국가 경로로 이동하면 fail.
 * @param {string} finalUrl - 클릭 후 도착한 URL
 * @param {string} pathPrefix - 국가 config의 pathPrefix (예: /uk/)
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateCountryPath(finalUrl, pathPrefix) {
  if (!pathPrefix) {
    return { valid: true };
  }

  try {
    const pathname = new URL(finalUrl).pathname.toLowerCase();
    const prefix = normalizePathPrefix(pathPrefix);
    // /uk 와 /uk/..., /uk/business/... 모두 허용
    const prefixWithoutTrailing = prefix.slice(0, -1);

    const isMatchingPath =
      pathname === prefixWithoutTrailing || pathname.startsWith(prefix);

    if (!isMatchingPath) {
      return {
        valid: false,
        reason: `다른 국가 경로로 이동됨 (현재: ${pathname}, 허용: ${prefix}*)`,
      };
    }
  } catch {
    return { valid: false, reason: 'URL 경로 파싱 실패' };
  }

  return { valid: true };
}

/**
 * javascript:, mailto:, tel:, 순수 앵커(#) 링크는 스킵한다.
 * @param {string} href - a 태그의 href 속성값
 * @param {string[]} skipPatterns - settings.json의 정규식 패턴 배열
 * @returns {boolean} true면 검증 제외
 */
export function shouldSkipLink(href, skipPatterns) {
  if (!href || href.trim() === '') return true;

  return skipPatterns.some((pattern) => {
    const regex = new RegExp(pattern, 'i');
    return regex.test(href.trim());
  });
}

/**
 * 최종 URL의 도메인이 선택한 국가의 허용 도메인 목록에 포함되는지 확인한다.
 * 다른 국가 도메인으로 이동한 경우 fail 처리에 사용한다.
 * @param {string} finalUrl - 클릭 후 도착한 URL
 * @param {string[]} allowedDomains - 국가 config의 allowedDomains
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateDomain(finalUrl, allowedDomains) {
  const hostname = extractHostname(finalUrl);

  if (!hostname) {
    return { valid: false, reason: 'URL 파싱 실패' };
  }

  const normalizedAllowed = allowedDomains.map((d) => d.toLowerCase());
  const isAllowed = normalizedAllowed.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );

  if (!isAllowed) {
    return {
      valid: false,
      reason: `허용되지 않은 도메인으로 이동됨 (현재: ${hostname}, 허용: ${normalizedAllowed.join(', ')})`,
    };
  }

  return { valid: true };
}

/**
 * HTTP 상태 코드가 에러로 분류되는지 확인한다.
 * @param {number|null} status - HTTP 응답 상태 코드
 * @param {number[]} errorStatusCodes - settings.json의 errorDetection.httpStatusCodes
 * @returns {{ isError: boolean, reason?: string }}
 */
export function validateHttpStatus(status, errorStatusCodes) {
  if (status === null || status === undefined) {
    return { isError: false };
  }

  if (errorStatusCodes.includes(status)) {
    return {
      isError: true,
      reason: `HTTP ${status} 에러 응답`,
    };
  }

  return { isError: false };
}

/**
 * URL 경로, 페이지 title, body 텍스트에서 에러 페이지 패턴을 탐지한다.
 * @param {object} pageInfo - { url, title, bodyText }
 * @param {object} errorDetection - settings.json의 errorDetection 객체
 * @returns {{ isError: boolean, reason?: string }}
 */
export function detectErrorPage(pageInfo, errorDetection) {
  const { url, title, bodyText } = pageInfo;
  const lowerUrl = (url || '').toLowerCase();
  const lowerTitle = (title || '').toLowerCase();
  const lowerBody = (bodyText || '').toLowerCase().slice(0, 3000);

  // URL 경로에 404, not-found 등 에러 패턴 포함 여부
  for (const pattern of errorDetection.urlPatterns) {
    if (lowerUrl.includes(pattern.toLowerCase())) {
      return {
        isError: true,
        reason: `에러 URL 패턴 감지: "${pattern}" (URL: ${url})`,
      };
    }
  }

  // 페이지 title에 404, Not Found 등 포함 여부
  for (const pattern of errorDetection.titlePatterns) {
    if (lowerTitle.includes(pattern.toLowerCase())) {
      return {
        isError: true,
        reason: `에러 페이지 title 감지: "${pattern}" (title: ${title})`,
      };
    }
  }

  // body 텍스트에 "페이지를 찾을 수 없습니다" 등 포함 여부
  for (const pattern of errorDetection.bodyTextPatterns) {
    if (lowerBody.includes(pattern.toLowerCase())) {
      return {
        isError: true,
        reason: `에러 페이지 본문 텍스트 감지: "${pattern}"`,
      };
    }
  }

  return { isError: false };
}

/**
 * 도메인/국가 경로 검증 실패 시 새 창 링크면 fail 대신 needs_check(체크필요)로 완화한다.
 * HTTP 에러·에러 페이지는 새 창 여부와 관계없이 항상 fail.
 * @param {'fail'|'needs_check'} strictStatus - isNewTab이 false일 때 사용할 status
 * @param {boolean} isNewTab - target="_blank" 새 창 링크 여부
 * @param {string} reason - 실패/체크필요 사유
 * @returns {{ status: 'fail'|'needs_check', reason: string }}
 */
function resolveDomainOrPathResult(strictStatus, isNewTab, reason) {
  if (isNewTab) {
    // 새 창 링크: 외부·타국가 도메인은 허용하되 수동 확인 대상으로 표시
    return { status: 'needs_check', reason };
  }
  return { status: strictStatus, reason };
}

/**
 * 단일 링크 검증 결과를 종합하여 pass/fail/needs_check를 결정한다.
 * @param {object} params - 검증에 필요한 모든 데이터
 * @param {boolean} [params.isNewTab=false] - target="_blank" 새 창 링크 여부
 * @returns {{ status: 'pass'|'fail'|'needs_check', reason: string|null }}
 */
export function determineResult({
  httpStatus,
  finalUrl,
  pageInfo,
  allowedDomains,
  pathPrefix,
  errorDetection,
  isNewTab = false,
}) {
  // 1. HTTP 상태 코드 검사 (새 창 여부와 무관하게 fail)
  const httpCheck = validateHttpStatus(httpStatus, errorDetection.httpStatusCodes);
  if (httpCheck.isError) {
    return { status: 'fail', reason: httpCheck.reason };
  }

  // 2. 도메인 검사 (허용 도메인 외부 이동 여부)
  const domainCheck = validateDomain(finalUrl, allowedDomains);
  if (!domainCheck.valid) {
    return resolveDomainOrPathResult('fail', isNewTab, domainCheck.reason);
  }

  // 3. 국가 경로 검사 (같은 도메인 내 다른 국가 경로 이동 여부, 예: /uk/ → /global/)
  const pathCheck = validateCountryPath(finalUrl, pathPrefix);
  if (!pathCheck.valid) {
    return resolveDomainOrPathResult('fail', isNewTab, pathCheck.reason);
  }

  // 4. 에러 페이지 패턴 검사 (새 창 여부와 무관하게 fail)
  const errorCheck = detectErrorPage(pageInfo, errorDetection);
  if (errorCheck.isError) {
    return { status: 'fail', reason: errorCheck.reason };
  }

  return { status: 'pass', reason: null };
}
