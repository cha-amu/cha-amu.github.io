import { AppLayout } from '../components/AppLayout';
import { BackToTopButton } from '../components/BackToTopButton';
import { useI18n } from '../i18n';

const CONTACT_EMAIL = 'chaamu.channel@gmail.com';
const EFFECTIVE_DATE = '2026-07-12';

type PrivacySectionProps = {
  title: string;
  paragraphs?: string[];
  items?: string[];
};

function PrivacySection({ title, paragraphs = [], items = [] }: PrivacySectionProps) {
  return (
    <section className="privacy-section">
      <h2>{title}</h2>
      <div className="privacy-section__body">
        {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        {items.length ? (
          <ul>
            {items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

export function PrivacyPage() {
  const { language, t } = useI18n();
  const isKorean = language === 'ko';

  const copy = isKorean ? {
    effective: `시행일 ${EFFECTIVE_DATE}`,
    lead: '채아무는 방명록과 사이트 운영에 필요한 정보만 처리하며, 광고 목적의 방문자 추적이나 개인정보 판매를 하지 않습니다.',
    sections: [
      {
        title: '처리하는 정보',
        items: [
          '방명록: 메시지, 선택 입력한 이름(미입력 시 ㅇㅁ), 작성 시각, 글 식별자와 공개 상태',
          '삭제 인증: 비밀번호 원문이 아닌 salt와 hash 정보',
          '남용 방지: 접속 IP로 만든 HMAC 해시, 요청 횟수, 차단 상태·사유·시각, Turnstile 검증 정보',
          '브라우저 저장소: 임의의 방명록 클라이언트 식별자, 표시 언어, 공개 콘텐츠 캐시',
          '관리자 전용: 세션 정보와 작성 중인 게시물 초안'
        ]
      },
      {
        title: '이용 목적',
        items: [
          '방명록 작성·표시·삭제와 운영 관리',
          '도배, 자동화 요청, 비정상 접근 방지와 IP 차단',
          '관리자 인증 및 게시물·자료 관리',
          '표시 언어 유지와 콘텐츠 로딩 개선'
        ]
      },
      {
        title: '공개되는 정보',
        paragraphs: [
          '공개 상태의 방명록 메시지, 이름과 작성 시각은 누구나 볼 수 있습니다. 방명록에 본인이나 다른 사람의 민감한 개인정보를 남기지 마세요.'
        ]
      },
      {
        title: '보유와 파기',
        items: [
          '방명록과 삭제 인증 정보는 이용자의 삭제 요청 또는 서비스 종료 시까지 보관합니다. 비밀번호로 삭제하면 먼저 공개 목록에서 숨김 처리되며, 남용 방지나 분쟁 대응 필요가 끝나면 관련 원본도 파기합니다.',
          'IP 해시와 차단 이력은 부정 이용 방지 목적이 유지되는 동안 보관하고, 목적이 끝나면 삭제합니다.',
          '브라우저 저장 정보는 이용자가 사이트 데이터를 삭제하거나 서비스가 값을 갱신·삭제할 때까지 남습니다.'
        ]
      },
      {
        title: '외부 서비스와 국외 처리',
        paragraphs: [
          '서비스 제공 과정에서 아래 사업자가 접속 정보 또는 서비스 데이터를 국외에서 처리할 수 있습니다. 각 사업자는 해당 서비스의 계약과 개인정보 보호정책에 따라 정보를 보관합니다.'
        ],
        items: [
          'Cloudflare, Inc.: CDN, Worker, D1, Turnstile, 요청 제한과 IP 차단',
          'Google LLC: Apps Script와 Sheets를 이용한 방명록 및 관리자 데이터 처리',
          'GitHub, Inc.: 정적 사이트와 공개 콘텐츠 호스팅',
          'jsDelivr: 웹폰트 파일 제공'
        ]
      },
      {
        title: '자동 수집과 저장',
        paragraphs: [
          '채아무가 직접 운영하는 맞춤형 광고나 방문자 분석 도구는 현재 사용하지 않으며 자체 쿠키를 설정하지 않습니다. 외부 호스팅·보안 사업자는 서비스 제공에 필요한 접속 로그나 기술 정보를 처리할 수 있습니다.',
          '브라우저 설정에서 사이트 데이터를 삭제할 수 있습니다. 저장을 차단하면 언어 유지, 캐시, 방명록 또는 관리자 기능 일부가 정상 동작하지 않을 수 있습니다.'
        ]
      },
      {
        title: '이용자의 권리',
        paragraphs: [
          '이용자는 자신의 개인정보에 대한 열람, 정정, 삭제 또는 처리정지를 요청할 수 있습니다. 방명록은 작성 시 설정한 비밀번호로 직접 숨길 수 있으며, 추가 요청은 아래 이메일로 접수합니다.'
        ]
      },
      {
        title: '보호조치',
        items: [
          'IP 원문 대신 비밀키 기반 HMAC 해시 저장',
          '방명록 삭제 비밀번호의 salt·hash 처리와 서버 측 pepper 적용',
          'HTTPS 통신, 허용 출처 검사, 요청 횟수 제한과 Turnstile 검증',
          '관리자 비밀정보의 서버 보관과 세션 만료 적용'
        ]
      }
    ]
  } : {
    effective: `Effective ${EFFECTIVE_DATE}`,
    lead: 'Channel amu processes only the information needed to run the guestbook and the site. It does not sell personal information or track visitors for advertising.',
    sections: [
      {
        title: 'Information processed',
        items: [
          'Guestbook: message, optional name (ㅇㅁ when blank), time, entry ID, and visibility status',
          'Deletion authentication: salted password hash information, never the plain-text password',
          'Abuse prevention: an HMAC hash derived from the IP address, request counts, block status and history, and Turnstile verification data',
          'Browser storage: a random guestbook client ID, language preference, and public content cache',
          'Admin only: session information and in-progress post drafts'
        ]
      },
      {
        title: 'Purposes',
        items: [
          'Creating, displaying, deleting, and moderating guestbook messages',
          'Preventing spam, automated requests, and unauthorized access',
          'Authenticating administrators and managing posts and archive items',
          'Remembering the display language and improving content loading'
        ]
      },
      {
        title: 'Public information',
        paragraphs: [
          'Visible guestbook messages, names, and posting times can be viewed by anyone. Do not post sensitive information about yourself or others.'
        ]
      },
      {
        title: 'Retention and deletion',
        items: [
          'Guestbook and deletion-authentication data are kept until deletion is requested or the service closes. Password deletion first hides the message; the underlying record is removed when it is no longer needed for abuse prevention or dispute handling.',
          'IP hashes and block history are kept while needed to prevent abuse and deleted when that purpose ends.',
          'Browser data remains until you clear site data or the service updates or removes it.'
        ]
      },
      {
        title: 'Service providers and international processing',
        paragraphs: [
          'The following providers may process connection or service data outside your country under their service agreements and privacy policies.'
        ],
        items: [
          'Cloudflare, Inc.: CDN, Worker, D1, Turnstile, rate limits, and IP blocking',
          'Google LLC: Apps Script and Sheets for guestbook and admin data',
          'GitHub, Inc.: static site and public-content hosting',
          'jsDelivr: webfont delivery'
        ]
      },
      {
        title: 'Automatic collection and storage',
        paragraphs: [
          'Channel amu currently uses no first-party analytics, behavioral advertising, or first-party cookies. Hosting and security providers may process access logs or technical data needed to provide their services.',
          'You can clear site data in your browser. Blocking storage may prevent language preferences, caching, guestbook protections, or admin features from working correctly.'
        ]
      },
      {
        title: 'Your rights',
        paragraphs: [
          'You may request access, correction, deletion, or suspension of processing for your information. A guestbook message can be hidden with its deletion password. Send any additional request to the email below.'
        ]
      },
      {
        title: 'Security measures',
        items: [
          'Secret-key HMAC hashes are stored instead of raw IP addresses',
          'Guestbook deletion passwords use salts, hashes, and a server-side pepper',
          'HTTPS, origin checks, rate limits, and Turnstile verification',
          'Server-side admin secrets and expiring sessions'
        ]
      }
    ]
  };

  return (
    <AppLayout>
      <article className="privacy-document">
        <header className="privacy-document__header">
          <p className="privacy-document__date">{copy.effective}</p>
          <h1 className="page-title">{t('nav.privacy')}</h1>
          <p className="privacy-document__lead">{copy.lead}</p>
        </header>

        {copy.sections.map((section) => <PrivacySection key={section.title} {...section} />)}

        <section className="privacy-section privacy-section--contact">
          <h2>{isKorean ? '개인정보 문의' : 'Privacy contact'}</h2>
          <div className="privacy-section__body">
            <p>
              {isKorean ? '개인정보 처리에 관한 문의와 권리 행사는 ' : 'For privacy questions or requests, contact '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              {isKorean ? '으로 보내 주세요.' : '.'}
            </p>
            <p>{isKorean ? '방침을 변경하면 이 페이지에 시행일과 함께 알립니다.' : 'Changes to this policy will be posted on this page with an updated effective date.'}</p>
          </div>
        </section>
      </article>
      <BackToTopButton />
    </AppLayout>
  );
}
