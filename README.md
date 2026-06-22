# Link QA

Playwright 기반 링크 QA 자동 검증 도구입니다.  
지정한 국가·영역(GNB, Footer 등) 내 모든 링크를 실제 클릭하여 정상 여부를 검사하고, JSON/CSV 리포트를 생성합니다.

## 요구 사항

- Node.js 18+
- npm

## 설치

```bash
# 의존성 설치
npm install

# Playwright Chromium 브라우저 설치 (최초 1회)
npm run qa:install
```

## 사용법

### 1. 대화형 실행 (권장)

```bash
npm run qa
```

터미널에서 국가·영역을 선택한 뒤 검증을 시작합니다.

| 키 | 동작 |
|----|------|
| ↑↓ | 항목 이동 |
| Space | 선택 / 해제 |
| Enter | 다음 단계 |
| Ctrl+C | 취소 |

- 국가·영역은 **다중 선택** 가능
- `전체 국가`, `전체 영역` 옵션 지원

### 2. CLI 직접 지정 (CI / 스크립트용)

```bash
# 특정 국가 + 영역
npm run qa -- --country gb --area GNB

# 특정 국가, 전체 영역
npm run qa -- --country global --area all

# 전체 국가 + 전체 영역
npm run qa -- --country all --area all

# 국가/영역 목록 조회
npm run qa -- --list
```

### 3. 브라우저 UI 표시

기본값은 `config/settings.json`의 `browser.showBrowser` 설정을 따릅니다.  
CLI로 일시 덮어쓸 수 있습니다.

```bash
# 브라우저 창 표시
npm run qa -- --country global --area GNB --headed
```

## 검증 Flow

1. **국가 선택** — `config/countries.json`의 `baseUrl`로 접속
2. **영역 선택** — `config/areas.json`의 CSS selector로 GNB/Footer 등 지정
3. **링크 수집** — 영역 내 모든 `<a[href]>` 추출
4. **링크 클릭 검증** — 각 링크를 실제 클릭 후 아래 항목 판별
5. **리포트 출력** — `reports/` 폴더에 JSON + CSV 저장

### Pass / Fail 기준

| 검사 | Fail 조건 |
|------|-----------|
| HTTP 상태 | 404, 410, 500, 502, 503 |
| 도메인 | `allowedDomains` 외부 도메인으로 이동 |
| 국가 경로 | 같은 도메인 내 다른 국가 경로로 이동 (예: `/uk/` → `/global/`) |
| 에러 페이지 | URL / title / 본문에 404·에러 패턴 감지 |

### 검증 제외 (Skipped)

아래 링크는 검증하지 않고 `skipped` 처리합니다.

- `javascript:`, `mailto:`, `tel:`, `#` 앵커 링크
- `settings.json`에서 `skipExternalDomains: true` 설정 시 외부 도메인 링크

## Config 설정

### `config/countries.json` — 국가 / 도메인

```json
{
  "code": "gb",
  "name": "United Kingdom",
  "baseUrl": "https://www.lg.com/uk/business/",
  "allowedDomains": ["www.lg.com", "lg.com"]
}
```

| 필드 | 설명 |
|------|------|
| `code` | CLI에서 사용하는 국가 코드 (`--country gb`) |
| `name` | 표시용 국가명 |
| `baseUrl` | QA 검증 시작 URL |
| `allowedDomains` | 클릭 후 허용되는 도메인 whitelist |

> UK는 `code`는 `gb`이지만 URL 경로는 `uk`를 사용합니다 (`/uk/business/`).

### `config/areas.json` — 영역 / Selector (PC·Mobile 분리)

```json
{
  "id": "GNB",
  "name": "Global Navigation Bar",
  "selectors": {
    "pc": ".CM0001 .c-gnb__desktop",
    "mobile": ".CM0001 .c-gnb__mobile"
  }
}
```

| 필드 | 설명 |
|------|------|
| `id` | CLI에서 사용하는 영역 ID (`--area GNB`) |
| `name` | 표시용 영역명 |
| `selectors.pc` | PC viewport 검사용 CSS selector |
| `selectors.mobile` | Mobile viewport 검사용 CSS selector (비우면 Mobile 검사 생략) |
| `selector` | (legacy) 단일 selector — PC·Mobile 동일 selector로 검사 |

PC와 Mobile selector가 다를 때 각각 설정하면, **별도 viewport로 분리 검사**되고 **리포트·요약도 PC/Mobile로 구분**됩니다.

### `config/settings.json` — 실행 / 검증 옵션

