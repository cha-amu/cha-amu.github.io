# Google Sheets 연결 상태

## 연결 대상

```txt
https://docs.google.com/spreadsheets/d/1pztnlU8M1ioKFBlDeTstAnuhnXDsiTij_V7P5_M1MG4/edit
```

Apps Script에서 사용할 ID:

```txt
1pztnlU8M1ioKFBlDeTstAnuhnXDsiTij_V7P5_M1MG4
```

## 코드 반영 상태

- `apps-script/Code.js`에 기본 `DEFAULT_SPREADSHEET_ID` 반영 완료
- `setupChaAmu()` 추가 완료
- `doGet(?action=health)` 연결 확인 endpoint 추가 완료
- `apps-script/README.md`에 설정 절차 작성 완료

## 아직 필요한 사용자 제공 값

- Apps Script Web App URL
- Cloudflare Turnstile 값은 현재 보류. 나중에 적용할 때 site key/secret key 추가
- 관리자 비밀번호 또는 `npm run secrets:apps-script`로 생성한 secret/property 값
- GitHub Actions로 Apps Script 배포할 경우 `CLASPRC_JSON`, `CLASP_JSON`, 선택값 `APPS_SCRIPT_DEPLOYMENT_ID`

## GitHub 배포 경로

`.github/workflows/apps-script.yml`은 Apps Script 코드를 GitHub Actions에서 배포하도록 구성되어 있다. 필요한 Secret은 아래와 같다.

```txt
CLASPRC_JSON=<~/.clasprc.json 내용>
CLASP_JSON={"scriptId":"<Apps Script 프로젝트 ID>","rootDir":"."}
APPS_SCRIPT_DEPLOYMENT_ID=<기존 /exec 웹앱 배포를 갱신할 때만>
```

`APPS_SCRIPT_DEPLOYMENT_ID`가 없으면 Actions가 새 배포를 만든다. 기존 URL을 유지하려면 첫 배포 후 deployment id를 Secret에 추가해야 한다.

## 현재 배포 URL

```txt
https://script.google.com/macros/s/AKfycbwn-qQpt3j2bxyzNtQeKSodJdo0Apvust80TPAxlp7U0jg2bZ0GI0FoJF3c4ZOTnQjt/exec
```

## 관리자 비밀번호 설정

직접 입력할 값은 하나뿐이다. 로컬 `.env`에 관리자 비밀번호만 넣는다.

```txt
ADMIN_PASSWORD=<관리자 로그인 비밀번호>
```

그 다음 아래 명령을 실행하면 hash/pepper/session secret은 자동 생성되고 Apps Script Properties에 자동 반영된다.

```bash
npm run sync:apps-script-env
```

`VITE_` 접두사를 붙이면 프론트 번들에 노출되므로 관리자 비밀번호에는 절대 붙이지 않는다.

