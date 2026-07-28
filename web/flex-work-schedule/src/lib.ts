import {useEffect, useState} from 'react';

const API_BASE = window.location.pathname.startsWith('/demo') ? '/demo/api' : '/api';
const demoWindow = window as typeof window & {__DEMO_TODAY__?: string};
if (window.location.pathname.startsWith('/demo')) demoWindow.__DEMO_TODAY__ = '2042-03-04';
export const nowDate = () => demoWindow.__DEMO_TODAY__ ? new Date(`${demoWindow.__DEMO_TODAY__}T12:00:00`) : new Date();

// ---------- API types (contract: /api/month, /api/archive — server unchanged) ----------

export type DayRow = {
  date: string; weekday?: string; day_type?: string; badge?: string;
  work_minutes?: number; recognized_minutes?: number; office_minutes?: number;
  remote_minutes?: number; timeoff_minutes?: number; rest_minutes?: number; night_minutes?: number;
  first_start?: string; last_end?: string; intervals?: string[]; notes?: string[];
  is_ongoing?: boolean; is_on_break?: boolean;
};

export type PlannerDay = {
  date: string; weekday?: string; kind: string; window: string;
  plannedMinutes: number; plannedAdditionalMinutes?: number;
  currentWorkedMinutes?: number; timeoffMinutes?: number; isToday?: boolean; isDateOverride?: boolean;
};

export type TargetOption = {key: string; label: string; minutes: number};

export type Feasibility = {
  status?: string; possibleTargetMinutes?: number; gapMinutes?: number;
  targetReductionMinutes?: number; requiredLongDayMinutes?: number; requiredLongDayFeasible?: boolean;
};

export type TodayAction = {
  kind: string; date?: string; window?: string; decisionTitle?: string; message?: string;
  workedMinutes?: number; remainingTodayMinutes?: number; recommendedLeaveTime?: string;
  minimumTargetRemainingTodayMinutes?: number;
};

export type Plan = {
  status?: string; targetMinutes?: number; recognizedMinutes?: number;
  sourceRecognizedMinutes?: number; inProgressRecognizedMinutes?: number;
  remainingMinutes?: number; plannedTotalMinutes?: number; gapMinutes?: number;
  projectedOverFixedMinutes?: number; projectedExtraPayPreTaxKrw?: number; projectedExtraPayAfterTaxKrw?: number;
  summary?: {plannedDays?: number; longDays?: number; normalDays?: number; shortDays?: number; adjustDays?: number;
    averageDailyMinutes?: number; weekly?: WeeklyLoad[]};
  days?: PlannerDay[]; feasibility?: Feasibility; todayAction?: TodayAction;
};

export type WeeklyLoad = {
  key: string; label: string; plannedAdditionalMinutes?: number; plannedMinutes?: number;
  actualMinutes?: number; projectedActualMinutes?: number; weeklyMaxMinutes?: number;
  remainingToWeeklyMaxMinutes?: number;
  longDays?: number; normalDays?: number; shortDays?: number; adjustDays?: number;
  todayIncluded?: boolean; fridayNormal?: boolean; dates?: string[];
};

export type Comparison = {
  key: string; label: string; targetMinutes: number; selected?: boolean; status?: string;
  remainingMinutes?: number; gapMinutes?: number; effortLabel?: string; effortMessage?: string;
  projectedExtraPayAfterTaxKrw?: number; feasibility?: Feasibility;
  summary?: {plannedDays?: number; longDays?: number; normalDays?: number; shortDays?: number; adjustDays?: number;
    averageDailyMinutes?: number};
};

export type Strategy = {
  mode?: string; title?: string; message?: string; frontLoadedLongDays?: number;
  fridayLongDays?: number; bufferDate?: string; longDays?: number; projectedExtraPayAfterTaxKrw?: number;
};

