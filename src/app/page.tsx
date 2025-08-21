'use client';
import { useState } from 'react';

export default function Home() {
  const [text, setText] = useState(
`・朝9時に経費精算、30分くらい
・佐藤さんにメールの返信、問題ないと伝える
・英語学習2時間`
  );
  const [out, setOut] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string>("");

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const items = text.split('\n').map(s=>s.replace(/^・/,'').trim()).filter(Boolean);
      const res = await fetch('/api/agent', {
        method:'POST',
        headers: { 'content-type':'application/json' },
        body: JSON.stringify({ items })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'unknown error');
      setOut(json);
    } catch (e:any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  // コンポーネント内に追記
  const downloadIcs = () => {
    if (!out?.plan) return;
    const pad = (n:number)=>String(n).padStart(2,'0');
    const fmtUTC = (d: Date) => {
      const y=d.getUTCFullYear(), m=pad(d.getUTCMonth()+1), day=pad(d.getUTCDate());
      const h=pad(d.getUTCHours()), min=pad(d.getUTCMinutes()), s=pad(d.getUTCSeconds());
      return `${y}${m}${day}T${h}${min}${s}Z`;
    };
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//todo-gemini//JP'];
    out.plan.forEach((p:any, i:number) => {
      if (!p.start || !p.end) return;
      const s = new Date(p.start), e = new Date(p.end);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${i}-${s.getTime()}@todo-gemini`,
        `DTSTAMP:${fmtUTC(new Date())}`,
        `DTSTART:${fmtUTC(s)}`,
        `DTEND:${fmtUTC(e)}`,
        `SUMMARY:${p.title}`,
        `DESCRIPTION:${p.type}`,
        'END:VEVENT'
      );
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `plan-${out.date}.ics`; a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async (str: string) => {
    await navigator.clipboard.writeText(str);
    setToast("コピーしました");
    setTimeout(() => setToast(""), 1600);
  };

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">ToDo × Gemini（Web MVP）</h1>

      <textarea
        className="w-full h-48 border rounded p-3"
        value={text}
        onChange={e=>setText(e.target.value)}
        placeholder="・朝9時に経費精算、30分くらい&#10;・〇〇さんにメール..."
      />
      <button
        onClick={run}
        disabled={loading}
        className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
      >
        {loading ? '実行中…' : 'AIで計画を作る'}
      </button>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded">Error: {error}</div>}

      {out && (
        <div className="space-y-4">
          <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-3 rounded">
            {out.summary}
            <button
              onClick={downloadIcs}
              className="mt-3 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
            >
              カレンダーに入れる（.ics）
            </button>
          </pre>

          {out.results && Object.entries(out.results).map(([k, v]: any) => (
            <div key={k} className="border rounded p-3">
              <div className="font-semibold">{k}</div>

              {v.kind === 'draft' && (
                <>
                  <pre className="whitespace-pre-wrap text-sm mt-2">{v.body}</pre>
                  <button onClick={() => copy(v.body)} className="mt-2 px-3 py-1 rounded bg-gray-800 text-white">
                    本文をコピー
                  </button>
                </>
              )}

              {v.kind === 'subtasks' && (
                <>
                  <div className="text-sm text-gray-600">所要目安: {v.duration_min}分</div>
                  <ul className="list-disc ml-6 mt-2 text-sm">
                    {(v.subtasks || []).map((s: string, i: number) => <li key={i}>{s}</li>)}
                  </ul>
                </>
              )}

              {v.kind === 'venues' && (
                <div className="text-sm text-gray-600 mt-2">(会場検索は未設定のためスキップ)</div>
              )}
            </div>
          ))}
        </div>
        // JSXの末尾あたりに配置
      )}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded-lg bg-white text-black shadow">
          {toast}
        </div>
      )}
    </main>
  );
}

