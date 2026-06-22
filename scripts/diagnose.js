/**
 * diagnose.js - LG 페이지 selector 진단 (일회성)
 */
import { chromium } from 'playwright';

const url = 'https://www.lg.com/global/business/';
const selectors = [
  '.c-header__area',
  '.CM0001 .c-header__area',
  '.c-header',
  'header',
  '.c-footer',
  '.CM0002 .c-footer',
  'footer',
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

console.log('Loading:', url);

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('domcontentloaded OK, title:', await page.title());

for (const sel of selectors) {
  const count = await page.locator(sel).count();
  console.log(`  [domcontentloaded] ${sel}: ${count}`);
}

// selector 대기 후 재확인
for (const sel of ['.c-header__area', '.c-footer', 'header']) {
  try {
    await page.waitForSelector(sel, { timeout: 15000 });
    console.log(`  [wait 15s] ${sel}: FOUND`);
  } catch {
    console.log(`  [wait 15s] ${sel}: NOT FOUND`);
  }
}

await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
  console.log('networkidle timeout');
});

for (const sel of selectors) {
  const count = await page.locator(sel).count();
  console.log(`  [networkidle] ${sel}: ${count}`);
}

// 페이지 내 header/footer 관련 클래스 샘플
const classes = await page.evaluate(() => {
  const result = [];
  document.querySelectorAll('[class*="header"], [class*="footer"], [class*="Header"], [class*="Footer"]').forEach((el) => {
    result.push(`${el.tagName}.${el.className.toString().slice(0, 80)}`);
  });
  return [...new Set(result)].slice(0, 20);
});
console.log('\nHeader/Footer 관련 요소:');
classes.forEach((c) => console.log(' ', c));

await browser.close();
