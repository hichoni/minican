// Open Peeps 사람 그림(src/art/peeps.js 의 원본 peeps.json)을 만든다.
// @opeepsfun/open-peeps 1.0.6 의 build/ 를 esbuild 로 CommonJS 로 바꿔 ./cjs/ 에 두고(react@18 · react-dom@18 필요),
// 이 폴더에서 node peeps.cjs → peeps.json. 그다음 build.mjs 로 src/art/peeps.js 를 만든다.
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');const fs=require('fs');
const {Effigy}=require('./cjs/Effigy.js');
const skins=['#D08B5B','#EDB98A','#AE5D29','#FFDBB4','#7A4A2A'];
// [id, body, head, face, 한국어 이름과 찾는 낱말]
const list=[
['explaining','Explaining','Bun','Explaining','설명하는 사람 발표 선생님 안내'],
['idea','PointingUp','LongHair','Smile','손가락 든 사람 아이디어 질문 생각'],
['computer','Computer','ShortTwo','Calm','컴퓨터 하는 사람 노트북 코딩 공부'],
['reading','Paper','Hijab','Smile','종이 읽는 사람 문서 자료 학습지'],
['coffee','Coffee','GrayShort','SmileTeeth','커피 마시는 어른 휴식 쉬는 시간'],
['gaming','Gaming','Afro','BigSmile','게임하는 사람 휴대폰 놀이'],
['arms-crossed','TeeArmsCrossed','ShortOne','Serious','팔짱 낀 사람 진지 고민'],
['shrug','Whatever','MediumStraight','Suspicious','어깨 으쓱 모르겠다 사람'],
['hoodie','Hoodie','Bangs','Cute','후드티 학생 친구'],
['friend','Tee','Wavy','Smile','웃는 친구 학생 사람'],
['laughing','StripedTee','BunTwo','SmileLOL','깔깔 웃는 학생 즐거움'],
['sporty','SportyTee','Mohawk','Driven','운동하는 학생 의욕 도전'],
['calm','Jacket','LongCurly','Calm','차분한 사람 재킷 어른'],
['happy','Dress','LongBangs','LoveGrinTeeth','기쁜 사람 원피스 행복'],
['worried','ButtonShirt','ShortThree','Concerned','걱정하는 사람 고민 불안'],
['grandpa','PoloSweater','Bald','Old','할아버지 어르신 노인'],
['tired','SweaterDots','MediumBangs','Tired','피곤한 사람 지침 졸림'],
['serious','BlazerBlackTee','ShortFour','Solemn','진지한 사람 정장 어른'],
['amazed','ShirtCoat','Pomp','Awe','감탄하는 사람 놀람 우와'],
['eating','PolkadotJacket','ColorBun','EatingHappy','맛있게 먹는 사람 급식 간식'],
['busy','ThunderTee','Twists','Hectic','바쁜 사람 정신없음 당황'],
['smile','ButtonPocketShirt','Turban','Smile','웃는 사람 친절 미소'],
['quiet','Turtleneck','MediumOne','Calm','조용한 사람 차분'],
['scared','GymShirt','Beanie','Fear','무서워하는 사람 겁 공포'],
['cheeky','PoloSweater','LongHair','Cheeky','장난스러운 사람 메롱'],
['grin','TeeSelena','BantuKnots','SmileTeeth','활짝 웃는 학생 기쁨'],
['detective','StrippedPocketTee','FlatTop','Suspicious','의심하는 사람 탐정 수상해'],
['teacher','Explaining','Hijab','Explaining','설명하는 선생님 교사 발표'],
['question','PointingUp','Afro','Awe','질문하는 학생 손 들기 궁금'],
['studying','Computer','LongCurly','Driven','열심히 공부하는 학생 집중'],
['checking','Paper','ShortOne','Concerned','서류 확인하는 사람 점검'],
['resting','Tee','Cornrows','EyesClosed','눈 감고 쉬는 사람 명상 휴식'],
];
const round=s=>s.replace(/-?\d+\.\d{2,}/g,m=>String(Math.round(parseFloat(m)*10)/10));
const out=list.map(([id,body,head,face,ko],i)=>{const o={skinColor:skins[i%skins.length]};
 let s=renderToStaticMarkup(React.createElement(Effigy,{body:{type:body,options:o},head:{type:head,options:o},face:{type:face,options:{}}}));
 const view=s.match(/viewBox="([^"]+)"/)[1];
 s=s.replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'').replace(/ id="[^"]*"/g,'').replace(/<g><\/g>|<g transform="[^"]*"><\/g>/g,'');
 return {id,ko,body:round(s),view};});
fs.writeFileSync('peeps.json',JSON.stringify(out));
console.log(out.length,Math.round(JSON.stringify(out).length/1024)+'KB',new Set(out.map(x=>x.view)).size);
