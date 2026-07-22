# 퀴즈 배틀 — 실시간 퀴즈쇼

관리자가 퀴즈쇼를 만들고, 참가자가 6자리 코드+닉네임으로 접속해 20초 제한
실시간 퀴즈를 풀며 순위를 겨루는 웹앱.

## 1. Firebase 설정
1. https://console.firebase.google.com 에서 새 프로젝트 생성
2. 빌드 > Realtime Database 만들기 (위치 선택, "테스트 모드"로 시작)
3. 프로젝트 설정 > 내 앱 > 웹 앱 추가 → firebaseConfig 값 복사
4. `js/firebase.js` 상단 `firebaseConfig`를 복사한 값으로 교체
   - `databaseURL`은 `https://<프로젝트>-default-rtdb.firebaseio.com` 형식
5. Realtime Database > 규칙에 아래 임시 규칙 적용(내부/워크숍용):

    {
      "rules": { ".read": true, ".write": true }
    }

   (공개 배포 시 보안 규칙 강화 권장 — 아래 6절 참고)

## 2. 관리자 암호
`js/admin.js`의 `ADMIN_PASSWORD` 상수를 원하는 값으로 변경.

## 3. 로컬 실행
정적 파일이라 브라우저로 열면 되지만, ES Module CORS 때문에 로컬 서버 권장:
`npx serve .`  또는  `python -m http.server 8000`

## 4. 테스트
`node --test`  (순수 로직 검증)

## 5. 배포 (GitHub Pages)
1. GitHub에 저장소 생성 후 푸시
2. Settings > Pages > Source: main 브랜치 / root
3. 발급된 URL의 `/index.html`(참가자), `/admin.html`(관리자) 사용

## 6. (선택) 보안 규칙 강화
워크숍 종료 후에는 quizzes 쓰기를 잠그는 등 규칙을 조정하세요.
