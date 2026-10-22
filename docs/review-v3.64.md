# V3.64 앱 UI 검토

2026-10-22 KST. 기존 V3.64에 앱 화면 사용성 수정 사항을 반영합니다.

## 확인한 문제와 수정

- 좁은 휴대폰에서 상단 정보와 고정 편집 패널이 도면을 가렸습니다. 상단 여백을 줄이고 편집 패널을 기본 접힘 상태로 변경했습니다. 목록/사용자 가구·가전 추가 후 패널이 접히고 새 항목이 선택됩니다.
- 가로 휴대폰에서 회전 버튼이 화면 위로 밀렸습니다. 높이가 짧은 가로 화면은 좌측 목록과 우측 도면, 두 줄 편집 도구를 사용합니다.
- PC에서 목록 하단의 가구를 추가하면 도면과 도구가 문서 위쪽으로 사라졌습니다. 앱 높이를 화면에 맞추고 목록과 도면을 독립적으로 스크롤합니다. PC·태블릿 목록의 스크롤 위치는 추가 후에도 유지됩니다.
- 태블릿 세로 방향에서 도면 바깥 여백이 넓었습니다. 목록 폭을 280px로 조정하고 도면을 가용 폭에 맞춥니다. 터치 환경에서는 방향별 미세이동 버튼을 표시합니다.
- 전체화면 상태로 큰 화면으로 전환할 때 화면 스크롤 상태가 남았습니다. 넓은 화면에서는 전체화면 모드를 해제하며 Escape로도 닫을 수 있습니다.
- 가구 선택과 입력 필드에 접근성 정보가 부족했습니다. 90개 입력 필드에 이름을 추가하고 가구를 Tab으로 이동한 뒤 Enter/Space로 선택할 수 있게 했습니다.
- 부부욕실 문 시작 위치는 오른쪽 벽 820mm를 기준으로 자동 계산되는데 수정 가능한 것처럼 표시됐습니다. 읽기 전용과 계산 설명을 표시합니다.
- 서비스 워커 캐시를 `ttobok-v364-app-2`로 갱신합니다. 다른 앱의 캐시와 기존 배치 데이터는 보존합니다.

## 지정 기종과 검증 범위

| 사용자 기종 | 제조사 화면 정보 | 모의 검증에 포함한 CSS 화면 크기 |
| --- | --- | --- |
| Galaxy Z Flip5 | 내부 화면 1080×2640, 22:9 | 360×880 / 880×360, 412×1006 / 1006×412 |
| Galaxy Tab S8 SM-X700 | 1600×2560, 16:10 | 800×1280 / 1280×800 |
| Galaxy Tab S9 FE 5G SM-X516N | 1440×2304, 16:10 | 768×1229 / 1229×768 |
| 확대·분할 창과 일반 회귀 | 다양한 논리 화면 크기 | 640×1024 / 1024×640, 320×568, 360×740, 390×844, 740×360, 844×390, 1024×768, 1440×1000 |

실제 웹 화면 크기는 시스템 화면 확대, 글꼴, 브라우저 도구 모음, 앱 창 크기에 따라 달라집니다. 위 CSS 크기는 반응형 검증용 가정이며 기종의 기본 논리 해상도를 확정한 값이 아닙니다. 브라우저의 터치 입력을 모의하고, 실물 기기·S펜·소프트 키보드·힌지와 커버 화면은 직접 검증하지 않았습니다. Z Flip5는 펼친 내부 화면을 기준으로 합니다.

