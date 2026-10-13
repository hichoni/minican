// 파일 여러 개를 압축 파일(.zip) 하나로 묶는다. 줄이지 않고 그대로 담는다(PNG·JPG 는 이미 줄어 있어서 다시 줄여도 거의 그대로다).
// 바깥 라이브러리 없이 쓰려고 꼭 필요한 만큼만 만들었다. DOM 을 쓰지 않는 순수 함수라 node 에서도 테스트한다.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
/** 파일 내용의 검사 값(CRC-32). */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 파일들을 zip 하나로 묶는다. files: [{ name(영어·숫자 이름), bytes(Uint8Array) }]. 돌려주는 것: Uint8Array.
 * when: 파일에 적을 날짜(Date).
 */
export function zipStore(files, when = new Date()) {
  const enc = new TextEncoder();
  const time = ((when.getHours() & 31) << 11) | ((when.getMinutes() & 63) << 5) | ((when.getSeconds() >> 1) & 31);
  const date = (((when.getFullYear() - 1980) & 127) << 9) | (((when.getMonth() + 1) & 15) << 5) | (when.getDate() & 31);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(String(file.name));
    const data = file.bytes;
    const crc = crc32(data);
    // 파일마다: 머리말(30바이트) + 이름 + 내용
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);              // 풀 때 필요한 버전
    head.setUint16(6, 0x0800, true);          // 이름은 UTF-8
    head.setUint16(8, 0, true);               // 줄이지 않음
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);
    parts.push(new Uint8Array(head.buffer), name, data);
    // 맨 뒤에 붙는 목록의 한 줄(46바이트) + 이름
    const row = new DataView(new ArrayBuffer(46));
    row.setUint32(0, 0x02014b50, true);
    row.setUint16(4, 20, true);
    row.setUint16(6, 20, true);
    row.setUint16(8, 0x0800, true);
    row.setUint16(10, 0, true);
    row.setUint16(12, time, true);
    row.setUint16(14, date, true);
    row.setUint32(16, crc, true);
    row.setUint32(20, data.length, true);
    row.setUint32(24, data.length, true);
    row.setUint16(28, name.length, true);
    row.setUint32(42, offset, true);          // 이 파일의 머리말이 시작하는 자리
    central.push(new Uint8Array(row.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}
