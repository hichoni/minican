// 미니캔의 영상 파일 읽기(demux.js): 영상 조각들이 파일의 어디에 있고 언제 보이는지 읽어 내는 일.
// 진짜 파일(ffmpeg 으로 만든 아주 작은 것. tests/fixtures/)은 ffprobe 가 읽은 값과 견주고, 우리가 묶은 파일(mux.js)은 넣은 것과 견준다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demuxVideo, demuxMp4, demuxWebm, bytesReader } from '../src/demux.js';
import { muxMp4, muxWebm } from '../src/mux.js';

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const SPAN = 1e6 / 30;
const sample = (i) => ({ data: new Uint8Array(40 + (i % 7) * 13).fill((i % 250) + 1), key: i % 60 === 0, ts: Math.round(i * SPAN), dur: Math.round(SPAN) });
const samplesOf = (n) => Array.from({ length: n }, (_, i) => sample(i));
const AVCC = Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, 0xee]);
const sound = () => ({ codec: 'opus', rate: 48000, channels: 2, description: null, samples: Array.from({ length: 250 }, (_, i) => ({ data: new Uint8Array(30 + (i % 5)).fill(0xa0 + (i % 16)), ts: i * 20000, dur: 20000 })) });
// [보이는 때(마이크로초), 크기, 파일에서의 자리, 온전한 장면인지] 로 줄여 견준다
const rows = (info) => info.samples.map((s) => [s.ts, s.size, s.pos, s.key ? 1 : 0]);

test('MP4(진짜 파일): 뒤의 장면을 먼저 담은 영상도 푸는 차례 · 보이는 때 · 자리 · 돌린 각도를 그대로 읽는다', async () => {
  // ffmpeg: H.264(High) 32×32 · 15fps · B 프레임 2장 · 소리(AAC) 트랙 · 시계 방향으로 90도 돌려 보라는 표시
  const info = await demuxVideo(bytesReader(fixture('bframes-rot90.mp4')));
  assert.deepEqual([info.container, info.codec, info.codecString, info.width, info.height, info.rotation], ['mp4', 'avc', 'avc1.64000a', 32, 32, 90]);
  assert.equal(info.description.length, 44, '디코더에 줄 설정 기록(avcC)');
  assert.deepEqual([info.description[0], info.description[1]], [1, 0x64]);
  // ffprobe -show_entries packet=pts_time,size,pos,flags 가 읽은 것(파일에 담긴 차례)
  assert.deepEqual(rows(info), [
    [0, 134, 1858, 1], [200000, 12, 1992, 0], [66667, 12, 2073, 0], [133333, 12, 2272, 0], [333333, 18, 2427, 0], [266667, 12, 2593, 0],
    [400000, 160, 2743, 1], [600000, 18, 3049, 0], [466667, 12, 3213, 0], [533333, 12, 3370, 0], [733333, 18, 3481, 0], [666667, 12, 3639, 0],
  ]);
  assert.equal(info.color, 'untagged', '색을 읽는 법이 적혀 있지 않은 파일');
  // 소리 트랙의 조각은 섞여 들어오지 않는다(그림 조각 12장뿐이다). 소리 트랙이 있고, 영상과 함께 시작한다
  assert.equal(info.samples.length, 12);
  assert.deepEqual([info.audio, info.audioStart], [true, 0]);
});

test('MP4 의 편집표(elst): 앞을 잘라 낸 영상 · 늦게 시작하는 트랙의 때를 재생기가 보여 주는 때로 읽는다', async () => {
  // 앞의 0.2초를 "다시 인코딩하지 않고" 잘라 낸 파일(ffmpeg -ss 0.2 -c copy): 조각은 그대로 있고, 편집표가 0.2초부터 쓰라고 한다.
  // 0 보다 앞인 조각은 풀 때에만 쓰이고 보이지 않는다(ffprobe 도 그 조각들의 때를 음수로 읽는다).
  const cut = await demuxVideo(bytesReader(fixture('cut-elst.mp4')));
  assert.deepEqual(cut.samples.map((s) => s.ts), [-200000, 0, -133333, -66667, 133333, 66667, 200000, 400000, 266667, 333333, 533333, 466667]);
  assert.deepEqual(cut.samples.map((s) => (s.key ? 1 : 0)).join(''), '100000100000');
  assert.equal(cut.samples[0].key && cut.samples[0].ts < 0, true, '0초의 장면을 풀려면 그 앞의 온전한 장면부터 넣어야 한다');
  // 영상이 0.4초, 소리가 0.176초 늦게 시작하는 파일(편집표의 앞에 빈 구간이 있다)
  const late = await demuxVideo(bytesReader(fixture('late-tracks.mp4')));
  assert.deepEqual(late.samples.map((s) => s.ts), [400000, 600000, 466667, 533333, 733333, 666667, 800000, 1000000, 866667, 933333, 1133333, 1066667]);
  assert.equal(late.audio, true);
  assert.ok(Math.abs(late.audioStart - 176009) <= 1000, `소리가 시작하는 때 ${late.audioStart}`);
});

