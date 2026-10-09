"use client";

const CS_CATEGORIES = ["対応品質", "スピード", "課題発見"];

type Goal = {
  id: string;
  content: string | null;
  kind: "worry" | "goal";
  category: string | null;
  status: "open" | "resolved";
  resolved_at: number | null;
  created_at: number;
  hidden?: boolean;
};

type ActionLog = {
  id: string;
  log_date: string;
  content: string;
  category: string | null;
  confidence: number | null;
  effect: string | null;
  created_at: number;
};

type TimelineEvent = {
  key: string;
  date: string;
  kind: "goal" | "worry" | "resolved" | "log";
  text: string;
  meta?: string;
};

export function GrowthTimeline({ goals, logs }: { goals: Goal[]; logs: ActionLog[] }) {
  // カテゴリ別サマリー（件数と平均手応え）
  const byCategory = CS_CATEGORIES.map((cat) => {
    const items = logs.filter((l) => l.category === cat);
    const withScore = items.filter((l) => typeof l.confidence === "number");
    const avg =
      withScore.length > 0
        ? withScore.reduce((s, l) => s + (l.confidence as number), 0) / withScore.length
        : null;
    return { cat, count: items.length, avg };
  });
  const maxCount = Math.max(1, ...byCategory.map((c) => c.count));

  // タイムライン（悩み/目標の追加・解決、実践ログを時系列で統合）
  const events: TimelineEvent[] = [];
  for (const g of goals) {
    if (g.hidden) continue;
    events.push({
      key: `g-${g.id}`,
      date: new Date(g.created_at).toISOString().slice(0, 10),
      kind: g.kind === "goal" ? "goal" : "worry",
      text: g.content || "",
    });
    if (g.status === "resolved" && g.resolved_at) {
      events.push({
        key: `gr-${g.id}`,
        date: new Date(g.resolved_at).toISOString().slice(0, 10),
        kind: "resolved",
        text: g.content || "",
      });
    }
  }
  for (const l of logs) {
    events.push({
      key: `l-${l.id}`,
      date: l.log_date,
      kind: "log",
      text: l.content,
      meta: [l.category, l.confidence ? `手応え${l.confidence}` : ""].filter(Boolean).join(" / "),
    });
  }
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const badge: Record<TimelineEvent["kind"], { label: string; cls: string }> = {
    goal: { label: "目標", cls: "bg-blue-100 text-blue-700" },
    worry: { label: "悩み", cls: "bg-amber-100 text-amber-700" },
    resolved: { label: "解決", cls: "bg-green-100 text-green-700" },
    log: { label: "実践", cls: "bg-slate-200 text-slate-700" },
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-xs font-semibold text-slate-500">カテゴリ別の変化</h3>
        <ul className="space-y-2">
          {byCategory.map((c) => (
            <li key={c.cat} className="text-xs">
              <div className="mb-1 flex items-center justify-between text-slate-600">
                <span>{c.cat}</span>
                <span className="text-slate-400">
                  {c.count}件{c.avg !== null ? ` / 平均手応え ${c.avg.toFixed(1)}` : ""}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100">
                <div
                  className="h-2 rounded-full bg-slate-700"
                  style={{ width: `${(c.count / maxCount) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold text-slate-500">タイムライン</h3>
        {events.length === 0 && <p className="text-xs text-slate-400">まだ記録がありません</p>}
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.key} className="flex gap-2 text-xs">
              <span className={`shrink-0 rounded px-1.5 py-0.5 ${badge[e.kind].cls}`}>
                {badge[e.kind].label}
              </span>
              <span className="shrink-0 text-slate-400">{e.date}</span>
              <span className="text-slate-700">
                {e.text}
                {e.meta ? <span className="ml-1 text-slate-400">（{e.meta}）</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
