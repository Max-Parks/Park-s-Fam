또복이 Family Room Planner PWA V1
1. Firebase 프로젝트 생성
2. Authentication > Google 로그인 활성화
3. Firestore Database 생성
4. 웹 앱 등록 후 firebaseConfig를 firebase-config.js에 입력
5. firestore.rules 적용
6. 폴더 전체를 GitHub Pages/Firebase Hosting에 배포
7. 두 휴대폰에서 로그인 후 같은 가족 코드 입력
8. Android Chrome에서 '앱 설치' 또는 '홈 화면에 추가'

보안: 포함된 Rules는 초기 테스트용입니다. 공개 실사용 전에는 두 사람의 Firebase UID만 허용하도록 강화하세요.

V1.1
- Park's home Firebase Web App config 적용
- Google Authentication / Cloud Firestore 연결 준비 완료
- Firestore 리전: 사용자가 생성한 (default) DB
- 배포 후 두 기기에서 동일 가족 코드를 사용하면 공동 동기화
