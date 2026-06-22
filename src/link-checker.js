/**
 * link-checker.js
 * Playwright로 페이지에 접속하여 지정 영역 내 링크를 수집하고 검증을 수행한다.
 *
 * 검증 방식 (settings.browser.verificationMode):
 * - navigate: href URL로 직접 이동 (GNB 숨김 메뉴 등 visibility 문제 없음) — 기본값
 * - click:    DOM 요소 실제 클릭 (보이는 링크만 안정적)
 */

import { chromium } from 'playwright';
import { shouldSkipLink, determineResult, extractPathPrefixFromBaseUrl, isBlankTarget } from './link-validator.js';
import { resolveShowBrowser } from './progress-display.js';

/**
 * 쿠키 배너 등 페이지 오버레이를 닫는다 (있을 경우).
 * @param {import('playwright').Page} page
 */
async function dismissOverlays(page) {
  const acceptSelectors = [
    '#onetrust-accept-btn-handler',
    'button[id*="accept"]',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("Agree")',
    '.cmp-button--accept',
  ];

  for (const selector of acceptSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await btn.click({ timeout: 3000 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
      break;
    }
  }
}

/**
 * 영역(Footer 등)이 lazy load 되는 경우를 위해 스크롤 후 selector 대기
 * @param {import('playwright').Page} page
 * @param {string} areaSelector
 * @param {number} timeout
 */
async function waitForArea(page, areaSelector, timeout) {
  // 페이지 하단까지 스크롤 → Footer lazy load 유도
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // GNB는 상단, Footer는 하단이므로 양쪽 스크롤
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((resolve) => setTimeout(resolve, 500));

  await page.waitForSelector(areaSelector, { state: 'attached', timeout });
}

/**
 * @param {string} href - a 태그 href
 * @param {string} baseUrl - 국가 baseUrl
 * @returns {string|null} 절대 URL 또는 파싱 실패 시 null
 */
function resolveAbsoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Playwright 에러 메시지에서 Call log 등 불필요한 부분을 제거한다.
 * @param {Error} error
 * @returns {string} CLI용 짧은 에러 메시지
 */
function formatErrorMessage(error) {
  const firstLine = (error.message || String(error)).split('\n')[0];
  return firstLine.replace(/^(\w+(?:\.\w+)*): /, '').trim() || firstLine;
}

/**
 * 영역 selector 내부의 모든 a[href] 링크 정보를 수집한다.
 * CTA명은 링크 텍스트 → aria-label → title 순으로 fallback한다.
 * @param {import('playwright').Page} page
 * @param {string} areaSelector
 * @returns {Promise<Array<{ index: number, href: string, ctaName: string, selector: string, absoluteUrl: string, target: string|null, isNewTab: boolean }>>}
 */
async function collectLinks(page, areaSelector, baseUrl) {
  const rawLinks = await page.evaluate((selector) => {
    const container = document.querySelector(selector);
    if (!container) return [];

    const anchors = Array.from(container.querySelectorAll('a[href]'));

    return anchors.map((anchor, index) => {
      const attrName = 'data-link-qa-index';
      anchor.setAttribute(attrName, String(index));

      const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
      const ariaLabel = anchor.getAttribute('aria-label') || '';
      const title = anchor.getAttribute('title') || '';
      const ctaName = text || ariaLabel || title || `(링크 ${index + 1})`;

      return {
        index,
        href: anchor.getAttribute('href') || '',
        // target="_blank" 여부 판별용 (navigate 모드에서도 새 창 링크 완화 규칙 적용)
        target: anchor.getAttribute('target'),
        ctaName,
        selector: `${selector} a[href][${attrName}="${index}"]`,
      };
    });
  }, areaSelector);

  return rawLinks.map((link) => ({
    ...link,
    absoluteUrl: resolveAbsoluteUrl(link.href, baseUrl),
    isNewTab: isBlankTarget(link.target),
  }));
}

/**
 * navigate 모드: href 절대 URL로 직접 이동하여 검증한다.
 * GNB 드롭다운처럼 DOM에 있지만 hidden인 링크도 검증 가능하다.
 */
async function verifyByNavigate(page, absoluteUrl, country, settings, timeout, isNewTab = false) {
  const response = await page.goto(absoluteUrl, {
    waitUntil: 'domcontentloaded',
    timeout,
  });

  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});

  const finalUrl = page.url();
  const pageInfo = {
    url: finalUrl,
    title: await page.title(),
    bodyText: await page.locator('body').innerText().catch(() => ''),
  };

  const pathPrefix = country.pathPrefix || extractPathPrefixFromBaseUrl(country.baseUrl);

  return determineResult({
    httpStatus: response ? response.status() : null,
    finalUrl,
    pageInfo,
    allowedDomains: country.allowedDomains,
    pathPrefix,
    errorDetection: settings.errorDetection,
    isNewTab,
  });
}

/**
 * click 모드: 실제 클릭으로 이동 후 검증한다 (보이는 요소에만 적합).
 */
