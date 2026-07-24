import './calendar.css';
import React from 'react';
import {DayRow, PlannerDay, TabProps, dayTypeLabel, fmt, kindLabel, pad, todayIso} from '../lib';
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
  const {payload, loading, selectedDate, setSelectedDate, year, month} = props;
  const today = todayIso();
  const detailRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    // 모바일: 그리드 아래 상세로 스크롤. 데스크톱 sticky는 이미 뷰포트 안 → no-op
    if (selectedDate) detailRef.current?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  }, [selectedDate]);

  if (!payload) {
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

  const rows = new Map<string, DayRow>((payload.days || []).map(d => [d.date, d]));
  const plans = new Map<string, PlannerDay>((payload.planner?.plan?.days || []).map(d => [d.date, d]));

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

  const planResult = payload.planner?.plan;
  const actualTotal = cells.reduce((s, c) => s + (c.inMonth && c.row ? Number(c.row.work_minutes || 0) : 0), 0);
  const confTotal = cells.reduce((s, c) => s + (c.inMonth && c.row ? recMin(c.row) : 0), 0);
  const planTotal = Number(planResult?.plannedTotalMinutes || 0);
  const recognizedTotal = Number(planResult?.recognizedMinutes ?? confTotal);
  const remainingTotal = Number(planResult?.remainingMinutes || 0);
  const forecastTotal = recognizedTotal + planTotal;
  const nextPlan = (payload.planner?.plan?.days || []).find(p => p.date > today && (p.plannedMinutes || 0) > 0);

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
      <button key={c.iso} type="button" className={cls} style={style} disabled={!clickable}
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
  const detailDone = Boolean(selRow && (recMin(selRow) > 0 || !selPlan));
  const kv = (k: string, v: React.ReactNode, zero = false, dot = false) => (
    <div className="cal-kv__row">
      {dot && <span className="cal-kv__dot" />}
      <span className="cal-kv__k">{k}</span>
      <span className={`cal-kv__v mono ${zero ? 'is-zero' : ''}`}>{v}</span>
    </div>
  );

  const renderDetail = () => {
    if (!selectedDate || (!selRow && !selPlan)) return null;
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
                  <div className="cal-progress mono">
                    <span><i>실적</i><b>{fmt(selRow.work_minutes)}</b></span>
                    <span><i>남은 계획</i><b>+{fmt(selPlan.plannedAdditionalMinutes)}</b></span>
                    <span><i>예상 합계</i><b>{fmt(selPlan.plannedMinutes)}</b></span>
                  </div>
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
            ) : selPlan ? (
              <>
                <div className="cal-hero">
                  <span className="cal-hero__k">계획</span>
                  <span className="cal-hero__h mono">{fmt(selPlan.plannedMinutes)}</span>
                </div>
                <div className="cal-kv">
                  <div className="cal-kv__row">
                    <span className="cal-kv__k">종류</span>
                    <span className="cal-kv__v"><span className={`kind-tag kind-tag--${selPlan.kind}`}>{selPlan.isDateOverride ? '16시 퇴근 고정' : kindLabel(selPlan.kind)}</span></span>
                  </div>
                  {kv('시간대', selPlan.window)}
                  {kv('계획', fmt(selPlan.plannedMinutes))}
                  {selPlan.plannedAdditionalMinutes != null && kv('추가 인정', fmt(selPlan.plannedAdditionalMinutes))}
                  {(selPlan.timeoffMinutes || 0) > 0 && kv('휴가', fmt(selPlan.timeoffMinutes), false, true)}
                </div>
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
