import './calendar.css';
import React, {useEffect, useState} from 'react';
import {DayRow, MonthPayload, PlannerDay, TabProps, dayTypeLabel, fmt, kindLabel, nowDate, pad, todayIso} from '../lib';
import {Card, Chip, Skel} from '../ui';

const MAX_DAY = 719; // 11:59 — 히트맵/채움 스케일 (comp 기준)
const DOW = ['월', '화', '수', '목', '금', '토', '일'];

type CellInfo = {
  iso: string; label: string; inMonth: boolean;
  row?: DayRow; plan?: PlannerDay;
  state: 'out' | 'done' | 'plan' | 'we' | 'empty';
};

const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const kindVar = (kind?: string) => ({['--cal-k']: `var(--kind-${kind}, var(--mut))`} as React.CSSProperties);
// 아카이브 payload는 recognized_minutes가 없다 — Record.tsx:9와 동일 폴백
const recMin = (d: DayRow) => d.recognized_minutes ?? (d.work_minutes || 0) + (d.timeoff_minutes || 0);
// badge/day_type은 'REST_DAY, CUSTOM_HOLIDAY' 같은 콤마 목록일 수 있다
const typeLabels = (s?: string) => String(s || '').split(',').map(t => dayTypeLabel(t.trim())).filter(Boolean);

