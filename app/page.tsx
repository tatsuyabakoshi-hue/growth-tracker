"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { WeeklyChart } from "./components/WeeklyChart";

type Role = "self" | "admin";

type Member = {
  id: string;
  name: string;
  email: string | null;
  reminder_enabled: boolean;
  created_at: number;
};
type Goal = {
  id: string;
  content: string | null;
  status: "open" | "resolved";
  resolved_at: number | null;
  visible_to_admin: boolean;
  created_at: number;
  hidden?: boolean;
};
type ActionLog = {
  id: string;
  log_date: string;
  content: string;
  related_goal_id: string | null;
  created_at: number;
};
type Suggestion = { id: string; content: string; created_at: number };
type SuggestionMessage = { id: string; role: "user" | "assistant"; content: string; created_at: number };
type Progress = {
  streak: number;
  goals_open: number;
  goals_resolved: number;
  weekly_counts: { week_start: string; count: number }[];
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Home() {
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unlockedRoles, setUnlockedRoles] = useState<Map<string, Role>>(new Map());

  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberPassword, setNewMemberPassword] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);

  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const [goals, setGoals] = useState<Goal[]>([]);
  const [newGoal, setNewGoal] = useState("");
  const [addingGoal, setAddingGoal] = useState(false);

  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [newLogDate, setNewLogDate] = useState(today());
  const [newLogContent, setNewLogContent] = useState("");
  const [newLogGoalId, setNewLogGoalId] = useState("");
  const [addingLog, setAddingLog] = useState(false);

  const [progress, setProgress] = useState<Progress | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [expandedSuggestionId, setExpandedSuggestionId] = useState<string | null>(null);
  const [messagesBySuggestion, setMessagesBySuggestion] = useState<Record<string, SuggestionMessage[]>>({});
  const [chatInput, setChatInput] = useState("");
  const [sendingChat, setSendingChat] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const [showNotifySettings, setShowNotifySettings] = useState(false);
  const [notifyEmailDraft, setNotifyEmailDraft] = useState("");
  const [notifyReminderDraft, setNotifyReminderDraft] = useState(true);
  const [savingNotify, setSavingNotify] = useState(false);

  const [error, setError] = useState("");

  const loadMembers = useCallback(async () => {
    const res = await fetch("/api/members");
    const data = await res.json();
    const list: Member[] = data.members || [];
    setMembers(list);
    return list;
  }, []);

  const loadMemberData = useCallback(async (memberId: string, role: Role) => {
    const viewerQuery = role === "admin" ? "?viewer=admin" : "";
    const [goalsRes, logsRes, progressRes, suggestionsRes] = await Promise.all([
      fetch(`/api/members/${memberId}/goals${viewerQuery}`),
      fetch(`/api/members/${memberId}/logs`),
      fetch(`/api/members/${memberId}/progress`),
      fetch(`/api/members/${memberId}/suggestions`),
    ]);
    setGoals((await goalsRes.json()).goals || []);
    setLogs((await logsRes.json()).logs || []);
    setProgress(await progressRes.json());
    setSuggestions((await suggestionsRes.json()).suggestions || []);
    setExpandedSuggestionId(null);
    setMessagesBySuggestion({});
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    const role = selectedId ? unlockedRoles.get(selectedId) : undefined;
    if (selectedId && role) {
      loadMemberData(selectedId, role);
      const member = members.find((m) => m.id === selectedId);
      setNotifyEmailDraft(member?.email || "");
      setNotifyReminderDraft(member?.reminder_enabled ?? true);
    } else {
      setGoals([]);
      setLogs([]);
      setProgress(null);
      setSuggestions([]);
      setExpandedSuggestionId(null);
      setMessagesBySuggestion({});
    }
    setUnlockPassword("");
    setUnlockError("");
    setShowNotifySettings(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, unlockedRoles, loadMemberData]);

  function showError(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
    setTimeout(() => setError(""), 5000);
  }

  async function handleAddMember(e: FormEvent) {
    e.preventDefault();
    const name = newMemberName.trim();
    const password = newMemberPassword;
    const email = newMemberEmail.trim();
    if (!name || password.length < 4) return;
    setAddingMember(true);
    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password, email: email || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "登録に失敗しました");
      setNewMemberName("");
      setNewMemberPassword("");
      setNewMemberEmail("");
      setShowAddMember(false);
      await loadMembers();
      setUnlockedRoles((prev) => new Map(prev).set(data.id, "self"));
      setSelectedId(data.id);
    } catch (err) {
      showError(err, "登録に失敗しました");
    } finally {
      setAddingMember(false);
    }
  }

  async function handleDeleteMember(m: Member) {
    if (!window.confirm(`「${m.name}」を削除しますか？悩み事・実践ログ・提案もすべて削除されます。この操作は取り消せません。`)) {
      return;
    }
    try {
      const res = await fetch(`/api/members/${m.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "削除に失敗しました");
      }
      const list = await loadMembers();
      if (selectedId === m.id) {
        setSelectedId(list.length > 0 ? list[0].id : null);
      }
    } catch (err) {
      showError(err, "削除に失敗しました");
    }
  }

  async function handleUnlock(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setUnlocking(true);
    setUnlockError("");
    try {
      const res = await fetch(`/api/members/${selectedId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: unlockPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "パスワードが違います");
      setUnlockedRoles((prev) => new Map(prev).set(selectedId, (data.role as Role) || "self"));
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : "パスワードが違います");
    } finally {
      setUnlocking(false);
    }
  }

  const currentRole = selectedId ? unlockedRoles.get(selectedId) : undefined;

  async function handleAddGoal(e: FormEvent) {
    e.preventDefault();
    const content = newGoal.trim();
    if (!selectedId || !content || !currentRole) return;
    setAddingGoal(true);
    try {
      const res = await fetch(`/api/members/${selectedId}/goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "追加に失敗しました");
      setNewGoal("");
      await loadMemberData(selectedId, currentRole);
    } catch (err) {
      showError(err, "追加に失敗しました");
    } finally {
      setAddingGoal(false);
    }
  }

  async function handleDeleteGoal(goalId: string) {
    if (!selectedId || !currentRole) return;
    if (!window.confirm("この項目を削除しますか？")) return;
    try {
      const res = await fetch(`/api/members/${selectedId}/goals/${goalId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("削除に失敗しました");
      await loadMemberData(selectedId, currentRole);
    } catch (err) {
      showError(err, "削除に失敗しました");
    }
  }

  async function handleToggleGoalStatus(goal: Goal) {
    if (!selectedId || !currentRole) return;
    const nextStatus = goal.status === "resolved" ? "open" : "resolved";
    try {
      const res = await fetch(`/api/members/${selectedId}/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error("更新に失敗しました");
      await loadMemberData(selectedId, currentRole);
    } catch (err) {
      showError(err, "更新に失敗しました");
    }
  }

  async function handleToggleGoalVisibility(goal: Goal) {
    if (!selectedId || !currentRole) return;
    try {
      const res = await fetch(`/api/members/${selectedId}/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible_to_admin: !goal.visible_to_admin }),
      });
      if (!res.ok) throw new Error("更新に失敗しました");
      await loadMemberData(selectedId, currentRole);
    } catch (err) {
      showError(err, "更新に失敗しました");
    }
  }

  async function handleAddLog(e: FormEvent) {
    e.preventDefault();
    const content = newLogContent.trim();
    if (!selectedId || !content || !newLogDate || !currentRole) return;
    setAddingLog(true);
    try {
      const res = await fetch(`/api/members/${selectedId}/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          log_date: newLogDate,
          content,
          related_goal_id: newLogGoalId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "追加に失敗しました");
      setNewLogContent("");
      setNewLogGoalId("");
      await loadMemberData(selectedId, currentRole);
    } catch (err) {
      showError(err, "追加に失敗しました");
    } finally {
      setAddingLog(false);
    }
  }

  async function handleDeleteLog(logId: string) {
    if (!selectedId || !currentRole) return;
    if (!window.confirm("このログを削除しますか？")) return;
    try {
      const res = await fetch(`/api/members/${selectedId}/logs/${logId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("削除に失敗しました");
      await loadMemberData(selectedId, currentRole);
    } catch (err) {
      showError(err, "削除に失敗しました");
    }
  }

  async function handleSuggest() {
    if (!selectedId || !currentRole) return;
    setSuggesting(true);
    try {
      const res = await fetch(`/api/members/${selectedId}/suggest`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "提案の生成に失敗しました");
      setSuggestions((prev) => [{ id: data.id, content: data.content, created_at: data.created_at }, ...prev]);
      setExpandedSuggestionId(data.id);
    } catch (err) {
      showError(err, "提案の生成に失敗しました");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleToggleSuggestion(suggestionId: string) {
    const next = expandedSuggestionId === suggestionId ? null : suggestionId;
    setExpandedSuggestionId(next);
    if (next && !messagesBySuggestion[next]) {
      try {
        const res = await fetch(`/api/members/${selectedId}/suggestions/${next}/messages`);
        const data = await res.json();
        setMessagesBySuggestion((prev) => ({ ...prev, [next]: data.messages || [] }));
      } catch {
        setMessagesBySuggestion((prev) => ({ ...prev, [next]: [] }));
      }
    }
  }

  async function handleSendChatMessage(e: FormEvent, suggestionId: string) {
    e.preventDefault();
    const content = chatInput.trim();
    if (!selectedId || !content) return;
    const tempUserMessage: SuggestionMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content,
      created_at: Date.now(),
    };
    setMessagesBySuggestion((prev) => ({
      ...prev,
      [suggestionId]: [...(prev[suggestionId] || []), tempUserMessage],
    }));
    setChatInput("");
    setSendingChat(true);
    try {
      const res = await fetch(`/api/members/${selectedId}/suggestions/${suggestionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "送信に失敗しました");
      setMessagesBySuggestion((prev) => ({
        ...prev,
        [suggestionId]: [...(prev[suggestionId] || []), data],
      }));
    } catch (err) {
      showError(err, "送信に失敗しました");
    } finally {
      setSendingChat(false);
    }
  }

  async function handleSaveNotifySettings(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setSavingNotify(true);
    try {
      const res = await fetch(`/api/members/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: notifyEmailDraft.trim() || null,
          reminder_enabled: notifyReminderDraft,
        }),
      });
      if (!res.ok) throw new Error("保存に失敗しました");
      await loadMembers();
      setShowNotifySettings(false);
    } catch (err) {
      showError(err, "保存に失敗しました");
    } finally {
      setSavingNotify(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const selectedMember = members.find((m) => m.id === selectedId) || null;
  const isUnlocked = !!selectedId && unlockedRoles.has(selectedId);
  const goalsById = new Map(goals.map((g) => [g.id, g]));
  const openGoals = goals.filter((g) => g.status !== "resolved");
  const resolvedGoals = goals.filter((g) => g.status === "resolved");

  return (
    <div className="flex h-screen flex-1 bg-white text-slate-900">
      {/* ペイン1: 氏名一覧 */}
      <aside className="flex w-72 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50">
        <div className="border-b border-slate-200 p-4">
          <h1 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            成長トラッカー
          </h1>
          <p className="mt-1 truncate text-lg font-bold text-slate-900">
            {selectedMember ? selectedMember.name : "氏名を選択してください"}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {members.map((m) => (
            <div
              key={m.id}
              className={`mb-1 flex items-center rounded-md text-sm transition ${
                m.id === selectedId ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"
              }`}
            >
              <button onClick={() => setSelectedId(m.id)} className="flex-1 truncate px-3 py-2 text-left">
                {unlockedRoles.has(m.id) ? "" : "🔒 "}
                {m.name}
              </button>
              <button
                onClick={() => handleDeleteMember(m)}
                title="削除"
                className={`mr-1 rounded px-2 py-2 text-xs ${
                  m.id === selectedId
                    ? "text-slate-300 hover:bg-slate-800 hover:text-white"
                    : "text-slate-400 hover:bg-slate-300 hover:text-red-600"
                }`}
              >
                削除
              </button>
            </div>
          ))}
          {members.length === 0 && (
            <p className="p-2 text-sm text-slate-400">まだ誰も登録されていません</p>
          )}
        </div>
        <div className="border-t border-slate-200 p-3">
          {!showAddMember && (
            <button
              onClick={() => setShowAddMember(true)}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              + 新しい氏名を追加
            </button>
          )}
          {showAddMember && (
            <form onSubmit={handleAddMember} className="space-y-2">
              <input
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="氏名"
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
                autoFocus
              />
              <input
                type="password"
                value={newMemberPassword}
                onChange={(e) => setNewMemberPassword(e.target.value)}
                placeholder="自分専用パスワード（4文字以上）"
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
              />
              <input
                type="email"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                placeholder="メールアドレス（任意・リマインド用）"
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={addingMember || !newMemberName.trim() || newMemberPassword.length < 4}
                  className="flex-1 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  追加
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddMember(false)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  キャンセル
                </button>
              </div>
            </form>
          )}
        </div>
        <button
          onClick={handleLogout}
          className="border-t border-slate-200 p-3 text-left text-xs text-slate-400 hover:text-slate-600"
        >
          ログアウト
        </button>
      </aside>

      {/* ペイン2〜4 */}
      {!selectedMember && (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
          左の一覧から氏名を選択してください
        </div>
      )}

      {selectedMember && !isUnlocked && (
        <div className="flex flex-1 items-center justify-center">
          <form
            onSubmit={handleUnlock}
            className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
          >
            <p className="mb-1 text-sm text-slate-500">🔒 {selectedMember.name} の詳細を開く</p>
            <p className="mb-4 text-xs text-slate-400">
              悩み事・実践ログ・提案を見るには本人パスワードが必要です
            </p>
            <input
              type="password"
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              placeholder="パスワード"
              className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              autoFocus
            />
            {unlockError && <p className="mb-3 text-sm text-red-600">{unlockError}</p>}
            <button
              type="submit"
              disabled={unlocking || !unlockPassword}
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {unlocking ? "確認中..." : "開く"}
            </button>
          </form>
        </div>
      )}

      {selectedMember && isUnlocked && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* 進捗サマリー + 通知設定バー */}
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2">
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span>🔥 継続 {progress?.streak ?? 0}日</span>
              <span>
                解決済み {progress?.goals_resolved ?? 0} / {(progress?.goals_resolved ?? 0) + (progress?.goals_open ?? 0)}
              </span>
              {progress && <WeeklyChart data={progress.weekly_counts} />}
            </div>
            <button
              onClick={() => setShowNotifySettings((v) => !v)}
              className="whitespace-nowrap text-xs text-slate-500 hover:text-slate-800"
            >
              ✉ 通知設定
            </button>
          </div>
          {showNotifySettings && (
            <form
              onSubmit={handleSaveNotifySettings}
              className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs"
            >
              <input
                type="email"
                value={notifyEmailDraft}
                onChange={(e) => setNotifyEmailDraft(e.target.value)}
                placeholder="メールアドレス"
                className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
              />
              <label className="flex items-center gap-1 text-slate-600">
                <input
                  type="checkbox"
                  checked={notifyReminderDraft}
                  onChange={(e) => setNotifyReminderDraft(e.target.checked)}
                />
                実践ログが数日途絶えたらリマインドを受け取る
              </label>
              <button
                type="submit"
                disabled={savingNotify}
                className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {savingNotify ? "保存中..." : "保存"}
              </button>
            </form>
          )}

          <div className="flex flex-1 divide-x divide-slate-200 overflow-hidden">
            {/* ペイン2: 悩み事・成長したいこと */}
            <section className="flex w-1/3 flex-col overflow-hidden">
              <header className="border-b border-slate-200 p-4">
                <h2 className="text-sm font-semibold text-slate-500">悩み事・成長したいこと</h2>
              </header>
              <div className="flex-1 overflow-y-auto p-4">
                {goals.length === 0 && (
                  <p className="text-sm text-slate-400">まだ記載がありません</p>
                )}
                {openGoals.length > 0 && (
                  <ul className="space-y-2">
                    {openGoals.map((g) => (
                      <GoalItem
                        key={g.id}
                        goal={g}
                        onDelete={handleDeleteGoal}
                        onToggleStatus={handleToggleGoalStatus}
                        onToggleVisibility={handleToggleGoalVisibility}
                      />
                    ))}
                  </ul>
                )}
                {resolvedGoals.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-slate-400">
                      解決済み（{resolvedGoals.length}件）
                    </summary>
                    <ul className="mt-2 space-y-2">
                      {resolvedGoals.map((g) => (
                        <GoalItem
                          key={g.id}
                          goal={g}
                          onDelete={handleDeleteGoal}
                          onToggleStatus={handleToggleGoalStatus}
                          onToggleVisibility={handleToggleGoalVisibility}
                        />
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <form onSubmit={handleAddGoal} className="border-t border-slate-200 p-3">
                <textarea
                  value={newGoal}
                  onChange={(e) => setNewGoal(e.target.value)}
                  placeholder="悩み事・成長したいことを入力"
                  rows={3}
                  className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={addingGoal || !newGoal.trim()}
                  className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  追加
                </button>
              </form>
            </section>

            {/* ペイン3: 実践ログ */}
            <section className="flex w-1/3 flex-col overflow-hidden">
              <header className="border-b border-slate-200 p-4">
                <h2 className="text-sm font-semibold text-slate-500">試したこと・実践したこと・効果</h2>
              </header>
              <div className="flex-1 overflow-y-auto p-4">
                {logs.length === 0 && (
                  <p className="text-sm text-slate-400">まだ記録がありません</p>
                )}
                <ul className="space-y-2">
                  {logs.map((l) => {
                    const relatedGoal = l.related_goal_id ? goalsById.get(l.related_goal_id) : null;
                    return (
                      <li key={l.id} className="rounded-md border border-slate-200 p-3 text-sm">
                        <div className="mb-1 flex items-center justify-between">
                          <p className="text-xs text-slate-400">{l.log_date}</p>
                          <button
                            onClick={() => handleDeleteLog(l.id)}
                            className="text-xs text-slate-400 hover:text-red-600"
                          >
                            削除
                          </button>
                        </div>
                        <p className="whitespace-pre-wrap text-slate-800">{l.content}</p>
                        {relatedGoal && relatedGoal.content && (
                          <p className="mt-1 truncate text-xs text-slate-400">↳ {relatedGoal.content}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <form onSubmit={handleAddLog} className="border-t border-slate-200 p-3">
                <input
                  type="date"
                  value={newLogDate}
                  onChange={(e) => setNewLogDate(e.target.value)}
                  className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
                />
                {goals.length > 0 && (
                  <select
                    value={newLogGoalId}
                    onChange={(e) => setNewLogGoalId(e.target.value)}
                    className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-600 focus:border-slate-500 focus:outline-none"
                  >
                    <option value="">関連する悩み事（任意）</option>
                    {goals
                      .filter((g) => !g.hidden && g.content)
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {(g.content || "").slice(0, 40)}
                        </option>
                      ))}
                  </select>
                )}
                <textarea
                  value={newLogContent}
                  onChange={(e) => setNewLogContent(e.target.value)}
                  placeholder="試したこと・実践したこと・その効果を入力"
                  rows={3}
                  className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={addingLog || !newLogContent.trim()}
                  className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  記録に追加
                </button>
              </form>
            </section>

            {/* ペイン4: 成長パネル（AI提案履歴 + 追質問チャット） */}
            <section className="flex w-1/3 flex-col overflow-hidden">
              <header className="flex items-center justify-between border-b border-slate-200 p-4">
                <h2 className="text-sm font-semibold text-slate-500">次回アクション提案</h2>
                <button
                  onClick={handleSuggest}
                  disabled={suggesting || (goals.length === 0 && logs.length === 0)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  {suggesting ? "生成中..." : "新しい提案を生成"}
                </button>
              </header>
              <div className="flex-1 overflow-y-auto p-4">
                {suggestions.length === 0 && (
                  <p className="text-sm text-slate-400">まだ提案はありません</p>
                )}
                <ul className="space-y-2">
                  {suggestions.map((s) => {
                    const expanded = expandedSuggestionId === s.id;
                    const thread = messagesBySuggestion[s.id] || [];
                    return (
                      <li key={s.id} className="rounded-md border border-slate-200">
                        <button
                          onClick={() => handleToggleSuggestion(s.id)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-50"
                        >
                          <span>{new Date(s.created_at).toLocaleString("ja-JP")}</span>
                          <span>{expanded ? "閉じる ▲" : "開く ▼"}</span>
                        </button>
                        {expanded && (
                          <div className="border-t border-slate-200 p-3">
                            <p className="whitespace-pre-wrap text-sm text-slate-800">{s.content}</p>
                            {thread.length > 0 && (
                              <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                                {thread.map((m) => (
                                  <li
                                    key={m.id}
                                    className={`rounded-md p-2 text-xs whitespace-pre-wrap ${
                                      m.role === "user"
                                        ? "bg-slate-100 text-slate-700"
                                        : "bg-slate-900/5 text-slate-800"
                                    }`}
                                  >
                                    <span className="mb-1 block font-semibold text-slate-400">
                                      {m.role === "user" ? "あなた" : "AI"}
                                    </span>
                                    {m.content}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <form
                              onSubmit={(e) => handleSendChatMessage(e, s.id)}
                              className="mt-3 flex gap-2"
                            >
                              <input
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                placeholder="この提案について質問する"
                                className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
                              />
                              <button
                                type="submit"
                                disabled={sendingChat || !chatInput.trim()}
                                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
                              >
                                送信
                              </button>
                            </form>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-4 right-4 rounded-md bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}

function GoalItem({
  goal,
  onDelete,
  onToggleStatus,
  onToggleVisibility,
}: {
  goal: Goal;
  onDelete: (goalId: string) => void;
  onToggleStatus: (goal: Goal) => void;
  onToggleVisibility: (goal: Goal) => void;
}) {
  if (goal.hidden) {
    return (
      <li className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400">
        🔒 本人が非公開に設定した項目です
      </li>
    );
  }

  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p
          className={`whitespace-pre-wrap ${
            goal.status === "resolved" ? "text-slate-400 line-through" : "text-slate-800"
          }`}
        >
          {goal.content}
        </p>
        <button
          onClick={() => onDelete(goal.id)}
          className="shrink-0 text-xs text-slate-400 hover:text-red-600"
        >
          削除
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <button
          onClick={() => onToggleStatus(goal)}
          className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
        >
          {goal.status === "resolved" ? "未解決に戻す" : "解決済みにする"}
        </button>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={goal.visible_to_admin}
            onChange={() => onToggleVisibility(goal)}
          />
          管理者に共有する
        </label>
      </div>
    </li>
  );
}
