// 미니캔의 그림들을 이 기기(브라우저의 IndexedDB)에 저장한다. 서버로는 아무것도 보내지 않는다.
// 저장소의 이름은 미니캔을 들여 쓰는 곳이 정할 수 있다(setStorageName). 영상 파일(videos.js)은 그 이름 뒤에 '-videos' 를 붙인 저장소에 둔다.
import { cleanRecord, sortRecords } from './designs.js';

let NAME = 'minican';
let dbJob = null;
const STORE = 'designs';
const NAME_RULE = /^[a-z][a-z0-9.-]{0,40}$/;

/** 저장소의 이름을 정한다. 앱을 시작하기 전에 한 번 부른다. */
export function setStorageName(name) {
  if (!NAME_RULE.test(name)) throw new Error('storage name');
  NAME = name;
  dbJob = null;
}
export const storageName = () => NAME;

const open = () => (dbJob ||= new Promise((resolve, reject) => {
  const q = indexedDB.open(NAME, 1);
  q.onupgradeneeded = () => q.result.createObjectStore(STORE);
  q.onsuccess = () => resolve(q.result);
  q.onerror = () => reject(q.error);
  q.onblocked = () => reject(new Error('blocked'));
}).catch((ex) => { dbJob = null; throw ex; }));
const run = async (mode, work) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
};

/** 이 기기의 그림들(최근에 고친 것부터). 모양이 이상한 것은 뺀다. */
export async function listDesigns() {
  const all = await run('readonly', (s) => s.getAll());
  return sortRecords((all || []).map(cleanRecord).filter(Boolean));
}
/** 그림 하나(없으면 null). */
export async function getDesign(id) {
  return cleanRecord(await run('readonly', (s) => s.get(id)));
}
/** 저장(같은 이름표면 덮어쓴다). */
export async function putDesign(record) {
  const clean = cleanRecord(record);
  if (!clean) throw new Error('bad-record');
  await run('readwrite', (s) => s.put(clean, clean.id));
  return clean;
}
/** 지우기. */
export function removeDesign(id) {
  return run('readwrite', (s) => s.delete(id));
}