export type MonthPayload = {
  ok: boolean; dataOrigin?: 'synthetic'; year: number; month: number; collectedAt?: string;
  derived: Record<string, number>;
  days: DayRow[];
  planner?: {
    targetOptions?: TargetOption[]; selectedTargetMinutes?: number;
    settings?: WorkSettings; comparisons?: Comparison[]; strategy?: Strategy; plan?: Plan;
  };
  ui?: {readOnly?: boolean; archiveMode?: boolean; targetConfiguration?: {enabled?: boolean}};
  sync?: {lastSyncAt?: string; ageMinutes?: number; stale?: boolean; lastError?: string | null};
  truth?: {current?: {
    sourceActualMinutes: number; inProgressActualMinutes: number; effectiveActualMinutes: number;
    sourceRecognizedMinutes: number; effectiveRecognizedMinutes: number;
    remainingToSelectedTargetMinutes: number; selectedTargetMinutes: number;
    officialAsOf?: string; isOngoing: boolean; isOnBreak: boolean;
  }};
  notifications?: {items?: {topicTitle?: string; latestText?: string; createdAt?: string}[]};
};

export type ArchiveMonth = {key: string; year: number; month: number; collectedAt?: string;
  targetMinutes?: number; recognizedMinutes?: number};
export type ArchivePayload = {months?: ArchiveMonth[]};

export type WorkSettings = {normalDayMinutes: number; longDayMinutes: number; shortDayMinutes: number};

/** 모든 탭 컴포넌트가 받는 공통 props (main.tsx tabProps). */
export type TabProps = {
  payload: MonthPayload | null;
  loading: boolean;
  archive: ArchivePayload;
  selected: number;
  setTarget: (n: number) => void;
  archiveMode: boolean;
  settings: WorkSettings;
  setSettings: (s: WorkSettings) => void;
  selectedDate?: string;
  setSelectedDate: (d?: string) => void;
  year: number;
  month: number;
  onSelectMonth: (y: number, m: number) => void;
};

// ---------- formatting ----------