async function verifyByClick(page, context, link, country, settings, timeout) {
  const linkLocator = page.locator(link.selector).first();
  const count = await linkLocator.count();

  if (count === 0) {
    return { status: 'fail', reason: '링크 요소를 DOM에서 찾을 수 없음', finalUrl: null };
  }

  let responseStatus = null;
  let finalUrl = page.url();
  let pageInfo = { url: finalUrl, title: '', bodyText: '' };
  let popupPage = null;

  // 수집 단계에서 파악한 isNewTab 우선, 없으면 DOM에서 target 재확인
  const isNewTab =
    link.isNewTab ?? isBlankTarget(await linkLocator.getAttribute('target'));

  if (isNewTab) {
    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout }),
      linkLocator.click({ timeout, force: true }),
    ]);
    popupPage = popup;
    await popupPage.waitForLoadState('domcontentloaded', { timeout });

    finalUrl = popupPage.url();
    pageInfo = {
      url: finalUrl,
      title: await popupPage.title(),
      bodyText: await popupPage.locator('body').innerText().catch(() => ''),
    };

    const lastResponse = await popupPage
      .waitForResponse((res) => res.url() === popupPage.url(), { timeout: 5000 })
      .catch(() => null);
    responseStatus = lastResponse ? lastResponse.status() : null;

    await popupPage.close().catch(() => {});
  } else {
    const isVisible = await linkLocator.isVisible().catch(() => false);

    if (!isVisible) {
      // hidden 링크는 click 불가 → navigate fallback (새 창 여부 전달)
      const navResult = await verifyByNavigate(
        page,
        link.absoluteUrl,
        country,
        settings,
        timeout,
        isNewTab
      );
      return { ...navResult, finalUrl: page.url() };
    }

    const urlBefore = page.url();
    const navPromise = page
      .waitForURL((url) => url.toString() !== urlBefore, { timeout })
      .catch(() => null);

    await linkLocator.scrollIntoViewIfNeeded().catch(() => {});
    await linkLocator.click({ timeout });
    await navPromise;

    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});

    responseStatus = null;
    finalUrl = page.url();
    pageInfo = {
      url: finalUrl,
      title: await page.title(),
      bodyText: await page.locator('body').innerText().catch(() => ''),
    };
  }

  const pathPrefix = country.pathPrefix || extractPathPrefixFromBaseUrl(country.baseUrl);

  const result = determineResult({
    httpStatus: responseStatus,
    finalUrl,
    pageInfo,
    allowedDomains: country.allowedDomains,
    pathPrefix,
    errorDetection: settings.errorDetection,
    isNewTab,
  });

  return { ...result, finalUrl };
}

/**
 * 단일 링크 검증
 */
async function verifySingleLink(page, context, link, country, settings, timeout, verificationMode) {
  const baseRecord = {
    ctaName: link.ctaName,
    linkPath: link.href,
    status: 'fail',
    reason: null,
    finalUrl: null,
  };

  if (!link.absoluteUrl) {
    return { ...baseRecord, reason: 'URL 파싱 실패' };
  }

  try {
    let result;
    let finalUrl;

    if (verificationMode === 'click') {
      const clickResult = await verifyByClick(page, context, link, country, settings, timeout);
      result = clickResult;
      finalUrl = clickResult.finalUrl;
    } else {
      result = await verifyByNavigate(
        page,
        link.absoluteUrl,
        country,
        settings,
        timeout,
        link.isNewTab
      );
      finalUrl = page.url();
    }

    return {
      ...baseRecord,
      finalUrl,
      status: result.status,
      reason: result.reason,
    };
  } catch (error) {
    return {
      ...baseRecord,
      reason: `링크 로드 실패: ${formatErrorMessage(error)}`,
    };
  }
}

/**
 * 디바이스 타입에 맞는 Playwright browser context 옵션을 생성한다.
 * @param {object} settings - settings.json
 * @param {string} deviceType - pc | mobile
 * @returns {object} browser.newContext() 옵션
 */
function buildContextOptions(settings, deviceType) {
  const defaultViewports = {
    pc: { width: 1920, height: 1080 },
    mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  };

  const vp = settings.viewports?.[deviceType] ?? defaultViewports[deviceType] ?? defaultViewports.pc;

  return {
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile ?? false,
    hasTouch: vp.hasTouch ?? false,
    ...(vp.userAgent ? { userAgent: vp.userAgent } : {}),
  };
}

/**
 * 지정 국가·영역·디바이스에 대해 전체 링크 QA 검증을 실행한다.
 * @param {object} options - { headless, progress, device, deviceLabel, selector }
 */
