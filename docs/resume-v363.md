# V3.63 운영 및 후속 검토

2026-10-05 검증 기록입니다.

- 저장소: `Max-Parks/Park-s-Fam`, 운영 브랜치: `main`
- 검토 기준 커밋: `39db65baae9964a54707e13a5d911d79c6e95cc7`
- 수정 브랜치: `codex/room-planner-v363-audit`
- 수정·병합 기록: https://github.com/Max-Parks/Park-s-Fam/pull/1
- 기존 앱: https://max-parks.github.io/Park-s-Fam/
- Firebase: `park-s-home`, 기존 `parks-family` 방 문서 경로 유지

## 확인한 내용

- 실제 앱 스크립트를 사용하는 저장·동기화·도면 회귀 테스트 43개 통과
- GitHub Actions Chromium에서 PC 1440×1000, 모바일 390×844 동작 검사 통과
- 검사 커밋: `5c9b08e6113cbab50386a1e906b14e0d54518887`
- 실행 결과: https://github.com/Max-Parks/Park-s-Fam/actions/runs/37318884602
- Firebase 규칙 2026-10-05 22:19 KST 운영 게시
- 규칙 시뮬레이션: 가족 읽기·구버전 형식 저장 허용, 비로그인·미등록 계정 읽기 및 잘못된 방 ID 저장 차단

검사는 임시 브라우저 데이터와 대체 Firestore 경계를 사용합니다. 실제 가족 배치를 테스트용으로
생성하거나 덮어쓰지 않았습니다. 기존 APK, 서명, 아이콘, manifest, Firebase 공개 설정은 유지했습니다.

## 남은 실사용·실측 확인

1. 실제 두 기기에서 같은 가족 계정으로 공동 배치가 반영되는지 확인합니다.
2. 최신 원도면·실측표로 `review-v3.63.md`의 미확정 치수와 전체 집 연결 좌표를 대조합니다.
3. 아기방 두 꺾임, 창호 프레임·개폐 방향 및 각 방과 복도가 만나는 벽·개구부를 확인합니다.

규칙 변경 전 내용은 Firebase 콘솔의 규칙 버전 기록에 남아 있습니다. GitHub의 rules 파일만
변경해서는 운영 규칙이 배포되지 않습니다. 후속 규칙 변경도 Firebase 콘솔 또는 권한 있는 CLI로
해당 프로젝트에 배포하고 허용/차단 검사를 거쳐야 합니다.
