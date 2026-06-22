/**
 * config-loader.js
 * 국가, 영역, 설정 JSON 파일을 로드하고 CLI 인자와 병합하는 모듈
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM 환경에서 __dirname 대체 (config 경로 기준점 계산용)
const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');

/**
 * JSON 파일을 읽어 파싱한다.
 * @param {string} filename - config 폴더 내 파일명
 * @returns {object} 파싱된 JSON 객체
 */
function loadJson(filename) {
  const filePath = join(CONFIG_DIR, filename);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * 모든 설정 파일을 한 번에 로드한다.
 * @returns {{ countries: object, areas: object, settings: object }}
 */
export function loadAllConfigs() {
  return {
    countries: loadJson('countries.json'),
    areas: loadJson('areas.json'),
    settings: loadJson('settings.json'),
  };
}

/**
 * 국가 코드로 국가 설정을 조회한다.
 * @param {object} countriesConfig - countries.json 전체 객체
 * @param {string} countryCode - 예: "KR", "US"
 * @returns {object|undefined} 매칭된 국가 객체
 */
export function findCountry(countriesConfig, countryCode) {
  return countriesConfig.countries.find(
    (c) => c.code.toUpperCase() === countryCode.toUpperCase()
  );
}

/**
 * 영역 ID로 영역 설정을 조회한다.
 * @param {object} areasConfig - areas.json 전체 객체
 * @param {string} areaId - 예: "GNB", "Footer"
 * @returns {object|undefined} 매칭된 영역 객체
 */
export function findArea(areasConfig, areaId) {
  return areasConfig.areas.find(
    (a) => a.id.toUpperCase() === areaId.toUpperCase()
  );
}

/**
 * 영역 config에서 PC/Mobile 검사 대상 목록을 반환한다.
 * - selectors.pc / selectors.mobile: 디바이스별 개별 selector
 * - selector (legacy): PC·Mobile 동일 selector로 검사 (하위 호환)
 * @param {object} area - areas.json 항목
 * @returns {Array<{ device: string, deviceLabel: string, selector: string }>}
 */
export function getAreaDeviceTargets(area) {
  const targets = [];

  const addTarget = (device, deviceLabel, selector) => {
    // 빈 문자열 selector는 해당 디바이스 검사 생략
    if (selector && String(selector).trim()) {
      targets.push({ device, deviceLabel, selector: String(selector).trim() });
    }
  };

  if (area.selectors) {
    addTarget('pc', 'PC', area.selectors.pc);
    addTarget('mobile', 'Mobile', area.selectors.mobile);
    return targets;
  }

  // 하위 호환: 단일 selector → PC·Mobile 동일 영역 검사
  if (area.selector) {
    addTarget('pc', 'PC', area.selector);
    addTarget('mobile', 'Mobile', area.selector);
  }

  return targets;
}

/**
 * 선택된 영역 ID 목록을 PC/Mobile 검사 태스크로 확장한다.
 * @param {object} areasConfig - areas.json 전체
 * @param {string[]} areaIds - 선택된 영역 ID
 * @returns {Array<{ area: object, device: string, deviceLabel: string, selector: string }>}
 */
export function expandInspectionTasks(areasConfig, areaIds) {
  const tasks = [];

  for (const areaId of areaIds) {
    const area = findArea(areasConfig, areaId);
    if (!area) continue;

    const targets = getAreaDeviceTargets(area);
    for (const target of targets) {
      tasks.push({ area, ...target });
    }
  }

  return tasks;
}

/**
 * 사용 예: node src/index.js --country KR --area GNB
 *         node src/index.js --country KR --area all
 *         node src/index.js --list
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {object} 파싱된 CLI 옵션
 */
export function parseCliArgs(argv) {
  const options = {
    country: null,
    area: null,
    list: false,
    headless: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--list' || arg === '-l') {
      options.list = true;
    } else if (arg === '--country' || arg === '-c') {
      options.country = argv[++i];
    } else if (arg === '--area' || arg === '-a') {
      options.area = argv[++i];
    } else if (arg === '--headless') {
      // true/false 문자열을 boolean으로 변환
      options.headless = argv[++i] !== 'false';
    } else if (arg === '--headed') {
      options.headless = false;
    }
  }

  return options;
}

/**
 * --list 옵션용: 사용 가능한 국가/영역 목록을 콘솔에 출력한다.
 * @param {object} configs - loadAllConfigs() 결과
 */
export function printAvailableOptions(configs) {
  console.log('\n=== 사용 가능한 국가 ===');
  for (const country of configs.countries.countries) {
    const pathPrefix = country.pathPrefix || '(baseUrl에서 자동 추출)';
    console.log(
      `  ${country.code.padEnd(6)} | ${country.name} | ${country.baseUrl} | path: ${pathPrefix}`
    );
  }

  console.log('\n=== 사용 가능한 영역 ===');
  for (const area of configs.areas.areas) {
    const targets = getAreaDeviceTargets(area);
    if (targets.length === 0) {
      console.log(`  ${area.id.padEnd(8)} | ${area.name} | (selector 미설정)`);
      continue;
    }
    for (const target of targets) {
      console.log(
        `  ${area.id.padEnd(8)} | ${area.name} | ${target.deviceLabel.padEnd(6)} | ${target.selector}`
      );
    }
  }
  console.log('');
}