export async function runLinkCheck(country, area, settings, options = {}) {
  const showBrowser = resolveShowBrowser(settings, options);
  const headless = !showBrowser;
  const timeout = settings.browser.timeout;
  const areaWaitTimeout = settings.browser.areaWaitTimeout ?? 15000;
  const verificationMode = settings.browser.verificationMode ?? 'navigate';
  const progress = options.progress ?? null;

  // PC/Mobile별 selector (options.selector 우선)
  const deviceType = options.device ?? 'pc';
  const deviceLabel = options.deviceLabel ?? (deviceType === 'mobile' ? 'Mobile' : 'PC');
  const areaSelector = options.selector ?? area.selector;

  if (!areaSelector) {
    throw new Error(`영역 "${area.id}" (${deviceLabel}) selector가 설정되지 않았습니다.`);
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext(buildContextOptions(settings, deviceType));
  const page = await context.newPage();

  const sessionResult = {
    inspectedAt: new Date().toISOString(),
    countryCode: country.code,
    countryName: country.name,
    baseUrl: country.baseUrl,
    areaId: area.id,
    areaName: area.name,
    deviceType,
    deviceLabel,
    areaSelector,
    verificationMode,
    summary: { total: 0, passed: 0, failed: 0, skipped: 0, needsCheck: 0 },
    results: [],
  };

  try {
    progress?.logPageLoading(country.baseUrl);
    console.log(`  📱 디바이스: ${deviceLabel} (${deviceType}) | viewport 적용`);

    // load까지 대기 (domcontentloaded보다 JS 렌더링 완료에 유리)
    await page.goto(country.baseUrl, { waitUntil: 'load', timeout }).catch(async () => {
      await page.goto(country.baseUrl, { waitUntil: 'domcontentloaded', timeout });
    });

    await dismissOverlays(page);

    try {
      await waitForArea(page, areaSelector, areaWaitTimeout);
    } catch {
      const reason = `영역 selector "${areaSelector}" (${deviceLabel}) 를 ${areaWaitTimeout}ms 내 찾을 수 없음`;
      progress?.logSessionError(reason);
      sessionResult.results.push({
        ctaName: '-',
        linkPath: '-',
        status: 'fail',
        reason,
      });
      sessionResult.summary.failed = 1;
      sessionResult.summary.total = 1;
      progress?.logSessionComplete(sessionResult.summary);
      return sessionResult;
    }

    const allLinks = await collectLinks(page, areaSelector, country.baseUrl);
    progress?.logLinksCollected(allLinks.length);

    if (allLinks.length === 0) {
      progress?.logSessionError('영역 내 검증 가능한 링크가 없음');
      sessionResult.summary.total = 0;
      progress?.logSessionComplete(sessionResult.summary);
      return sessionResult;
    }

    console.log(`  🔍 검증 방식: ${verificationMode}`);
    const skipPatterns = settings.linkFilter.skipPatterns;
    let linkIndex = 0;

    for (const link of allLinks) {
      linkIndex++;

      if (shouldSkipLink(link.href, skipPatterns)) {
        sessionResult.results.push({
          ctaName: link.ctaName,
          linkPath: link.href,
          status: 'skipped',
          reason: '검증 제외 링크 (javascript/mailto/tel/anchor)',
        });
        sessionResult.summary.skipped++;
        sessionResult.summary.total++;

        progress?.logLinkResult({
          index: linkIndex,
          total: allLinks.length,
          status: 'skipped',
          ctaName: link.ctaName,
          href: link.href,
          reason: '검증 제외 링크',
        });
        continue;
      }

      if (settings.linkFilter.skipExternalDomains && !link.isNewTab) {
        try {
          const hostname = new URL(link.absoluteUrl).hostname.toLowerCase();
          const isInternal = country.allowedDomains.some(
            (d) => hostname === d.toLowerCase() || hostname.endsWith(`.${d.toLowerCase()}`)
          );
          if (!isInternal) {
            sessionResult.results.push({
              ctaName: link.ctaName,
              linkPath: link.href,
              status: 'skipped',
              reason: '외부 도메인 링크 (검증 제외 설정)',
            });
            sessionResult.summary.skipped++;
            sessionResult.summary.total++;

            progress?.logLinkResult({
              index: linkIndex,
              total: allLinks.length,
              status: 'skipped',
              ctaName: link.ctaName,
              href: link.href,
              reason: '외부 도메인 링크',
            });
            continue;
          }
        } catch {
          // 파싱 실패 시 검증 진행
        }
      }

      // 새 창(_blank) + 외부 도메인: skipExternalDomains 설정과 무관하게 검증 후 needs_check 처리

      const result = await verifySingleLink(
        page,
        context,
        link,
        country,
        settings,
        timeout,
        verificationMode
      );
      sessionResult.results.push(result);
      sessionResult.summary.total++;

      if (result.status === 'pass') {
        sessionResult.summary.passed++;
      } else if (result.status === 'needs_check') {
        sessionResult.summary.needsCheck++;
      } else {
        sessionResult.summary.failed++;
      }

      progress?.logLinkResult({
        index: linkIndex,
        total: allLinks.length,
        status: result.status,
        ctaName: link.ctaName,
        href: link.href,
        reason: result.reason,
      });
    }

    progress?.logSessionComplete(sessionResult.summary);
  } catch (error) {
    progress?.logSessionError(`페이지 로드 실패: ${formatErrorMessage(error)}`);
    sessionResult.results.push({
      ctaName: '-',
      linkPath: country.baseUrl,
      status: 'fail',
      reason: `페이지 로드 실패: ${formatErrorMessage(error)}`,
    });
    sessionResult.summary.failed = 1;
    sessionResult.summary.total = 1;
  } finally {
    await browser.close();
  }

  return sessionResult;
}
