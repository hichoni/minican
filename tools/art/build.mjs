// 그림 묶음(src/art/*.js)을 만든다. 손으로 고치지 않고 이 스크립트로 다시 만든다.
//   node tools/art/build.mjs <fluent-emoji-flat 의 icons.json> <tabler 의 icons.json> <pixelarticons 의 icons.json> <peeps.json>
// 원본: npm 의 @iconify-json/fluent-emoji-flat 1.2.6 · @iconify-json/tabler 1.2.42 · @iconify-json/pixelarticons 1.2.10 (모두 MIT),
//       peeps.json 은 tools/art/peeps.cjs 가 @opeepsfun/open-peeps 1.0.6(Open Peeps, CC0)으로 만든다.
// 고른 그림과 한국어 낱말은 tools/art/*.txt 에 있다(이름|낱말들).
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const out = new URL('../../src/art/', import.meta.url);
const [fluent, tabler, pixel, peeps] = process.argv.slice(2);
if (!peeps) throw new Error('icons.json 셋과 peeps.json 을 차례로 주세요');

function picks(list) {
  return readFileSync(new URL(list, here), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('|'));
}
function iconify(file, list) {
  const set = JSON.parse(readFileSync(file, 'utf8'));
  const size = [set.width || 16, set.height || 16];
  return picks(list).map(([name, words]) => {
    const real = set.icons[name] || set.icons[set.aliases?.[name]?.parent];
    if (!real) throw new Error(`${list}: ${name} 이 원본에 없어요`);
    if (/\sid=|url\(#/.test(real.body)) throw new Error(`${list}: ${name} 은 id 를 써서 여러 개를 놓으면 겹쳐요`);
    if (/<script|\son\w+=|href=/i.test(real.body)) throw new Error(`${list}: ${name} 에 스크립트·링크가 있어요`);
    const w = real.width || size[0], h = real.height || size[1];
    if (w !== size[0] || h !== size[1]) throw new Error(`${list}: ${name} 의 크기가 묶음과 달라요`);
    return [name, words.trim(), real.body];
  });
}
function write(file, pack) {
  const lines = pack.items.map((it) => `    ${JSON.stringify(it)},`).join('\n');
  writeFileSync(new URL(file, out), `// 만든 것: tools/art/build.mjs (손으로 고치지 않는다). ${pack.source}\n`
    + `// 요소 하나: [이름, 한국어 이름과 찾는 낱말, SVG 안쪽]\n`
    + `export default {\n  id: ${JSON.stringify(pack.id)},\n  view: ${JSON.stringify(pack.view)},\n  color: ${pack.color},\n  items: [\n${lines}\n  ],\n};\n`);
  console.log(file, pack.items.length);
}

write('fluent.js', { id: 'fe', view: '0 0 32 32', color: false, items: iconify(fluent, 'fluent.txt'), source: 'Fluent Emoji (Microsoft, MIT): LICENSE-fluent-emoji.txt' });
write('tabler.js', { id: 'tb', view: '0 0 24 24', color: true, items: iconify(tabler, 'tabler.txt'), source: 'Tabler Icons (Paweł Kuna, MIT): LICENSE-tabler-icons.txt' });
write('pixel.js', { id: 'px', view: '0 0 24 24', color: true, items: iconify(pixel, 'pixel.txt'), source: 'Pixelarticons (Gerrit Halfmann, MIT): LICENSE-pixelarticons.txt' });
const people = JSON.parse(readFileSync(peeps, 'utf8'));
if (new Set(people.map((p) => p.view)).size !== 1) throw new Error('peeps.json 의 그림 칸이 서로 달라요');
for (const p of people) if (/<script|\son\w+=|href=|url\(#/i.test(p.body)) throw new Error(`peeps: ${p.id}`);
const view = people[0].view.split(' ').map((v) => String(Math.round(Number(v) * 1000) / 1000)).join(' ');
write('peeps.js', { id: 'pp', view, color: false, items: people.map((p) => [p.id, p.ko, p.body]), source: 'Open Peeps (Pablo Stanley, CC0): LICENSE-open-peeps.txt' });
