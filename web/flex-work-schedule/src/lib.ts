import {useEffect, useState} from 'react';

const API_BASE = window.location.pathname.startsWith('/demo') ? '/demo/api' : '/api';
const demoWindow = window as typeof window & {__DEMO_TODAY__?: string; __DEMO_NOW__?: string};
if (window.location.pathname.startsWith('/demo')) demoWindow.__DEMO_TODAY__ ??= '2042-03-04';
export const nowDate = () => demoWindow.__DEMO_NOW__ ? new Date(demoWindow.__DEMO_NOW__) : demoWindow.__DEMO_TODAY__ ? new Date(`${demoWindow.__DEMO_TODAY__}T12:00:00`) : new Date();

// ---------- API types (contract: /api/month, /api/archive — server unchanged) ----------

export type DayRow = {
  date: string; weekday?: string; day_type?: string; badge?: string;
  work_minutes?: number; recognized_minutes?: number; office_minutes?: number;
  remote_minutes?: number; unknown_minutes?: number; timeoff_minutes?: number; rest_minutes?: number; night_minutes?: number;
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
  targetReductionMinutes?: number; requiredLongDayMinutes?: number | null; requiredLongDayFeasible?: boolean; longDayRationale?: string;
};

export type TodayAction = {
  kind: string; date?: string; window?: string; decisionTitle?: string; message?: string;
  workedMinutes?: number; remainingTodayMinutes?: number; recommendedLeaveTime?: string;
  minimumTargetRemainingTodayMinutes?: number;
};

export type Capacity = {planForecastMinutes: number; maxForecastMinutes: number; shortfallMinutes: number; limits: {
  kind: 'weekly_max' | 'friday_cap' | 'daily_max' | 'date_override' | 'no_slots' | 'core_time' | 'today_anchor';
  dates: string[]; label: string;
}[]};

export type Plan = {
  status?: string; targetMinutes?: number; recognizedMinutes?: number;
  sourceRecognizedMinutes?: number; inProgressRecognizedMinutes?: number;
  remainingMinutes?: number; plannedTotalMinutes?: number; forecastMinutes?: number; gapMinutes?: number; overTargetMinutes?: number; conflictReason?: string;
  capacity?: Capacity;
  officeMinimum?: {requiredMinutes: number; currentMinutes: number; remainingMinutes: number; satisfied: boolean; projectedMinutes: number; projectedSatisfied: boolean; deferredRemoteMinutes: number; remoteCountsAfterMinimum: true} | null;
  projectedPayBasis?: 'recommendation';
  accounting?: {targetEligibleMinutes?: number; currentTargetEligibleMinutes?: number; excludedUnknownMinutes?: number; deferredRemoteMinutes?: number; currentExcludedUnknownMinutes?: number; currentDeferredRemoteMinutes?: number};
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
  capacity?: Capacity;
  summary?: {plannedDays?: number; longDays?: number; normalDays?: number; shortDays?: number; adjustDays?: number;
    averageDailyMinutes?: number};
};

export type Strategy = {
  mode?: string; title?: string; message?: string; frontLoadedLongDays?: number;
  fridayLongDays?: number; bufferDate?: string; longDays?: number; projectedExtraPayAfterTaxKrw?: number;
};

export type PlannerInsights = {
  asOf: string;
  guards: {key: string; level: 'risk' | 'breach'; weekKey?: string; date?: string; label: string; minutes: number; limitMinutes: number}[];
  leaveNow: null | {date: string; workedMinutes: number; todayRemainingMinutes: number; remainingWorkdays: number;
    averageDailyBeforeMinutes: number; averageDailyAfterMinutes: number; additionalPerDayMinutes: number; feasible: boolean; shortfallMinutes: number};
  forecast: {recognizedMinutes: number; expectedMinutes: number; minMinutes: number | null; maxMinutes: number | null; fixedConflict?: boolean; basis?: 'target_eligible' | 'ledger'};
  targets?: {key: 'base' | 'nine_hour' | 'fixed_ot' | 'max'; label: string; minutes: number; achievedPercent: number; officialPercent: number;
    requiredDailyMinutes: number; requiredFeasible: boolean; etaDate: string | null; projectedMinutes: number; projectedPercent: number; shortfallMinutes: number}[];
  pace?: {totalWorkdays: number; completedWorkdays: number; remainingWorkdays: number; expectedPercent: number};
  burnRateMinutes?: number;
};

