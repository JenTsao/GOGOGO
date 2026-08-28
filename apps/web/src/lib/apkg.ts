// 真 .apkg 构建器（蓝皮书「编译与输出：Anki卡片包(.apkg)」）
// 原理：.apkg = zip(collection.anki2(SQLite) + media(JSON))。
// SQLite 用 sql.js（wasm，纯 JS 无原生依赖）；表结构与 col.models JSON 严格对齐 Anki 2 调度器（schema ver 11）
import initSqlJs, { type Database } from 'sql.js';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';

export interface AnkiCard {
  front: string; // 允许内联 HTML（含 <img>）
  back: string;
  tags?: string[];
}

const MODEL_ID = 1704033600; // 固定模型 id（Basic 变体）
const DECK_ID = 2; // 1 被 Anki 的 Default 牌组保留，学习牌组用 2

// Anki 期望的 Basic 模型 JSON（flds/tmpls/req 结构对齐 genanki，避免导入后卡片不可见）
function modelJson(): Record<string, unknown> {
  const fld = (name: string, ord: number) => ({ name, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] });
  return {
    [MODEL_ID]: {
      id: `${MODEL_ID}`,
      name: 'Gaokao Basic',
      type: 0,
      mod: MODEL_ID,
      usn: -1,
      sortf: 0,
      did: DECK_ID,
      tmpls: [
        {
          name: 'Card 1',
          ord: 0,
          qfmt: '{{Front}}',
          afmt: '{{FrontSide}}<hr id=answer>{{Back}}',
          bqfmt: '',
          bafmt: '',
          did: null,
        },
      ],
      flds: [fld('Front', 0), fld('Back', 1)],
      css: '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
      latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
      latexPost: '\\end{document}',
      latexsvg: false,
      req: [[0, 'all', ['0']]],
      tags: [],
      vers: [],
    },
  };
}

// col.conf / dconf 最小合法配置（Anki 导入时校验结构）
const CONF = {
  nextPos: 1,
  estTimes: true,
  activeDecks: [DECK_ID],
  sortType: 'noteFld',
  timeLim: 0,
  sortBackwards: false,
  addToCur: true,
  curDeck: DECK_ID,
  newBury: true,
  newSpread: 0,
  dueCounts: true,
  curModel: `${MODEL_ID}`,
  collapseTime: 1200,
};

function deckJson(deckName: string): Record<string, unknown> {
  const deck: Record<string, unknown> = {
    id: DECK_ID,
    name: deckName,
    desc: '',
    conf: 1,
    usn: -1,
    collapsed: false,
    browserCollapsed: false,
    newToday: [0, 0],
    revToday: [0, 0],
    lrnToday: [0, 0],
    timeToday: [0, 0],
    dyn: 0,
    extendNew: 10,
    extendRev: 50,
  };
  return { 1: { ...deck, name: 'Default' }, [DECK_ID]: deck };
}

const DCONF = {
  1: {
    id: 1,
    name: 'Default',
    mod: 0,
    usn: 0,
    maxTaken: 60,
    new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200 },
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
    timer: 0,
    autoplay: true,
    replayq: true,
  },
};

// guid：内容哈希（同内容同 guid，重复导入不产生重复卡片——Anki 按 guid 去重）
function guidFor(front: string, back: string): string {
  const hex = createHash('sha1').update(`${front}\x1f${back}`).digest('hex');
  return hex.slice(0, 10);
}

// csum：第一字段文本的 sha1 前 8 位十六进制 → 整数（Anki 去重辅助）
function csumFor(front: string): number {
  const plain = front.replace(/<[^>]+>/g, '').trim();
  return parseInt(createHash('sha1').update(plain).digest('hex').slice(0, 8), 16);
}

export async function buildApkg(deckName: string, cards: AnkiCard[]): Promise<Buffer> {
  const SQL = await initSqlJs();
  const db: Database = db_scaffold(SQL);
  const now = Date.now();

  const insertNote = db.prepare(
    'INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  );
  const insertCard = db.prepare(
    'INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const models = modelJson();

  cards.forEach((card, i) => {
    const nid = now + i;
    const cid = now + 1_000_000 + i;
    const flds = `${card.front}\x1f${card.back}`;
    const tagsStr = card.tags?.length ? ` ${card.tags.map((t) => t.replace(/\s+/g, '_')).join(' ')} ` : '';
    insertNote.run([nid, guidFor(card.front, card.back), MODEL_ID, Math.floor(now / 1000), -1, tagsStr, flds, card.front, csumFor(card.front), 0, '']);
    // type=0 new, queue=0 new, due=nextPos（顺序学习）
    insertCard.run([cid, nid, DECK_ID, 0, Math.floor(now / 1000), -1, 0, 0, i + 1, 0, 0, 0, 0, 0, 0, 0, 0, '']);
  });
  insertNote.free();
  insertCard.free();

  const crt = Math.floor(now / 1000) - (Math.floor(now / 1000) % 86400); // 当天零点（秒）
  db.run(
    'INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)',
    [
      crt,
      now,
      now,
      JSON.stringify(CONF),
      JSON.stringify(models),
      JSON.stringify(deckJson(deckName)),
      JSON.stringify(DCONF),
      '{}',
    ]
  );

  const data = db.export();
  db.close();

  const zip = new JSZip();
  zip.file('collection.anki2', Buffer.from(data));
  zip.file('media', '{}');
  return zip.generateAsync({ type: 'nodebuffer' });
}

// 建表（Anki 2 schema ver 11 标准 DDL，列名/类型与官方一致，Anki 才认）
function db_scaffold(SQL: Awaited<ReturnType<typeof initSqlJs>>): Database {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
    CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
    CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
    CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
    CREATE TABLE graves (id integer primary key, oid integer not null, type integer not null);
    CREATE INDEX ix_notes_usn on notes (usn);
    CREATE INDEX ix_cards_usn on cards (usn);
    CREATE INDEX ix_revlog_usn on revlog (usn);
    CREATE INDEX ix_cards_nid on cards (nid);
    CREATE INDEX ix_cards_sched on cards (did, queue, due);
    CREATE INDEX ix_revlog_cid on revlog (cid);
    CREATE INDEX ix_notes_csum on notes (csum);
  `);
  return db;
}
