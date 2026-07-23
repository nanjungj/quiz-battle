// 게임풍 칩튠 배경음악 — Web Audio API로 실시간 생성(파일 없음). 관리자 화면 전용.
// 문제 풀이 중 경쾌한 8비트 루프, 마지막 5초 urgent 시 템포 가속. 정답 공개 시 정지.

let ctx = null, master = null;
let playing = false, muted = false, urgent = false;
let nextTime = 0, step = 0, timer = null;

// C장조, 코드진행 C–Am–G–F (I–vi–V–IV, 밝고 신남). 32 스텝(16분음표 2마디).
// 숫자는 MIDI 노트(60=가온다 C4), null=쉼표.
const MELODY = [
  72, null, 76, null, 79, null, 76, null,   69, null, 72, null, 76, null, 72, null,
  74, null, 71, null, 67, null, 71, 74,     77, null, 74, null, 72, null, 65, null
];
const BASS = [
  48, null, null, null, 45, null, null, null, 43, null, null, null, 41, null, null, null,
  48, null, null, null, 45, null, null, null, 43, null, null, null, 43, null, null, null
];

const LOOKAHEAD = 0.12;   // 스케줄 미리보기(초)
const TICK = 25;          // 스케줄러 주기(ms)

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

function stepDur() { return (urgent ? 60 / 176 : 60 / 132) / 4; } // 16분음표 길이

function blip(freq, start, dur, type, gain) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  o.connect(g); g.connect(master);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.start(start); o.stop(start + dur + 0.02);
}

function hat(start, gain) {
  const dur = 0.03;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(hp); hp.connect(g); g.connect(master);
  src.start(start); src.stop(start + dur);
}

function scheduleStep(i, t) {
  if (muted) return;
  const dur = stepDur();
  const m = MELODY[i];
  if (m != null) blip(midi(m), t, dur * 0.92, 'square', 0.3);
  const b = BASS[i];
  if (b != null) blip(midi(b), t, dur * 3.6, 'triangle', 0.5);
  if (i % 2 === 0) hat(t, urgent ? 0.22 : 0.12);           // 8분음표 하이햇
  if (urgent && i % 4 === 0) blip(midi(84), t, dur * 0.5, 'square', 0.18); // 긴박: 고음 틱
}

function scheduler() {
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    scheduleStep(step, nextTime);
    nextTime += stepDur();
    step = (step + 1) % MELODY.length;
  }
}

export function startMusic() {
  ensureCtx();
  if (playing) return;
  playing = true; step = 0; nextTime = ctx.currentTime + 0.06;
  timer = setInterval(scheduler, TICK);
}

export function stopMusic() {
  playing = false;
  if (timer) { clearInterval(timer); timer = null; }
}

export function setUrgent(v) { urgent = !!v; }

export function toggleMute() {
  muted = !muted;
  return muted;
}

export function isMuted() { return muted; }

// 최종 결과용 승리 팡파레(짧은 상승 아르페지오)
export function playVictory() {
  ensureCtx();
  if (muted) return;
  const seq = [60, 64, 67, 72, 76, 79, 84];
  const t0 = ctx.currentTime + 0.02;
  seq.forEach((n, i) => blip(midi(n), t0 + i * 0.11, 0.18, 'square', 0.32));
  blip(midi(72), t0 + seq.length * 0.11, 0.5, 'triangle', 0.4);
}