test('WebM: 소리가 늦게 시작하는 파일은 그때를 알려 준다(인코더의 준비 구간은 뺀다)', async () => {
  // 소리(Opus)를 0.3초 늦춘 파일. 첫 소리 조각의 때는 0.307초쯤이지만, 그 가운데 6.5밀리초는 풀 때 버리는 준비 구간(CodecDelay)이다.
  const late = await demuxVideo(bytesReader(fixture('late-audio.webm')));
  assert.equal(late.audio, true);
  assert.ok(Math.abs(late.audioStart - 300000) <= 1000, `소리가 시작하는 때 ${late.audioStart}`);
  assert.equal(late.samples[0].ts, 7000, '그림 조각의 때는 파일에 적힌 그대로다(재생기와 같다)');
  // 소리가 영상과 함께 시작하는 파일
  const together = await demuxVideo(bytesReader(fixture('vp8-opus.webm')));
  assert.deepEqual([together.audio, together.audioStart <= 1000], [true, true]);
  // 소리 트랙이 없는 파일(우리가 그림만 묶은 것)
  const mute = await demuxVideo(bytesReader(muxWebm({ codec: 'vp8', width: 64, height: 64, samples: samplesOf(3) })));
  assert.deepEqual([mute.audio, mute.audioStart], [false, 0]);
  const muteMp4 = await demuxVideo(bytesReader(muxMp4({ width: 64, height: 64, description: AVCC, samples: samplesOf(3) })));
  assert.deepEqual([muteMp4.audio, muteMp4.audioStart], [false, 0]);
});

test('WebM(진짜 파일): 소리와 섞여 있어도 그림 조각만, 제때 · 제자리로 읽는다', async () => {
  // ffmpeg: VP8 32×32 · 15fps · 소리(Opus) 트랙
  const file = fixture('vp8-opus.webm');
  const info = await demuxVideo(bytesReader(file));
  assert.deepEqual([info.container, info.codec, info.codecString, info.width, info.height, info.rotation, info.description ?? null], ['webm', 'vp8', 'vp8', 32, 32, 0, null]);
  // ffprobe 가 읽은 것. 자리는 ffprobe 보다 4 뒤다(ffprobe 는 조각 앞의 머리 4바이트부터, 우리는 디코더에 넣을 속부터 센다)
  const probe = [[0, 759, 704, 1], [67000, 37, 1543, 0], [133000, 51, 1655, 0], [200000, 56, 1812, 0], [267000, 65, 1950, 0], [333000, 56, 2094, 0],
    [400000, 773, 2245, 1], [467000, 52, 3086, 0], [533000, 87, 3213, 0], [600000, 74, 3397, 0], [667000, 77, 3541, 0], [733000, 80, 3691, 0]];
  assert.deepEqual(rows(info), probe.map(([ts, size, pos, key]) => [ts, size, pos + 4, key]));
  // VP8 의 온전한 장면은 속의 첫 바이트의 맨 아래 비트가 0 이다(자리가 정말 조각의 속을 가리킨다)
  for (const s of info.samples) assert.equal(file[s.pos] & 1, s.key ? 0 : 1);
  assert.equal(info.color, 'untagged');
});

test('우리가 묶은 파일(mux.js)을 다시 읽으면 넣은 조각이 그대로 나온다(소리를 함께 담았어도)', async () => {
  const samples = samplesOf(150);
  const files = [
    ['mp4', muxMp4({ width: 1920, height: 1080, description: AVCC, samples }), 'avc', 'avc1.640028', 0],
    ['mp4 + 소리', muxMp4({ width: 1920, height: 1080, description: AVCC, samples, audio: sound() }), 'avc', 'avc1.640028', 0],
    ['webm', muxWebm({ codec: 'vp9', width: 1920, height: 1080, samples }), 'vp9', null, 999],
    ['webm + 소리', muxWebm({ codec: 'vp8', width: 1920, height: 1080, samples, audio: sound() }), 'vp8', 'vp8', 999],
  ];
  for (const [name, file, codec, codecString, slack] of files) {
    const info = await demuxVideo(bytesReader(file));
    assert.ok(info, name);
    assert.deepEqual([info.codec, info.width, info.height, info.rotation, info.samples.length], [codec, 1920, 1080, 0, 150], name);
    if (codecString) assert.equal(info.codecString, codecString, name);
    info.samples.forEach((s, i) => {
      assert.equal(s.size, samples[i].data.length, `${name}: 조각 ${i} 의 크기`);
      assert.deepEqual([file[s.pos], file[s.pos + s.size - 1]], [samples[i].data[0], samples[i].data[0]], `${name}: 조각 ${i} 의 자리`);
      assert.equal(s.key, samples[i].key, `${name}: 조각 ${i}`);
      // WebM 은 때를 밀리초로 적으므로 그만큼의 차이는 난다
      assert.ok(Math.abs(s.ts - samples[i].ts) <= slack, `${name}: 조각 ${i} 의 때 ${s.ts} / ${samples[i].ts}`);
    });
  }
  // MP4 의 설정 기록은 넣은 것 그대로다
  assert.deepEqual([...(await demuxVideo(bytesReader(files[0][1]))).description], [...AVCC]);
});

