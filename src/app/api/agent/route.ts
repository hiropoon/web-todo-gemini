import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';

const TZ = process.env.TZ || 'Asia/Tokyo';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

export const runtime = 'nodejs'; // Ensure this is set for serverless environments

export async function POST(req: Request) {
  console.log('[api/agent] hit'); // ←一時ログ
  try {
    const { items, date } = await req.json() as { items: string[]; date?: string };
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items is required' }, { status: 400 });
    }

    const day = date ?? new Date().toLocaleDateString('sv-SE', { timeZone: TZ }); // YYYY-MM-DD

    const parsed = await parseTasks(day, items);
    const plan = buildPlan(day, parsed.tasks);
    const results = await runAssist(parsed);

    return NextResponse.json({
      date: day,
      plan,
      results,
      summary: formatPlan(plan),
      meta: { tz: TZ }
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown error' }, { status: 400 });
  }
}

/** ---------- LLM パース ---------- */
async function parseTasks(date: string, items: string[]) {
  const system = `あなたは日本語のタスク分解アシスタント。
必ず次のJSONだけを返す:
{"tasks":[{"original":string,"type":"schedule"|"email"|"message"|"doc"|"study"|"plan_venue","title":string,"due":string|null,"duration_min":number|null,"start_at":string|null,"notes":string|null,"subtasks":string[]}]}
ルール:
- 相対表現は全て「${date}」のAsia/Tokyo基準。
- 「飲み会の調査」は type="plan_venue"、場所/時間/人数をnotesへ。
- 学習/読書/資料作成/経費精算はそれぞれ study/doc/schedule、duration_minを推定（無ければ30）。
- 明示時刻（例: 朝9時/19時）があれば ISO8601(+09:00)で start_at を埋める。`;
  const prompt = `日付: ${date}\nタスク:\n${items.map(x=>`- ${x}`).join('\n')}`;

  const r = await model.generateContent(system + '\n\n' + prompt);
  let jsonText = r.response.text().trim().replace(/^```json\s*|\s*```$/g, '');
  return JSON.parse(jsonText);
}

/** ---------- 実行支援（メール文/会場など） ---------- */
async function runAssist(parsed: any) {
  const results: Record<string, any> = {};
  for (const t of parsed.tasks) {
    if (t.type === 'email' || t.type === 'message') {
      const toName = guessToName(t.title);
      const subject = guessSubject(t.title);
      results[t.title] = { kind: 'draft', body: await draftEmail(subject, t.notes ?? t.original, toName) };
    } else if (t.type === 'plan_venue') {
      results[t.title] = { kind: 'venues', note: 'Places未設定のためスキップ', candidates: [] };
    } else {
      results[t.title] = { kind: 'subtasks', subtasks: t.subtasks ?? [], duration_min: t.duration_min ?? 30 };
    }
  }
  return results;
}

function guessToName(title: string) {
  const m = title.match(/(佐藤|加藤|田中|鈴木)[^様さん]?/);
  return m ? m[1] + '様' : 'ご担当者様';
}
function guessSubject(title: string) {
  return title.replace(/(に|へ|の|を|連絡|返信|メール|の件)/g, '').trim() || 'ご連絡';
}

async function draftEmail(subject: string, intent: string, toName: string) {
  const prompt = `件名: ${subject}
宛名: ${toName}
目的: 下の意図を踏まえて、ビジネス日本語で簡潔にすぐ送れるメール本文だけを作成。
条件:
- 冒頭あいさつ→要件→依頼/結び
- 100〜180字、敬体、署名なし
- 箇条書きは短く
- 具体的な日付・時刻・URLは勝手に作らない。必要なら「ご都合を伺う」形にする。
意図: ${intent}`;
  const r = await model.generateContent(prompt);
  return r.response.text().trim();
}

/** ---------- 計画：固定→可変の順で割付 ---------- */
function buildPlan(date: string, tasks: any[]) {
  const fixed:any[] = [], flex:any[] = [];
  for (const t of tasks) {
    const dur = t.duration_min ?? 30;
    if (t.start_at) {
      const start = new Date(t.start_at);
      const end = new Date(start.getTime() + dur * 60000);
      fixed.push({ ...t, start, end });
    } else {
      flex.push({ ...t, duration_min: dur });
    }
  }
  fixed.sort((a,b)=>a.start-b.start);

  const dayStart = new Date(`${date}T09:00:00+09:00`);
  const dayEnd   = new Date(`${date}T18:00:00+09:00`);
  const lunchS   = new Date(`${date}T12:00:00+09:00`);
  const lunchE   = new Date(`${date}T13:00:00+09:00`);
  let free = [
    { start: new Date(dayStart), end: new Date(lunchS) },
    { start: new Date(lunchE), end: new Date(dayEnd) },
  ];
  for (const f of fixed) free = subtractBlock(free, f);

  const order:Record<string,number> = { email:1, message:1, schedule:2, doc:3, study:4, plan_venue:5 };
  flex.sort((a,b)=> (order[a.type]??9)-(order[b.type]??9));

  const plan:any[] = [...fixed];
  for (const t of flex) {
    const mins = t.duration_min;
    let placed = false;
    for (const slot of free) {
      const slotMin = (slot.end.getTime()-slot.start.getTime())/60000;
      if (slotMin >= mins) {
        const start = new Date(slot.start);
        const end = new Date(start.getTime()+mins*60000);
        plan.push({ ...t, start, end });
        slot.start = new Date(end);
        placed = true; break;
      }
    }
    if (!placed) plan.push({ ...t, start: null, end: null, note: '時間不足で未配置' });
  }
  plan.sort((a,b)=>{
    if (a.start && b.start) return a.start - b.start;
    if (a.start) return -1;
    if (b.start) return 1;
    return 0;
  });
  return plan;
}
function subtractBlock(free:any[], block:any) {
  const out:any[] = [];
  for (const f of free) {
    if (block.end <= f.start || block.start >= f.end) { out.push(f); continue; }
    if (block.start > f.start) out.push({ start: f.start, end: new Date(block.start) });
    if (block.end < f.end) out.push({ start: new Date(block.end), end: f.end });
  }
  return out;
}
function formatPlan(plan:any[]) {
  const pad = (n:number)=>String(n).padStart(2,'0');
  const lines = plan.map(p=>{
    if (!p.start || !p.end) return `* [未配置] ${p.title} (${p.type})`;
    const s = `${pad(p.start.getHours())}:${pad(p.start.getMinutes())}`;
    const e = `${pad(p.end.getHours())}:${pad(p.end.getMinutes())}`;
    return `* ${s} - ${e}: ${p.title} (${p.type})`;
  }).join('\n');
  const total = plan.filter(p=>p.start&&p.end).reduce((acc,p)=>acc+(p.end-p.start)/60000,0);
  return `【実行サマリ】\n${lines}\n\n合計所要時間: ${Math.round(total)}分`;
}