export type MonthPayload = {
  ok: boolean; dataOrigin?: 'synthetic'; year: number; month: number; collectedAt?: string;
  derived: Record<string, number>;
  days: DayRow[];
  planner?: {
    targetOptions?: TargetOption[]; selectedTargetMinutes?: number;
    insights?: PlannerInsights | null;
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
export type PlannerPreferences = {target?: number; dailyAverageMinutes?: number; settings: WorkSettings};

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

/** Current ledger recognition never uses the plan's target-eligible accounting basis. */
export const currentRecognized = (payload: MonthPayload) => payload.truth?.current?.effectiveRecognizedMinutes
  ?? payload.planner?.insights?.forecast.recognizedMinutes ?? payload.derived.recognizedMinutes ?? 0;

export function planState(plan: Plan, payload?: MonthPayload) {
  const gap = plan.gapMinutes ?? plan.feasibility?.gapMinutes ?? 0;
  const over = plan.overTargetMinutes || 0;
  const unknown = plan.accounting?.currentExcludedUnknownMinutes ?? plan.accounting?.excludedUnknownMinutes ?? 0;
  const remote = plan.accounting?.currentDeferredRemoteMinutes ?? plan.accounting?.deferredRemoteMinutes ?? 0;
  const forecastExcluded = (plan.accounting?.excludedUnknownMinutes || 0) + (plan.accounting?.deferredRemoteMinutes || 0);
  const eligible = plan.accounting?.currentTargetEligibleMinutes;
  const possible = plan.capacity?.maxForecastMinutes ?? plan.forecastMinutes ?? ((plan.recognizedMinutes || 0) + (plan.plannedTotalMinutes || 0));
  const recommendation = plan.capacity?.planForecastMinutes ?? plan.forecastMinutes ?? possible;
  const maximumGap = plan.capacity?.shortfallMinutes ?? gap;
  const basis = [
    ...(payload ? [`현재 인정 ${fmt(currentRecognized(payload))}${eligible != null ? ` 중 목표 산입 ${fmt(eligible)}` : ''}`] : eligible != null ? [`목표 산입 ${fmt(eligible)}`] : []),
    ...(unknown > 0 ? [`미분류 ${fmt(unknown)} 제외`] : []),
    ...(remote > 0 ? [`재택 ${fmt(remote)} 보류`] : []),
  ].join(' · ');
  const reasons = plan.capacity?.limits.map(limit => limit.label).filter(Boolean).join(' · ');
  const hint = `${reasons || '제한 확인: 남은 근무일 · 주 상한 · 금요일 · 날짜 고정'}${unknown + remote > 0 ? ` · ${basis}` : ''}`;
  if (plan.status === 'infeasible_locked_target' || (plan.conflictReason && plan.status !== 'infeasible_mandatory_attendance')) return {label: '고정 충돌', warning: true, message: plan.conflictReason || (over > 0 ? `고정된 일정 때문에 목표보다 ${fmt(over)} 초과` : '고정된 일정의 조건을 확인하세요.'), hint: `날짜 고정과 오늘의 최소 근무선을 확인하세요. · ${basis}`};
  if (plan.status === 'infeasible_mandatory_attendance' || over > 0) return {label: '필수선 초과', warning: true, message: plan.conflictReason || (over > 0 ? `필수 근무선 때문에 목표보다 ${fmt(over)} 초과` : '필수 근무선의 조건을 확인하세요.'), hint: `필수 출근 최소선을 확인하세요. · ${basis}`};
  if (maximumGap > 0 && forecastExcluded >= maximumGap) return {label: '자료 확인 필요', warning: true, message: `근무 분류 확인 필요 · ${basis}`, hint: '원본 근무 분류를 확인하세요. 제외·보류 시간은 목표 산입에 포함되지 않습니다.'};
  if (gap > 0 || maximumGap > 0) {
    const message = maximumGap === 0
      ? `추천표대로면 ${fmt(recommendation)} · 목표까지 오늘 ${fmt(gap)} 추가 근무 필요 · 가능한 최대 ${fmt(possible)}`
      : possible > recommendation
        ? `추천표대로면 ${fmt(recommendation)} · 오늘 더 일하면 최대 ${fmt(possible)} · 목표 ${fmt(plan.targetMinutes)}까지 ${fmt(maximumGap)} 모자람`
        : possible < recommendation
          ? `추천표 예상 ${fmt(recommendation)} · 현재 남은 시간으로 최대 ${fmt(possible)} · 목표 ${fmt(plan.targetMinutes)}까지 ${fmt(maximumGap)} 모자람`
          : `추천표 기준 ${fmt(recommendation)} · 목표 ${fmt(plan.targetMinutes)}까지 ${fmt(maximumGap)} 모자람`;
    return {label: maximumGap > 0 ? '목표 도달 불가' : '오늘 추가 근무 필요', warning: true, message, hint,
      actionTarget: possible >= recommendation ? recommendation : undefined};
  }
  return {label: plan.status === 'satisfied' ? '충족' : '가능', warning: false, message: basis, hint: unknown + remote > 0 ? '제외·보류 시간은 목표 산입에 포함되지 않습니다.' : ''};
}
export const todayIso = () => {
  const d = nowDate();
  return new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);
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

const params = () => new URLSearchParams(window.location.search);
const PREFERENCES_KEY = 'work-schedule.preferences.v1';
const monthKey = (year: number, month: number) => `${year}-${pad(month)}`;
export const plannerPreferences = (year: number, month: number): Partial<PlannerPreferences> => {
  try {
    const all = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) || '{}');
    const value = all?.[monthKey(year, month)];
    if (!value || typeof value !== 'object') return {};
    const target = Number(value.target);
    const dailyAverageMinutes = Number(value.dailyAverageMinutes);
    const rawSettings = value.settings;
    return {
      target: Number.isFinite(target) && target > 0 ? target : undefined,
      dailyAverageMinutes: Number.isFinite(dailyAverageMinutes) && dailyAverageMinutes >= 60 && dailyAverageMinutes <= 24 * 60
        ? dailyAverageMinutes : undefined,
      settings: rawSettings && typeof rawSettings === 'object' ? clampWorkSettings(rawSettings as WorkSettings) : undefined,
    };
  } catch {
    return {};
  }
};
const numberParam = (query: URLSearchParams, key: string, fallback: number) => {
  const value = Number(query.get(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
export const numParam = (key: string, fallback: number) => numberParam(params(), key, fallback);
export const initialTarget = (year = numParam('year', nowDate().getFullYear()), month = numParam('month', nowDate().getMonth() + 1)) => {
  const value = Number(params().get('target'));
  if (Number.isFinite(value) && value > 0) return value;
  const stored = Number(plannerPreferences(year, month).target);
  return Number.isFinite(stored) && stored > 0 ? stored : undefined;
};
export const initialDailyAverage = (year = numParam('year', nowDate().getFullYear()), month = numParam('month', nowDate().getMonth() + 1)) => {
  const value = Number(params().get('daily'));
  if (Number.isFinite(value) && value >= 60 && value <= 24 * 60) return value;
  const stored = Number(plannerPreferences(year, month).dailyAverageMinutes);
  return Number.isFinite(stored) && stored >= 60 && stored <= 24 * 60 ? stored : undefined;
};
export const initialTab = () => params().get('tab') || 'today';
export const initialSelectedDate = () => params().get('selectedDate') || undefined;
export const initialWorkSettings = (year = numParam('year', nowDate().getFullYear()), month = numParam('month', nowDate().getMonth() + 1)) => {
  const query = params();
  const stored = plannerPreferences(year, month).settings;
  return clampWorkSettings({
    normalDayMinutes: numberParam(query, 'normal', stored?.normalDayMinutes || defaultWorkSettings.normalDayMinutes),
    longDayMinutes: numberParam(query, 'long', stored?.longDayMinutes || defaultWorkSettings.longDayMinutes),
    shortDayMinutes: numberParam(query, 'short', stored?.shortDayMinutes || defaultWorkSettings.shortDayMinutes),
  });
};
export const urlState = (fallbackYear: number, fallbackMonth: number) => ({
  year: numParam('year', fallbackYear), month: numParam('month', fallbackMonth), tab: initialTab(),
  target: initialTarget(), dailyAverageMinutes: initialDailyAverage(), settings: initialWorkSettings(), selectedDate: initialSelectedDate(),
});

export function syncUrl(state: {year: number; month: number; tab: string; target?: number;
  dailyAverageMinutes?: number; settings: WorkSettings; selectedDate?: string}, mode: 'push' | 'replace' = 'replace') {
  const q = new URLSearchParams({year: String(state.year), month: String(state.month), tab: state.tab});
  if (state.target) q.set('target', String(state.target));
  if (state.dailyAverageMinutes) q.set('daily', String(state.dailyAverageMinutes));
  q.set('normal', String(state.settings.normalDayMinutes));
  q.set('long', String(state.settings.longDayMinutes));
  q.set('short', String(state.settings.shortDayMinutes));
  if (state.selectedDate) q.set('selectedDate', state.selectedDate);
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', `${window.location.pathname}?${q}`);
}

export function savePlannerPreferences(year: number, month: number, preferences: PlannerPreferences) {
  try {
    const all = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) || '{}');
    all[monthKey(year, month)] = preferences;
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(all));
  } catch {
    // Storage denial must not break the planner.
  }
}

export const currentUrlState = () => urlState(nowDate().getFullYear(), nowDate().getMonth() + 1);

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