test('읽을 수 없는 파일은 null 이다(부르는 쪽이 다른 길을 쓴다): 조각난 MP4 · 모르는 모양 · 빈 파일 · 잘린 파일', async () => {
  assert.equal(await demuxVideo(bytesReader(fixture('fragmented.mp4'))), null, '조각난 MP4(녹화한 MP4 가 이런 모양이다)');
  assert.equal(await demuxVideo(bytesReader(new Uint8Array(0))), null);
  assert.equal(await demuxVideo(bytesReader(new Uint8Array(500))), null);
  assert.equal(await demuxVideo(bytesReader(Uint8Array.from({ length: 4000 }, (_, i) => (i * 37) & 0xff))), null);
  // 잘린 파일: 던지지 않는다. 읽히는 데까지만 돌려주거나 null 이고, 돌려준 조각은 모두 파일 안에 있다
  for (const name of ['bframes-rot90.mp4', 'vp8-opus.webm']) {
    const whole = fixture(name);
    for (const cut of [1, 8, 40, 300, 1200, 2500, whole.length - 1]) {
      const part = whole.subarray(0, cut);
      const info = await demuxVideo(bytesReader(part));
      if (info) for (const s of info.samples) assert.ok(s.pos >= 0 && s.pos + s.size <= part.length, `${name} @${cut}`);
    }
  }
  // 종류를 정해 부른 것도 남의 파일에는 null 이다
  assert.equal(await demuxMp4(bytesReader(fixture('vp8-opus.webm'))), null);
  assert.equal(await demuxWebm(bytesReader(fixture('bframes-rot90.mp4'))), null);
});

test('읽는 쪽이 약속으로 답해도(Blob) 되고, 파일을 통째로 읽지 않는다', async () => {
  const file = fixture('vp8-opus.webm');
  let most = 0;
  const reader = { size: file.length, read: async (pos, len) => { most = Math.max(most, len); return file.subarray(pos, Math.min(file.length, pos + len)); } };
  const info = await demuxVideo(reader);
  assert.equal(info.samples.length, 12);
  assert.ok(most > 0);
  // 큰 MP4: 조각의 속(mdat)은 읽지 않고 머리말만 읽는다
  const samples = Array.from({ length: 40 }, (_, i) => ({ data: new Uint8Array(200000).fill(i + 1), key: i % 20 === 0, ts: Math.round(i * SPAN), dur: Math.round(SPAN) }));
  const big = muxMp4({ width: 640, height: 360, description: AVCC, samples });
  let total = 0;
  const got = await demuxVideo({ size: big.length, read: (pos, len) => { const part = big.subarray(pos, Math.min(big.length, pos + len)); total += part.length; return part; } });
  assert.equal(got.samples.length, 40);
  assert.ok(total < big.length / 2, `읽은 양 ${total} / ${big.length}`);
});

test('짜임새: 읽기 모듈은 바이트만 다루고(화면을 쓰지 않는다), 아무것도 가져다 쓰지 않는다', () => {
  const src = read('demux.js');
  assert.doesNotMatch(src, /^import /m);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /\b(document|window|navigator)\b/);
  // 릴은 풀어서 꺼내는 길을 먼저 쓰고, 안 되면(또는 꺼내다 실패하면) 찾아가서 꺼내는 길로 바꾼다
  const reel = read('reel.js');
  assert.deepEqual([...reel.matchAll(/from '([^']+)'/g)].map((m) => m[1]), ['./demux.js']);
  // 찾아가서 꺼낼 때에는 조금 뒤를 가리킨다(장면이 바뀌는 바로 그때를 가리키면 앞 장면이 나오기도 한다)
  assert.match(reel, /const at = Math\.min\(Math\.max\(0, t\) \+ SEEK_SLACK, Math\.max\(SEEK_SLACK, end - 0\.001\)\);/);
  assert.match(reel, /try \{ reel = await codecReel\(blob\); \} catch \(ex\) \{ console\.warn\(ex\); \}\n  if \(!reel\) reel = await seekReel\(blob\);/);
  assert.match(reel, /if \(closed \|\| reel\.kind === 'seek'\) throw ex;/);
  // 색을 읽는 법이 적혀 있지 않은 영상은 재생기(<video>)와 같은 짐작을 디코더에 알려 준다(발표 화면과 색이 같게)
  assert.match(reel, /if \(info\.color === 'untagged'\) \{\n    const kind = info\.height < 720 \? 'smpte170m' : 'bt709';/);
});
