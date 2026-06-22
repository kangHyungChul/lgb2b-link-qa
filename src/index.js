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
} from './config-loader.js';
import { promptSelections } from './interactive-prompt.js';
import { runLinkCheck } from './link-checker.js';
import { generateReports, printSummary } from './report-generator.js';
import { ProgressTracker, resolveShowBrowser } from './progress-display.js';

/**
 * 국가 × 영역 × 디바이스(PC/Mobile) 조합별 QA 검증 실행
 */
async function executeQaChecks(configs, countryCodes, areaIds, headless) {
  const allResults = [];
  const inspectionTasks = expandInspectionTasks(configs.areas, areaIds);
  const totalSessions = countryCodes.length * inspectionTasks.length;
  const progress = new ProgressTracker(totalSessions);
  const showBrowser = resolveShowBrowser(configs.settings, { headless });

  ProgressTracker.logRunStart(countryCodes.length, areaIds.length, inspectionTasks, showBrowser);

  if (inspectionTasks.length === 0) {
    console.error('검사할 영역/디바이스 selector가 없습니다. config/areas.json 을 확인하세요.');
    return allResults;
  }

  let sessionIndex = 0;

  for (const countryCode of countryCodes) {
    const country = findCountry(configs.countries, countryCode);
    if (!country) {
      console.error(`오류: 국가 코드 "${countryCode}" 를 config에서 찾을 수 없습니다.`);
      continue;
    }

    for (const task of inspectionTasks) {
      sessionIndex++;
      progress.startSession(
        sessionIndex,
        country.code,
        country.name,
        task.area.id,
        task.area.name,
        task.deviceLabel
      );

      const result = await runLinkCheck(country, task.area, configs.settings, {
        headless,
        progress,
        device: task.device,
        deviceLabel: task.deviceLabel,
        selector: task.selector,
      });
      allResults.push(result);
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
  console.log('리포트 저장 완료:');
  for (const file of savedFiles) {
    console.log(`  → ${file}`);
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
