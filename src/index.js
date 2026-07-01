/**
 * index.js
 * Playwright 기반 링크 QA 자동 검증 CLI 진입점
 */

import {
  loadAllConfigs,
  findCountry,
  expandInspectionTasks,
  parseCliArgs,
  printAvailableOptions,
  resolveAreaBaseUrl,
} from './config-loader.js';
import { promptSelections } from './interactive-prompt.js';
import { runLinkCheck } from './link-checker.js';
import { generateReports, printSummary } from './report-generator.js';
import { ProgressTracker, resolveShowBrowser } from './progress-display.js';

/**
 * 단일 국가에 대해 영역×디바이스 검증을 순차 실행한다.
 * @param {object} params
 * @returns {Promise<object[]>} 해당 국가의 세션 결과 배열
 */
async function runCountryChecks({
  country,
  inspectionTasks,
  settings,
  headless,
  progress,
  sessionIndexRef,
}) {
  const countryResults = [];

  for (const task of inspectionTasks) {
    sessionIndexRef.value++;
    const sessionIndex = sessionIndexRef.value;

    progress.startSession(
      sessionIndex,
      country.code,
      country.name,
      task.area.id,
      task.area.name,
      task.deviceLabel
    );

    const inspectionBaseUrl = resolveAreaBaseUrl(country.baseUrl, task.area.path);

    const result = await runLinkCheck(country, task.area, settings, {
      headless,
      progress,
      device: task.device,
      deviceLabel: task.deviceLabel,
      selector: task.selector,
      baseUrl: inspectionBaseUrl,
      areaPath: task.area.path ?? null,
    });

    countryResults.push(result);
  }

  return countryResults;
}

/**
 * 국가 × 영역 × 디바이스 QA 검증 실행
 * settings.execution.parallelCountries 가 true이면 국가 단위 병렬 실행
 */
async function executeQaChecks(configs, countryCodes, areaIds, headless) {
  const allResults = [];
  const inspectionTasks = expandInspectionTasks(configs.areas, areaIds);
  const parallelCountries = configs.settings.execution?.parallelCountries ?? false;
  const totalSessions = countryCodes.length * inspectionTasks.length;
  const progress = new ProgressTracker(totalSessions);
  const showBrowser = resolveShowBrowser(configs.settings, { headless });
  const sessionIndexRef = { value: 0 };

  ProgressTracker.logRunStart(
    countryCodes.length,
    areaIds.length,
    inspectionTasks,
    showBrowser,
    parallelCountries
  );

  if (inspectionTasks.length === 0) {
    console.error('검사할 영역/디바이스 selector가 없습니다. config/areas.json 을 확인하세요.');
    return allResults;
  }

  const countries = [];

  for (const countryCode of countryCodes) {
    const country = findCountry(configs.countries, countryCode);
    if (!country) {
      console.error(`오류: 국가 코드 "${countryCode}" 를 config에서 찾을 수 없습니다.`);
      continue;
    }
    countries.push(country);
  }

  if (countries.length === 0) {
    return allResults;
  }

  const runParams = {
    inspectionTasks,
    settings: configs.settings,
    headless,
    progress,
    sessionIndexRef,
  };

  if (parallelCountries && countries.length > 1) {
    // 국가별 병렬 실행 (각 국가 내부 영역·디바이스는 순차)
    const countryResultSets = await Promise.all(
      countries.map((country) => runCountryChecks({ country, ...runParams }))
    );
    allResults.push(...countryResultSets.flat());
  } else {
    for (const country of countries) {
      const countryResults = await runCountryChecks({ country, ...runParams });
      allResults.push(...countryResults);
    }
  }

  return allResults;
}

/**
 * CLI 메인 실행 함수
 */
async function main() {
  const configs = loadAllConfigs();
  const cli = parseCliArgs(process.argv.slice(2));

  if (cli.list) {
    printAvailableOptions(configs);
    process.exit(0);
  }

  let countryCodes;
  let areaIds;
  let headless = cli.headless;

  const isInteractive = !cli.country && !cli.area;

  if (isInteractive) {
    const selections = await promptSelections(configs);
    countryCodes = selections.countryCodes;
    areaIds = selections.areaIds;
  } else {
    if (!cli.country || !cli.area) {
      console.error('오류: --country 와 --area 는 함께 지정해야 합니다.\n');
      console.log('사용법: npm run qa              (대화형 선택)');
      console.log('       npm run qa -- --country gb --area GNB');
      console.log('       npm run qa -- --list\n');
      process.exit(1);
    }

    countryCodes =
      cli.country.toLowerCase() === 'all'
        ? configs.countries.countries.map((c) => c.code)
        : [cli.country];

    areaIds =
      cli.area.toLowerCase() === 'all'
        ? configs.areas.areas.map((a) => a.id)
        : [cli.area];
  }

  const allResults = await executeQaChecks(configs, countryCodes, areaIds, headless);

  if (allResults.length === 0) {
    console.error('실행된 검증이 없습니다. 국가/영역 코드를 확인하세요.');
    process.exit(1);
  }

  printSummary(allResults);

  const savedFiles = generateReports(allResults, configs.settings.report);
  if (savedFiles.length > 0) {
    console.log('리포트 저장 완료:');
    for (const file of savedFiles) {
      console.log(`  → ${file}`);
    }
  } else {
    console.log('리포트 파일 생성 없음 (settings.report.json / settings.report.csv 확인)');
  }

  const hasFailure = allResults.some((r) => r.summary.failed > 0);
  process.exit(hasFailure ? 1 : 0);
}

main().catch((error) => {
  if (error.name === 'ExitPromptError') {
    console.log('\n검증이 취소되었습니다.');
    process.exit(0);
  }

  console.error('예기치 않은 오류:', error);
  process.exit(1);
});