export const pad = (n: number) => String(n).padStart(2, '0');
export const fmt = (m?: number) => {
  const v = Math.round(Number(m || 0));
  const s = v < 0 ? '-' : '';
  const a = Math.abs(v);
  return `${s}${Math.floor(a / 60)}:${pad(a % 60)}`;
};
export const krw = (n?: number) => Math.round(Number(n || 0)).toLocaleString('ko-KR');
export const todayIso = () => {
  const d = nowDate();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const kindLabel = (kind?: string) =>
  ({long: '긴 날', normal: '보통', short: '단축', adjust: '조정'} as Record<string, string>)[String(kind || '')] || String(kind || '');
export const dayTypeLabel = (type?: string) =>
  ({workday: '근무일', weekend: '주말', holiday: '휴일', REST_DAY: '휴무', WEEKLY_HOLIDAY: '주휴일', CUSTOM_HOLIDAY: '휴일'} as Record<string, string>)[String(type || '')] || String(type || '');

// ---------- work settings ----------

export const defaultWorkSettings: WorkSettings = {normalDayMinutes: 8 * 60 + 20, longDayMinutes: 11 * 60 + 59, shortDayMinutes: 4 * 60 + 45};

export const clampWorkSettings = (s: WorkSettings): WorkSettings => {
  const normal = Math.max(defaultWorkSettings.shortDayMinutes, Math.min(719, Number(s.normalDayMinutes) || defaultWorkSettings.normalDayMinutes));
  const longDay = Math.max(normal, Math.min(719, Number(s.longDayMinutes) || defaultWorkSettings.longDayMinutes));
  const short = Math.max(defaultWorkSettings.shortDayMinutes, Math.min(normal, Number(s.shortDayMinutes) || defaultWorkSettings.shortDayMinutes));
  return {normalDayMinutes: normal, longDayMinutes: longDay, shortDayMinutes: short};
};

// ---------- URL state (backward-compatible params) ----------

const initialParams = new URLSearchParams(window.location.search);
export const numParam = (key: string, fallback: number) => {
  const v = Number(initialParams.get(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
export const initialTarget = () => {
  const v = Number(initialParams.get('target'));
  return Number.isFinite(v) && v > 0 ? v : undefined;
};
export const initialTab = () => initialParams.get('tab') || 'today';
export const initialSelectedDate = () => initialParams.get('selectedDate') || undefined;
export const initialWorkSettings = () => clampWorkSettings({
  normalDayMinutes: numParam('normal', defaultWorkSettings.normalDayMinutes),
  longDayMinutes: numParam('long', defaultWorkSettings.longDayMinutes),
  shortDayMinutes: numParam('short', defaultWorkSettings.shortDayMinutes),
});

export function syncUrl(state: {year: number; month: number; tab: string; target?: number;
  settings: WorkSettings; selectedDate?: string}, mode: 'push' | 'replace' = 'replace') {
  const q = new URLSearchParams({year: String(state.year), month: String(state.month), tab: state.tab});
  if (state.target) q.set('target', String(state.target));
  q.set('normal', String(state.settings.normalDayMinutes));
  q.set('long', String(state.settings.longDayMinutes));
  q.set('short', String(state.settings.shortDayMinutes));
  if (state.selectedDate) q.set('selectedDate', state.selectedDate);
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', `${window.location.pathname}?${q}`);
}

export const currentUrlState = () => {
  const params = new URLSearchParams(window.location.search);
  const number = (key: string, fallback: number) => {
    const value = Number(params.get(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    year: number('year', nowDate().getFullYear()),
    month: number('month', nowDate().getMonth() + 1),
    tab: params.get('tab') || 'today',
    target: (() => { const value = Number(params.get('target')); return Number.isFinite(value) && value > 0 ? value : undefined; })(),
    settings: clampWorkSettings({
      normalDayMinutes: number('normal', defaultWorkSettings.normalDayMinutes),
      longDayMinutes: number('long', defaultWorkSettings.longDayMinutes),
      shortDayMinutes: number('short', defaultWorkSettings.shortDayMinutes),
    }),
    selectedDate: params.get('selectedDate') || undefined,
  };
}

// ---------- data hooks ----------

export function useMonthData(year: number, month: number, target: number | undefined, settings: WorkSettings) {
  const [loaded, setLoaded] = useState<{scope: string; payload: MonthPayload} | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const scope = `${year}-${month}`;
  const payload = loaded?.scope === scope ? loaded.payload : null;
  const now = nowDate();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const q = new URLSearchParams({year: String(year), month: String(month)});
    if (isCurrentMonth && target) q.set('target', String(target));
    if (isCurrentMonth) {
      q.set('normal', String(settings.normalDayMinutes));
      q.set('long', String(settings.longDayMinutes));
      q.set('short', String(settings.shortDayMinutes));
    }
    setLoading(true);
    setError(null);
    const request = fetch(`${API_BASE}/month?${q}`, {cache: 'no-store', signal: controller.signal}).then(async r => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j as MonthPayload;
    });
    request.then(j => {
      if (!cancelled) setLoaded({scope, payload: j});
    }).catch(e => {
      if (!cancelled && e?.name !== 'AbortError') setError(String(e.message || e));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [year, month, target, settings.normalDayMinutes, settings.longDayMinutes, settings.shortDayMinutes, refreshKey]);
  useEffect(() => {
    if (!isCurrentMonth) return;
    const refresh = () => setRefreshKey(v => v + 1);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(refresh, 5 * 60_000);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [isCurrentMonth]);
  return {payload, loading, error, isCurrentMonth, retry: () => setRefreshKey(v => v + 1)};
}

export function useArchive() {
  const [archive, setArchive] = useState<ArchivePayload>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(`${API_BASE}/archive`, {cache: 'no-store'}).then(async r => {
      const json = await r.json();
      if (!r.ok || json.ok === false) throw new Error(json.error || `HTTP ${r.status}`);
      return json as ArchivePayload;
    }).then(json => { if (!cancelled) setArchive(json); })
      .catch(e => { if (!cancelled) setError(String(e.message || e)); });
    return () => { cancelled = true; };
  }, [refreshKey]);
  return {archive, error, retry: () => setRefreshKey(v => v + 1)};
}

/** Re-render every minute so "N분 전"/추정치가 흐른다. */
export function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(nowDate);
  useEffect(() => {
    const id = window.setInterval(() => setNow(nowDate()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 수집 이후 경과분 (공식 수집값과 구분되는 로컬 추정의 근거). */
export function elapsedSinceSync(payload: MonthPayload | null, now: Date): number {
  const at = payload?.sync?.lastSyncAt ? new Date(payload.sync.lastSyncAt) : null;
  return at && Number.isFinite(at.getTime()) ? Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60000)) : 0;
}
