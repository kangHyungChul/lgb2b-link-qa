/**
 * interactive-prompt.js
 * npm run qa 실행 시 터미널에서 국가·영역을 선택하는 대화형 UI
 */

import { checkbox, confirm, Separator } from '@inquirer/prompts';
import { getAreaDeviceTargets } from './config-loader.js';

/**
 * checkbox 선택값에 "전체" 옵션이 포함되어 있으면 전체 목록 codes를 반환한다.
 * "전체"와 개별 항목이 함께 선택된 경우 "전체"만 적용한다.
 * @param {string[]} selected - 사용자가 선택한 value 배열
 * @param {string} allToken - 전체 선택을 나타내는 특수 value
 * @param {string[]} allCodes - 전체 codes 목록
 * @returns {string[]} 최종 적용할 codes
 */
function resolveAllSelection(selected, allToken, allCodes) {
  if (selected.includes(allToken)) {
    return allCodes;
  }

  if (selected.length === 0) {
    return [];
  }

  return selected;
}

/**
 * 국가·영역·브라우저 모드를 대화형으로 선택한다.
 * @param {object} configs - loadAllConfigs() 결과
 * @returns {Promise<{ countryCodes: string[], areaIds: string[] }>}
 */
export async function promptSelections(configs) {
  console.log('\n========================================');
  console.log('  Link QA 자동 검증');
  console.log('  ↑↓ 이동  Space 선택/해제  Enter 확인');
  console.log('========================================\n');

  const allCountryCodes = configs.countries.countries.map((c) => c.code);
  const allAreaIds = configs.areas.areas.map((a) => a.id);

  // 1. 국가 다중 선택
  const selectedCountries = await checkbox({
    message: '검증할 국가를 선택하세요',
    choices: [
      { value: '__all_countries__', name: '🌐 전체 국가' },
      new Separator('────────────────'),
      ...configs.countries.countries.map((country) => ({
        value: country.code,
        name: `${country.code.padEnd(6)} | ${country.name}`,
        description: country.baseUrl,
      })),
    ],
    loop: false,
    pageSize: 15,
    validate: (values) => values.length > 0 || '국가를 하나 이상 선택해주세요.',
  });

  const countryCodes = resolveAllSelection(
    selectedCountries,
    '__all_countries__',
    allCountryCodes
  );

  // 2. 영역 다중 선택
  const selectedAreas = await checkbox({
    message: '검증할 영역을 선택하세요',
    choices: [
      { value: '__all_areas__', name: '📋 전체 영역' },
      new Separator('────────────────'),
      ...configs.areas.areas.map((area) => {
        const targets = getAreaDeviceTargets(area);
        const selectorDesc = targets
          .map((t) => `${t.deviceLabel}: ${t.selector}`)
          .join(' | ');
        return {
          value: area.id,
          name: `${area.id.padEnd(8)} | ${area.name}`,
          description: selectorDesc || '(selector 미설정)',
        };
      }),
    ],
    loop: false,
    validate: (values) => values.length > 0 || '영역을 하나 이상 선택해주세요.',
  });

  const areaIds = resolveAllSelection(selectedAreas, '__all_areas__', allAreaIds);

  // 브라우저 표시 여부는 settings.json의 browser.showBrowser 에서 관리
  const showBrowser = configs.settings.browser?.showBrowser ?? false;

  // 선택 요약 출력
  console.log('\n--- 선택 요약 ---');
  console.log(`  국가: ${countryCodes.length}개 (${countryCodes.join(', ')})`);
  console.log(`  영역: ${areaIds.join(', ')}`);
  console.log(`  브라우저: ${showBrowser ? '표시 (settings.json)' : '숨김 (settings.json)'}`);
  console.log('-----------------\n');

  const proceed = await confirm({
    message: '위 설정으로 QA 검증을 시작할까요?',
    default: true,
  });

  if (!proceed) {
    console.log('검증이 취소되었습니다.');
    process.exit(0);
  }

  return { countryCodes, areaIds };
}