```json
{
  "browser": {
    "showBrowser": false,
    "timeout": 30000,
    "verificationMode": "navigate"
  },
  "viewports": {
    "pc": { "width": 1920, "height": 1080 },
    "mobile": { "width": 390, "height": 844, "isMobile": true, "hasTouch": true }
  },
  "linkFilter": {
    "skipPatterns": ["^javascript:", "^mailto:", "^tel:", "^#"],
    "skipExternalDomains": false
  },
  "errorDetection": {
    "httpStatusCodes": [404, 410, 500, 502, 503],
    "urlPatterns": ["/404", "/error", "not-found"],
    "titlePatterns": ["404", "not found", "error"],
    "bodyTextPatterns": ["page not found", "404"]
  },
  "report": {
    "outputDir": "reports",
    "formats": ["json", "csv"]
  }
}
```

| 필드 | 설명 |
|------|------|
| `browser.showBrowser` | `true`: 브라우저 UI 표시 / `false`: Headless |
| `browser.timeout` | 페이지 로드·클릭 타임아웃 (ms) |
| `browser.verificationMode` | `navigate` (URL 직접 이동) / `click` (DOM 클릭) |
| `viewports.pc` / `viewports.mobile` | PC/Mobile 검사 시 Playwright viewport 설정 |
| `linkFilter.skipPatterns` | 검증 제외할 href 정규식 패턴 |
| `linkFilter.skipExternalDomains` | 외부 도메인 링크 skip 여부 |
| `errorDetection.*` | 에러 페이지 감지 규칙 |
| `report.outputDir` | 리포트 저장 폴더 |
| `report.formats` | `json`, `csv` 중 선택 |

## CLI 진행 상황 출력

검증 중 터미널에 진행 상황이 표시됩니다.

```
========================================
  Link QA 검증 실행
  국가 1개 × 영역 1개
  브라우저: 숨김 (Headless)
========================================

━━━ [1/2] [global] Global / GNB ━━━
  ⏳ 페이지 로딩... https://www.lg.com/global/business/
  📋 링크 15개 발견, 검증 시작
  [1/15] ✓ Products → /global/business/products
  [2/15] ✗ Support → /uk/business/support
         └ 다른 국가 경로로 이동됨
  ✅ 완료 — Pass 12 | Fail 1 | Skip 2 (총 15)
```

## 리포트

검증 완료 후 `reports/` 폴더에 파일이 생성됩니다.

- `link-qa-report_YYYY-MM-DDTHH-MM-SS.json`
- `link-qa-report_YYYY-MM-DDTHH-MM-SS.csv`

### CSV 컬럼

| 컬럼 | 설명 |
|------|------|
| 검사날짜 | ISO 8601 타임스탬프 |
| 국가코드 | 예: `global`, `gb` |
| 영역 | 예: `GNB`, `Footer` |
| 디바이스 | `PC` / `Mobile` |
| CTA명 | 링크 텍스트 (없으면 aria-label / title) |
| 링크경로 | href 값 |
| 최종URL | 클릭 후 도착 URL |
| 결과 | `pass` / `fail` / `skipped` |
| 실패원인 | fail/skipped 시 사유 |

## Exit Code

| 코드 | 의미 |
|------|------|
| `0` | 모든 검증 pass |
| `1` | fail 1건 이상 또는 실행 오류 |

CI 파이프라인 연동 시 exit code로 성공/실패를 판단할 수 있습니다.

## 프로젝트 구조

```
link-qa/
├── config/
│   ├── countries.json    # 국가 / baseUrl / allowedDomains
│   ├── areas.json        # GNB, Footer selector
│   └── settings.json     # 브라우저, 에러감지, 리포트 설정
├── src/
│   ├── index.js              # CLI 진입점
│   ├── config-loader.js      # config 로드
│   ├── interactive-prompt.js # 대화형 선택 UI
│   ├── progress-display.js   # CLI 진행 상황 출력
│   ├── link-checker.js       # Playwright 링크 검증
│   ├── link-validator.js     # pass/fail 판별 로직
│   └── report-generator.js   # JSON/CSV 리포트 생성
└── reports/                  # 검증 결과 (자동 생성)
```

## 트러블슈팅

### "영역 selector를 페이지에서 찾을 수 없음"

- `config/areas.json`의 selector가 실제 페이지 DOM과 일치하는지 확인
- LG 사이트는 JS 렌더링 후 header/footer가 로드될 수 있으므로 selector 변경 또는 `browser.timeout` 증가 검토
- `showBrowser: true`로 설정하여 브라우저에서 직접 확인

### 링크가 모두 skipped 처리됨

- `linkFilter.skipPatterns`에 해당 href 패턴이 포함되어 있는지 확인

### 다른 국가 경로로 fail

- 의도된 동작입니다. 국가별 `baseUrl` 경로 prefix(`/uk/`, `/global/` 등) 밖으로 이동하면 fail 처리됩니다.