화면 정보 출처: [삼성 Z Flip5](https://samsungmobilepress.com/articles/samsung-galaxy-z-flip5-and-galaxy-z-fold5-delivering-flexibility-and-versatility-without-compromise), [삼성전자서비스 SM-X700](https://www.samsungsvc.co.kr/solution/692732), [삼성 SM-X516N](https://www.samsung.com/sec/support/model/SM-X516NZAAKOO/).

## 검증 방법

- `node --test tests/*.test.cjs`: 저장·충돌 판정·동기화·키보드 선택·화면 전환·서비스 워커 회귀 48개.
- `node tests/browser-smoke.cjs`: 17개 화면 크기. 회전/복제/제거 버튼 접근, 도면 가림, 문서 가로 넘침, 가구·가전 추가 후 복귀, 터치 선택/미세이동, 전체화면/화면 전환, 전체 도면 설명, 모든 방 전환, 저장 후 새로고침.
- 브라우저 테스트는 임시 데이터를 사용하고 외부 네트워크를 차단합니다. 테스트 화면에 나타나는 Firebase 연결 오류는 이 차단에 따른 것이며 운영 동기화 결과가 아닙니다.
- 실제 가족 계정 로그인 및 두 실물 기기 간 공동 저장은 이 자동 UI 검증에 포함하지 않습니다.

## 배포 범위

화면 배포 대상은 기존 GitHub Pages입니다. Firestore 규칙/데이터 구조는 변경하지 않습니다. `firebase.json`은 Firestore 규칙 배포만 설정되어 있으므로 UI 수정에 Firebase Hosting 재배포는 필요하지 않습니다.

## Android APK 실행 문제

사용자는 Z Flip5에서 웹페이지의 APK를 재설치한 뒤 아이콘을 누르면 바로 종료되거나 반응이 없고, 삼성 인터넷에서는 같은 웹페이지가 정상 작동한다고 보고했습니다.

기존 APK에서 즉시 종료를 Android 15(API 35) 에뮬레이터로 재현했습니다. Chrome이 있는 경우와 브라우저를 비활성화한 경우 모두 `ManageDataLauncherActivity` 컴포넌트가 없다는 `IllegalArgumentException`이 발생합니다. Android Browser Helper의 `LauncherActivity.onCreate → launchTwa → addSiteSettingsShortcut → setComponentEnabledSetting` 호출에서 웹사이트를 열기 전에 종료됩니다. [기존 APK 진단 로그](https://github.com/Max-Parks/Park-s-Fam/actions/runs/39717031423)

기존 APK는 Android Browser Helper 2.7.3을 사용하며, 기본 브라우저보다 TWA 지원 브라우저를 우선 선택할 수 있습니다. 컴파일된 `asset_statements` 리소스의 JSON 따옴표가 손실된 별도 설정 오류도 확인했습니다.

새 APK는 기본 브라우저에서 Custom Tab으로 열고, 연결 실패 시 일반 브라우저 열기로 전환합니다. 열기에 실패하거나 브라우저에서 돌아오면 재시도와 브라우저에서 열기 화면을 제공합니다. 별도 WebView 저장소를 만들지 않으며 기존 패키지 `com.maxparks.ttobokhome`과 저장된 배포 서명으로 버전명 `3.64`, 버전 코드 `364`를 빌드합니다. 다운로드 주소에는 `v=364`를 사용합니다.

[수정 APK 빌드 및 실행 검사](https://github.com/Max-Parks/Park-s-Fam/actions/runs/39721017914)가 통과했습니다. Android 15 에뮬레이터에서 브라우저로 전환, 뒤로 가기로 실행기 복귀, 브라우저 비활성화 시 안내·재시도 버튼 표시를 확인했고 두 경우 모두 네이티브 충돌이 없었습니다. 브라우저는 최초 설정 화면까지 열렸으며 이 검사는 로그인이나 웹페이지 조작을 포함하지 않습니다. 웹 UI는 별도 48개 회귀·17개 화면 크기 검사로 확인했습니다.

APK SHA-256: `17a540ad11eea9dddc170837e0e60908bad3f8316e7628c08fa7a4533e321176`. 서명 인증서 SHA-256은 기존 APK와 같은 `5102c30b88e2c0d106910258ba64a40ca1ae4c3c19208de9df1a8d0bc40e2702`입니다.

실물 Z Flip5에서의 최종 실행 확인은 사용자의 새 APK 설치 후 확인이 필요합니다. 에뮬레이터의 기존 APK 종료 원인은 확인했으며 사용자 기기 자체의 오류 로그는 수집하지 않았습니다.

## V3.64.1: 상단 제거와 주소줄 없는 APK

- 상단 제목·계정·설치 영역을 삭제하고 기존 계정/공동 저장 컨트롤을 편집 패널의 접이식 메뉴로 옮깁니다. 로그인·저장 이벤트와 데이터 키는 유지합니다.
- 전체 집 도면에서는 편집·미세이동·전체 비우기 도구를 숨깁니다. 개별 방은 가구 선택 시 편집 도구가 나타납니다.
- 확대·축소·맞춤·전체화면을 한 줄로 두고 글자/확대 배율은 보기 설정으로 옮깁니다.
- 1280px 이하 전체 도면은 바깥 치수를 짧은 설명으로 옮기고 실제 여백을 계산해 맞춥니다. 360px 화면의 도면 폭은 약 220px에서 334px로 증가했습니다.
- 브라우저 직접 이용 시 전체화면은 명시적 클릭으로만 요청하며 거부 시 도면 확대 보기와 복귀 기능을 유지합니다.
- APK는 AndroidX 서비스/세션을 사용한 Trusted Web Activity로 실행합니다. 삼성 인터넷 등 지원되는 기본 브라우저를 우선하며, 검증 실패 시 브라우저 표시를 유지하고 실행 실패 시 재시도 화면을 제공합니다.
- 기존 패키지와 배포 서명을 유지하며 APK versionCode=365, versionName=3.64.1입니다. 이전 크래시를 일으킨 Android Browser Helper LauncherActivity 구현은 사용하지 않고 기존 홈 화면 바로가기 이름만 alias로 보존합니다.
- 사이트 루트의 공개 서명 연결 파일은 별도 Max-Parks.github.io 저장소에서 게시합니다. `https://max-parks.github.io/.well-known/assetlinks.json` HTTP200 및 Google Digital Asset Links 응답으로 기존 패키지/서명 연결을 확인했습니다. 비공개 서명 키는 게시하지 않습니다.
- 서명된 APK 빌드 후 에뮬레이터에서 실제 사이트 검증 성공, 웹 콘텐츠 로딩, 브라우저 주소줄 부재, 뒤로 가기 및 브라우저 없음 복구를 검사하도록 배포 조건을 강화합니다. 인증 검증을 우회하는 플래그는 사용하지 않습니다.
- 로컬 Node 회귀48개와 Edge/Chromium 엔진의17개 화면 크기 검사가 통과했습니다. 실제 삼성 기종의 앱 실행과 주소줄 유무는 기기에서 추가 확인이 필요합니다.

참고: [Google 공식 TWA 브라우저 지원표](https://github.com/GoogleChrome/android-browser-helper/blob/main/docs/trusted-web-activity-browser-support.md), [AndroidX TWA](https://developer.android.com/reference/androidx/browser/trusted/TrustedWebActivityIntentBuilder).
