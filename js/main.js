// 주소 하나로 세 역할을 나눠 맡는다.
//
//   /?room=CODE     → 교육생 입장 (QR로 들어온 경우 코드 자동 입력)
//   /               → 교육생 입장 + 구석의 '강사용'
//   /?results=CODE  → 강사 전용 전체 순위 (시상대 화면의 버튼이 새 창으로 연다)
//
// 역할별 코드는 필요할 때만 import 한다. 교육생이 관리자 코드를 내려받을 일도,
// 전체 순위 창이 진행 코드를 내려받을 일도 없다.

const params = new URLSearchParams(location.search);
const show = id => document.getElementById(id).classList.remove('hidden');
const hide = id => document.getElementById(id).classList.add('hidden');

if (params.has('results')) {
  // ── 전체 순위 창 ──
  document.body.classList.add('admin');
  hide('join');
  show('rGate');
  import('./results.js');
} else {
  // ── 교육생 (기본) ──
  import('./player.js');

  let adminLoaded = false;
  async function openHost() {
    hide('join');
    hide('stage');
    show('gate');
    document.body.classList.add('admin');       // 대형 스크린용 확대 규칙
    document.getElementById('muteBtn').classList.remove('hidden');
    if (!adminLoaded) { adminLoaded = true; await import('./admin.js'); }
    document.getElementById('pw').focus();
  }
  document.getElementById('hostLink').onclick = openHost;

  // 예전 admin.html 주소로 들어온 경우 바로 강사 화면으로
  if (params.has('host')) openHost();

  document.getElementById('backToJoin').onclick = () => {
    hide('gate');
    show('join');
    document.body.classList.remove('admin');
    document.getElementById('muteBtn').classList.add('hidden');
    document.getElementById('code').focus();
  };
}