export function CalendarTab(props: TabProps) {
  const {payload, loading, selected, settings, selectedDate, setSelectedDate, year, month} = props;
  const today = todayIso();
  const detailRef = React.useRef<HTMLDivElement>(null);
  const [durationHours, setDurationHours] = useState(8);
  const [durationRemainder, setDurationRemainder] = useState(20);
  const [editMode, setEditMode] = useState<'duration' | 'window'>('duration');
  const [startTime, setStartTime] = useState('06:40');
  const [endTime, setEndTime] = useState('16:00');
  const [breakMinutes, setBreakMinutes] = useState(60);
  const [locked, setLocked] = useState(true);
  const [previewedMinutes, setPreviewedMinutes] = useState<number>();
  const [overrideState, setOverrideState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [overrideMessage, setOverrideMessage] = useState('');
  const [previewPayload, setPreviewPayload] = useState<MonthPayload | null>(null);
  const [previewResult, setPreviewResult] = useState<{selectedLocked?: boolean; adjustments?: {date: string; beforeMinutes: number; afterMinutes: number}[]; targetMinutes?: number; plannedTotalMinutes?: number; gapMinutes?: number; overTargetMinutes?: number; reason?: string | null} | null>(null);
  const [previewToken, setPreviewToken] = useState('');
  useEffect(() => { setPreviewedMinutes(undefined); setPreviewToken(''); setPreviewResult(null); setOverrideState('idle'); setOverrideMessage(''); }, [selectedDate]);
  useEffect(() => { setPreviewPayload(null); setPreviewResult(null); }, [payload]);
  const displayedPayload = previewPayload || payload;
  React.useEffect(() => {
    // 모바일: 그리드 아래 상세로 스크롤. 데스크톱 sticky는 이미 뷰포트 안 → no-op
    if (selectedDate) detailRef.current?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  }, [selectedDate]);

  if (!displayedPayload) {
    return (
      <div className="cal-tab">
        <div className="cal-main">
          <Card>
            <div className="cal-card__b">
              <div className="cal-grid">
                {Array.from({length: 40}, (_, i) => <Skel key={i} className="cal-skel" />)}
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const rows = new Map<string, DayRow>((displayedPayload.days || []).map(d => [d.date, d]));
  const plans = new Map<string, PlannerDay>((displayedPayload.planner?.plan?.days || []).map(d => [d.date, d]));

  // 월 그리드 (월요일 시작, 앞뒤는 타월 자리)
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const count = Math.ceil((lead + new Date(year, month, 0).getDate()) / 7) * 7;
  const cells: CellInfo[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(year, month - 1, i - lead + 1);
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const inMonth = d.getMonth() === month - 1;
    const row = rows.get(iso);
    const plan = plans.get(iso);
    let state: CellInfo['state'] = 'empty';
    if (!inMonth) state = 'out';
    else if (row && recMin(row) > 0) state = 'done';
    else if (plan && iso >= today) state = 'plan';
    else if (row && row.day_type && row.day_type !== 'workday') state = 'we';
    else if (row) state = 'done'; // 과거 근무일 0:00
    else if (d.getDay() === 0 || d.getDay() === 6) state = 'we';
    cells.push({iso, label: inMonth ? String(d.getDate()) : `${d.getMonth() + 1}/${d.getDate()}`, inMonth, row, plan, state});
  }
  const weeks: CellInfo[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const planResult = displayedPayload.planner?.plan;
  const actualTotal = cells.reduce((s, c) => s + (c.inMonth && c.row ? Number(c.row.work_minutes || 0) : 0), 0);
  const confTotal = cells.reduce((s, c) => s + (c.inMonth && c.row ? recMin(c.row) : 0), 0);
  const planTotal = Number(planResult?.plannedTotalMinutes || 0);
  const recognizedTotal = Number(planResult?.recognizedMinutes ?? confTotal);
  const remainingTotal = Number(planResult?.remainingMinutes || 0);
  const forecastTotal = recognizedTotal + planTotal;
  const nextPlan = (displayedPayload.planner?.plan?.days || []).find(p => p.date > today && (p.plannedMinutes || 0) > 0);

  const renderCell = (c: CellInfo) => {
    if (c.state === 'out') {
      return <div key={c.iso} className="cal-cell cal-cell--out"><span className="cal-cell__d mono">{c.label}</span></div>;
    }
    const isToday = c.iso === today;
    const isSel = c.iso === selectedDate;
    const clickable = Boolean(c.row || c.plan);
    const rec = c.row ? recMin(c.row) : 0;
    const hybrid = Boolean(isToday && c.row && c.plan && rec > 0);
    const ratio = Math.min(1, rec / MAX_DAY);
    const cls = ['cal-cell',
      c.state === 'we' ? 'cal-cell--we' : '',
      c.state === 'plan' ? 'cal-cell--plan' : '',
      hybrid ? 'cal-cell--hybrid' : '',
      isToday ? 'cal-cell--today' : '',
      isSel ? 'cal-cell--selected' : '',
    ].filter(Boolean).join(' ');
    let style: React.CSSProperties | undefined;
    if (c.state === 'plan' || hybrid) style = kindVar(c.plan?.kind);
    else if (c.state === 'done' && ratio > 0 && !isSel) {
      // 확정 heatmap: 인정 시간 비례 그린 알파
      style = {background: `color-mix(in srgb, var(--green) ${(4 + ratio * 10).toFixed(1)}%, var(--surface))`};
    }
    const offLabel = c.row && (c.state === 'we'
      ? typeLabels(c.row.badge || c.row.day_type)[0]
      : (c.row.badge ? typeLabels(c.row.badge)[0] : ''));
    return (
      <button key={c.iso} type="button" data-date={c.iso} className={cls} style={style} disabled={!clickable}
        aria-pressed={isSel}
        onClick={() => setSelectedDate(isSel ? undefined : c.iso)}>
        <span className="cal-cell__d mono">{c.label}</span>
        {isToday && <span className="cal-cell__td mono">오늘</span>}
        {(c.row?.timeoff_minutes || 0) > 0 && (
          <span className="cal-vchip mono"><span className="cal-vchip__t">휴가 {fmt(c.row!.timeoff_minutes)}</span></span>
        )}
        {c.state === 'plan' && <span className="cal-kind">{c.plan?.isDateOverride ? '16시 고정' : kindLabel(c.plan?.kind)}</span>}
        {hybrid && <span className="cal-kind">진행 중 · {kindLabel(c.plan?.kind)}</span>}
        {offLabel ? <span className="cal-cell__off mono">{offLabel}</span> : null}
        {hybrid ? (
          <span className="cal-cell__hybrid mono">
            <span><i data-short="실">실적</i>{' '}<b>{fmt(c.row?.work_minutes)}</b></span>
            <span><i data-short="남">남은</i>{' '}<b>+{fmt(c.plan?.plannedAdditionalMinutes)}</b></span>
            <span><i data-short="예">예상</i>{' '}<b>{fmt(c.plan?.plannedMinutes)}</b></span>
          </span>
        ) : c.state === 'done' && (
          <>
            <span className={`cal-cell__v mono ${rec > 0 ? '' : 'is-zero'}`}>{fmt(rec)}</span>
            <span className="cal-fill"><i style={{width: `${(ratio * 100).toFixed(1)}%`}} /></span>
          </>
        )}
        {c.state === 'plan' && <span className="cal-cell__v mono">{fmt(c.plan?.plannedMinutes)}</span>}
      </button>
    );
  };

  const renderWsum = (week: CellInfo[], i: number) => {
    const actual = week.reduce((s, c) => s + (c.inMonth && c.row ? Number(c.row.work_minutes || 0) : 0), 0);
    const plan = week.reduce((s, c) => s + (c.inMonth && c.plan ? Number(c.plan.plannedAdditionalMinutes || 0) : 0), 0);
    const forecast = actual + plan;
    return (
      <div key={`w${i}`} className="cal-wsum">
        {actual > 0 && <span className="cal-wsum__wk">실근무</span>}
        {actual > 0 && <span className="cal-wsum__wv mono" data-short="실">{fmt(actual)}</span>}
        {plan > 0 && <span className="cal-wsum__wk">계획</span>}
        {plan > 0 && <span className="cal-wsum__wv mono" data-short="계">{fmt(plan)}</span>}
        {forecast > 0 && <span className="cal-wsum__forecast mono">예상 {fmt(forecast)}</span>}
        {actual === 0 && plan === 0 && <span className="cal-wsum__wk">—</span>}
      </div>
    );
  };

  // 상세 패널
  const selRow = selectedDate ? rows.get(selectedDate) : undefined;
  const selPlan = selectedDate ? plans.get(selectedDate) : undefined;
  const detailHybrid = Boolean(selectedDate === today && selRow && selPlan && recMin(selRow) > 0);
  const detailDone = Boolean(selRow && recMin(selRow) > 0);
  const overrideEditable = Boolean(selectedDate && selectedDate > today && year === nowDate().getFullYear() && month === nowDate().getMonth() + 1 && selRow && selRow.day_type === 'workday' && !(selRow.timeoff_minutes || 0));
  const editorPlan: PlannerDay | undefined = selPlan || (overrideEditable ? {date: selectedDate!, weekday: selRow?.weekday, kind: 'normal', window: '06:40–16:00', plannedMinutes: settings.normalDayMinutes, plannedAdditionalMinutes: settings.normalDayMinutes} : undefined);
  const clock = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const windowMinutes = Math.max(0, clock(endTime) - clock(startTime) - breakMinutes);
  const editingMinutes = editMode === 'window' ? windowMinutes : durationHours * 60 + durationRemainder;
  const validWindow = editMode !== 'window' || editingMinutes === 0 || (editingMinutes >= 285 && editingMinutes <= 719 && clock(startTime) <= 11 * 60 && clock(endTime) >= 16 * 60);
  const validOverride = (editingMinutes === 0 || (editingMinutes >= 285 && editingMinutes <= 719)) && validWindow && (locked || editingMinutes > 0);
  const choosePreset = (minutes: number, start: string, end: string, rest: number) => { setDurationHours(Math.floor(minutes / 60)); setDurationRemainder(minutes % 60); setStartTime(start); setEndTime(end); setBreakMinutes(rest); if (minutes === 0) setLocked(true); setPreviewedMinutes(undefined); };
  const overrideRequest = async (action: 'preview' | 'save' | 'reset') => {
    if (!selectedDate) return;
    setOverrideState('loading');
    setOverrideMessage('');
    try {
      const base = window.location.pathname.startsWith('/demo') ? '/demo/api/planner/overrides' : '/api/planner/overrides';
      const path = action === 'preview' ? `${base}/preview` : base;
      const response = await fetch(path, {
        method: action === 'reset' ? 'DELETE' : 'POST', cache: 'no-store',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({date: selectedDate, target: selected, normal: settings.normalDayMinutes, long: settings.longDayMinutes, short: settings.shortDayMinutes,
          ...(action === 'reset' ? {} : {minutes: editingMinutes, locked, ...(editMode === 'window' && editingMinutes > 0 ? {window: {start: startTime, end: endTime, breakMinutes}} : {})}), ...(action === 'save' ? {previewToken} : {})}),
      });
      const body = await response.json();
      if (!response.ok || !body.ok || !body.preview) throw new Error(body.error || `HTTP ${response.status}`);
      setPreviewPayload(body.preview);
      setPreviewResult({selectedLocked: body.selectedLocked, adjustments: body.adjustments, targetMinutes: body.targetMinutes, plannedTotalMinutes: body.plannedTotalMinutes, gapMinutes: body.gapMinutes, overTargetMinutes: body.overTargetMinutes, reason: body.reason});
      setPreviewToken(action === 'preview' ? String(body.previewToken || '') : '');
      setPreviewedMinutes(action === 'preview' ? editingMinutes : undefined);
      setOverrideState('success');
      const incomplete = Number(body.gapMinutes || 0) > 0;
      setOverrideMessage(incomplete ? `미리보기 결과: 목표 미달 ${fmt(Number(body.gapMinutes))} · ${body.reason || '제약 확인 필요'}` : action === 'preview' ? '미리보기 완료 · 저장 전까지 Flex에는 기록되지 않습니다.' : action === 'save' ? '로컬 계획을 저장했습니다. Flex에는 기록되지 않습니다.' : '이 날짜만 기본 계획으로 되돌렸습니다.');
    } catch (error) {
      setOverrideState('error');
      setOverrideMessage(String(error instanceof Error ? error.message : error));
    }
  };
  const kv = (k: string, v: React.ReactNode, zero = false, dot = false) => (
    <div className="cal-kv__row">
      {dot && <span className="cal-kv__dot" />}
      <span className="cal-kv__k">{k}</span>
      <span className={`cal-kv__v mono ${zero ? 'is-zero' : ''}`}>{v}</span>
    </div>
  );

  const renderDetail = () => {
    if (!selectedDate || (!selRow && !editorPlan)) return null;
    const weekday = selRow?.weekday || selPlan?.weekday || '';
    const rec = selRow ? recMin(selRow) : 0;
    const delta = rec - MAX_DAY;
    return (
      <div className="cal-detail" ref={detailRef}>
        <Card>
          <div className="cal-card__h">
            <span className="cal-card__t">{md(selectedDate)} {weekday} · 상세</span>
            <span className="cal-card__sum">
              {detailHybrid ? <Chip className="chip--indigo">진행 중</Chip> : detailDone ? <Chip className="chip--ok">확정</Chip> : <Chip className="chip--indigo">계획</Chip>}
              <button className="cal-detail__close" onClick={() => setSelectedDate(undefined)} aria-label="상세 닫기">×</button>
            </span>
          </div>
          <div className="cal-card__b">
            {detailDone && selRow ? (
              <>
                <div className="cal-hero">
                  <span className="cal-hero__k">{detailHybrid ? '현재 인정' : '인정'}</span>
                  <span className="cal-hero__h mono">{fmt(rec)}</span>
                  {detailHybrid && selPlan ? (
                    <span className="cal-hero__delta mono is-ok">예상 {fmt(selPlan.plannedMinutes)}</span>
                  ) : rec > 0 && (
                    <span className={`cal-hero__delta mono ${delta >= 0 ? 'is-ok' : ''}`}>
                      {delta > 0 ? '+' : ''}{fmt(delta)} <span className="cal-hero__base">/ 11:59 기준</span>
                    </span>
                  )}
                </div>
                {detailHybrid && selPlan && (
                  <>
                    <div className="cal-progress mono">
                      <span><i>실적</i><b>{fmt(selRow.work_minutes)}</b></span>
                      <span><i>남은 계획</i><b>+{fmt(selPlan.plannedAdditionalMinutes)}</b></span>
                      <span><i>예상 합계</i><b>{fmt(selPlan.plannedMinutes)}</b></span>
                    </div>
                    <div className="cal-kv">
                      {kv('권장 시간대', ` ${selPlan.window}`)}
                      {kv('권장 퇴근', ` ${selPlan.window.split('–').slice(-1)[0] || selPlan.window}`)}
                    </div>
                  </>
                )}
                <div className="cal-kv">
                  {kv('구분', typeLabels(selRow.badge || selRow.day_type).join(' · '))}
                  {kv('실근무', fmt(selRow.work_minutes), !(selRow.work_minutes))}
                  {kv('사무실', fmt(selRow.office_minutes), !(selRow.office_minutes))}
                  {kv('재택', fmt(selRow.remote_minutes), !(selRow.remote_minutes))}
                  {kv('휴게', fmt(selRow.rest_minutes), !(selRow.rest_minutes))}
                  {kv('야간', fmt(selRow.night_minutes), !(selRow.night_minutes))}
                  {(selRow.timeoff_minutes || 0) > 0 && kv('휴가', fmt(selRow.timeoff_minutes), false, true)}
                  {selRow.first_start && kv('출퇴근', `${selRow.first_start} – ${selRow.last_end}`)}
                </div>
                {(selRow.intervals?.length || 0) > 0 && (
                  <div className="cal-blocks">
                    <div className="cal-blocks__label mono">원본 블록 · {selRow.intervals!.length}건</div>
                    {selRow.intervals!.map((s, i) => <div key={i} className="cal-bl mono">{s}</div>)}
                  </div>
                )}
                {(selRow.notes?.length || 0) > 0 && (
                  <div className="cal-blocks">
                    <div className="cal-blocks__label mono">메모 · {selRow.notes!.length}건</div>
                    {selRow.notes!.map((s, i) => <div key={i} className="cal-bl">{s}</div>)}
                  </div>
                )}
                <div className="cal-detail__foot">
                  {detailHybrid ? '진행 중 수집값과 남은 계획을 함께 표시합니다.' : '서버 수집값 기준 확정 기록입니다.'}<br />수정은 사내 근태 시스템에서만 가능합니다.
                </div>
              </>
            ) : editorPlan ? (
              <>
                <div className="cal-hero">
                  <span className="cal-hero__k">계획</span>
                  <span className="cal-hero__h mono">{fmt(editorPlan.plannedMinutes)}</span>
                </div>
                <div className="cal-kv">
                  <div className="cal-kv__row">
                    <span className="cal-kv__k">종류</span>
                    <span className="cal-kv__v"><span className={`kind-tag kind-tag--${editorPlan.kind}`}>{editorPlan.isDateOverride ? '16시 퇴근 고정' : kindLabel(editorPlan.kind)}</span></span>
                  </div>
                  {kv('시간대', editorPlan.window)}
                  {kv('계획', fmt(editorPlan.plannedMinutes))}
                  {editorPlan.plannedAdditionalMinutes != null && kv('추가 인정', fmt(editorPlan.plannedAdditionalMinutes))}
                  {(editorPlan.timeoffMinutes || 0) > 0 && kv('휴가', fmt(editorPlan.timeoffMinutes), false, true)}
                </div>
                {overrideEditable && (
                  <section className="cal-override" aria-label="날짜 계획 편집">
                    <b>이 날짜만 로컬 계획 편집</b><span>Flex 실근무·휴가 기록은 변경하지 않습니다.</span>
                    <div className="cal-override__choices">
                      {[[500, '기본 500', '06:40', '16:00', 60], [719, '긴 날 719', '06:40', '19:40', 61], [285, '단축 285', '10:45', '16:00', 30], [0, '휴무 0', '06:40', '06:40', 0]].map(([minutes, label, start, end, rest]) => (
                        <button key={String(minutes)} type="button" aria-label={String(label)} className={editingMinutes === minutes ? 'is-selected' : ''}
                          onClick={() => choosePreset(Number(minutes), String(start), String(end), Number(rest))}>{label}</button>
                      ))}
                    </div>
                    <div className="cal-override__choices" role="group" aria-label="계획 입력 방식">
                      <button type="button" className={editMode === 'duration' ? 'is-selected' : ''} onClick={() => { setEditMode('duration'); setPreviewedMinutes(undefined); }}>시간·분</button>
                      <button type="button" className={editMode === 'window' ? 'is-selected' : ''} onClick={() => { setEditMode('window'); setPreviewedMinutes(undefined); }}>출퇴근·휴게</button>
                    </div>
                    <div className="cal-override__choices" role="group" aria-label="계획 고정 방식">
                      <button type="button" aria-pressed={locked} style={{minHeight: 44}} className={locked ? 'is-selected' : ''} onClick={() => { setLocked(true); setPreviewedMinutes(undefined); }}>이 날짜 고정</button>
                      <button type="button" aria-pressed={!locked} style={{minHeight: 44}} className={!locked ? 'is-selected' : ''} onClick={() => { if (editingMinutes > 0) setLocked(false); setPreviewedMinutes(undefined); }}>목표 맞추기에 사용</button>
                    </div>
                    {editMode === 'duration' ? (
                      <div className="cal-override__choices">
                        <label>시간 <input aria-label="시간" type="number" min="0" max="11" value={durationHours} onChange={event => { setDurationHours(Number(event.target.value)); setPreviewedMinutes(undefined); }} /></label>
                        <label>분 <input aria-label="분" type="number" min="0" max="59" value={durationRemainder} onChange={event => { setDurationRemainder(Number(event.target.value)); setPreviewedMinutes(undefined); }} /></label>
                      </div>
                    ) : (
                      <div className="cal-override__choices">
                        <label>출근 <input aria-label="출근" type="time" value={startTime} onChange={event => { setStartTime(event.target.value); setPreviewedMinutes(undefined); }} /></label>
                        <label>퇴근 <input aria-label="퇴근" type="time" value={endTime} onChange={event => { setEndTime(event.target.value); setPreviewedMinutes(undefined); }} /></label>
                        <label>휴게(분) <input aria-label="휴게 분" type="number" min="0" max="180" value={breakMinutes} onChange={event => { setBreakMinutes(Number(event.target.value)); setPreviewedMinutes(undefined); }} /></label>
                      </div>
                    )}
                    <div className="cal-override__summary mono">계산 {fmt(editingMinutes)} · {locked ? '이 날짜 고정' : '이전/선호값: 목표 맞추기에 사용 (최종 배정 보장 안 함)'}{editMode === 'window' && ` · ${startTime}–${endTime} · 휴게 ${breakMinutes}분`}</div>
                    {editingMinutes === 0 && !locked && <span className="is-error" role="alert">휴무 0은 고정만 가능합니다.</span>}
                    {previewResult && <div className="cal-override__summary mono" aria-live="polite">고정 상태 {previewResult.selectedLocked ? '고정' : '목표 맞추기'} · 목표 {fmt(previewResult.targetMinutes)} · 계획 {fmt(previewResult.plannedTotalMinutes)} · 갭 {fmt(previewResult.gapMinutes)}{previewResult.reason && ` · ${previewResult.reason}`}{(previewResult.adjustments || []).map(item => <span key={item.date}><br />{md(item.date)} {fmt(item.beforeMinutes)} → {fmt(item.afterMinutes)}</span>)}</div>}
                    {!validOverride && <span className="is-error" role="alert">휴무(0)는 고정만 가능하며, 근무는 4:45–11:59, 출근 11:00 이전·퇴근 16:00 이후여야 합니다.</span>}
                    <div className="cal-override__actions">
                      <button type="button" onClick={() => overrideRequest('preview')} disabled={overrideState === 'loading' || !validOverride}>미리보기</button>
                      <button type="button" onClick={() => overrideRequest('save')} disabled={overrideState === 'loading' || !validOverride || !previewToken || previewedMinutes !== editingMinutes}>로컬 저장</button>
                      <button type="button" onClick={() => overrideRequest('reset')} disabled={overrideState === 'loading'}>이 날짜 초기화</button>
                    </div>
                    {overrideState === 'loading' && <span role="status">처리 중…</span>}
                    {overrideMessage && <span className={overrideState === 'error' ? 'is-error' : 'is-success'} role={overrideState === 'error' ? 'alert' : 'status'}>{overrideMessage}</span>}
                  </section>
                )}
                <div className="cal-detail__foot">계획 시뮬레이션 값입니다 · Flex에 기록되지 않음</div>
              </>
            ) : null}
          </div>
        </Card>
      </div>
    );
  };

  return (
    <div className="cal-tab">
      <div className="cal-main">
        <Card className={loading ? 'is-refreshing' : ''}>
          <div className="cal-card__h">
            <span className="cal-card__t">{year}년 {month}월</span>
            <span className="cal-card__sum mono">목표 <b>{fmt(planResult?.targetMinutes)}</b></span>
          </div>
          <div className="cal-metrics mono">
            <span><i>실근무 누적</i><b>{fmt(actualTotal)}</b></span>
            <span><i>인정 누적</i><b>{fmt(recognizedTotal)}</b></span>
            <span><i>계획 배정</i><b>{fmt(planTotal)}</b></span>
            <span><i>목표 잔여</i><b>{fmt(remainingTotal)}</b></span>
            <span className={forecastTotal === Number(planResult?.targetMinutes || 0) ? 'is-ok' : ''}><i>예상 인정</i><b>{fmt(forecastTotal)}</b></span>
          </div>
          <div className="cal-card__b">
            <div className="cal-grid">
              {DOW.map(d => <div key={d} className="cal-dow">{d}</div>)}
              <div className="cal-dow cal-dow--g">주계</div>
              {weeks.map((week, i) => [...week.map(renderCell), renderWsum(week, i)])}
            </div>
            <div className="cal-legend mono">
              <span className="cal-legend__li"><span className="cal-legend__sw" style={{background: 'var(--green)'}} />확정 인정 (11:59 대비 채움)</span>
              {(['long', 'normal', 'short', 'adjust'] as const).map(k => (
                <span key={k} className="cal-legend__li">
                  <span className="cal-legend__st" style={{background: `var(--kind-${k})`}} />{kindLabel(k)}
                </span>
              ))}
              <span className="cal-legend__li"><span className="cal-legend__do" style={{background: 'var(--timeoff)'}} />휴가</span>
              <span className="cal-legend__li"><span className="cal-legend__ring" />오늘</span>
            </div>
          </div>
        </Card>
        {nextPlan && (
          <div className="cal-next" style={kindVar(nextPlan.kind)}>
            <span className="cal-next__nk">다음 일정</span>
            <span className="cal-next__nd"><b className="mono">{md(nextPlan.date)}</b> {nextPlan.weekday} · {kindLabel(nextPlan.kind)}</span>
            <span className="cal-next__nv mono">{nextPlan.window}&nbsp;&nbsp;<span className="cal-next__add">+{fmt(nextPlan.plannedMinutes)}</span></span>
          </div>
        )}
      </div>
      {renderDetail()}
    </div>
  );
}
