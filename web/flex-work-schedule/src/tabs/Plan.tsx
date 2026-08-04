import './plan.css';
import React, {useRef, useState} from 'react';
import {
  fmt, kindLabel, krw, Plan, PlannerDay, Strategy, TabProps,
} from '../lib';
import {Card, Skel, TargetAccountingSummary} from '../ui';

const BADGE: Record<string, string> = {target: '최소 기준', fixed_ot: '수당 기준선', max: '상한'};
const EFFORT: Record<string, string> = {target: 'low', fixed_ot: 'mid', max: 'high'};
const STATUS_KO: Record<string, string> = {planned: '배치 완료', satisfied: '이미 달성', insufficient_slots: '배치 부족', over_target: '고정 계획 충돌', infeasible_locked_target: '고정 계획 충돌'};

const md = (iso?: string) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '');
const signed = (v: number) => `${v < 0 ? '-' : '+'}${fmt(Math.abs(v))}`;
const CUSTOM_RE = /^(\d{1,3})(?::([0-5]\d))?$/; // 'H:MM' 또는 콜론 없는 시간(예: 176 → 176:00)

export function PlanTab({payload, loading, selected, setTarget}: TabProps) {
  const [custom, setCustom] = useState('');
  const [flashKind, setFlashKind] = useState<'invalid' | 'clamp' | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(false);

  const flashTimer = useRef(0);
  const flash = (kind: 'invalid' | 'clamp') => {
    window.clearTimeout(flashTimer.current);
    setFlashKind(kind);
    flashTimer.current = window.setTimeout(() => setFlashKind(null), 1000);
  };

  if (!payload) {
    if (!loading) return null;
    return (
      <div className="plan-root">
        <div className="plan-col">
          {[0, 1, 2, 3].map(i => <Skel key={i} className="plan-skel--strat" />)}
        </div>
        <div className="plan-col">
          <Skel className="plan-skel--strip" />
          <Skel className="plan-skel--table" />
          <Skel className="plan-skel--week" />
        </div>
      </div>
    );
  }

  const planner = payload.planner;
  if (!planner) return null; // archive months carry no planner — render nothing, never crash

  const comparisons = planner.comparisons || [];
  const plan: Plan = planner.plan || {};
  const strategy: Strategy = planner.strategy || {};
  const days: PlannerDay[] = plan.days || [];
  const weekly = plan.summary?.weekly || [];
  const feas = plan.feasibility;
  const feasOk = !feas?.status || feas.status === 'ok' || feas.status === 'planned';

  const fixedOt = comparisons.find(c => c.key === 'fixed_ot')?.targetMinutes || 0;
  const statutoryMax = payload.derived?.statutoryMaxMinutes || 0;
  const timeOff = payload.derived?.timeOffMinutes || 0;
  const recognizedMax = payload.derived?.maxMinutes || statutoryMax;
  const isCustom = selected > 0 && !comparisons.some(c => c.targetMinutes === selected);
  const min = Math.max(60, (payload.derived?.targetMinutes || 0) - 600); // 파생 최소 (헤더 스위처와 동일 규칙)
  const max = payload.derived?.maxMinutes || selected || 719;
  const clampT = (v: number) => Math.max(min, Math.min(max, v));

  const parsed = custom.trim().match(CUSTOM_RE);
  const customVal = parsed ? Number(parsed[1]) * 60 + Number(parsed[2] || 0) : selected;
  const applyCustomText = () => {
    if (!parsed) {
      if (custom.trim()) flash('invalid');
      return;
    }
    const clamped = clampT(customVal);
    if (clamped !== customVal) flash('clamp');
    setTarget(clamped);
    setCustom('');
  };


  // 추천 근무표 누적: 현재 인정분 기준선에서 실제 추가분만 더한다.
  let cum = plan.recognizedMinutes || 0;

  const bufferDay = strategy.bufferDate ? days.find(d => d.date === strategy.bufferDate) : undefined;
  const weekTotal = weekly.reduce((a, w) => a + (w.plannedAdditionalMinutes || 0), 0);
  const sumLong = weekly.reduce((a, w) => a + (w.longDays || 0), 0);
  const sumNormal = weekly.reduce((a, w) => a + (w.normalDays || 0), 0);

  return (
    <div className={`plan-root${loading ? ' is-refreshing' : ''}`}>

      {/* ======== left: strategy cards ======== */}
      <div className="plan-col plan-col--strategies">
        <button type="button" className="plan-disclosure plan-alternatives-toggle"
          aria-expanded={showAlternatives} onClick={() => setShowAlternatives(v => !v)}>
          <span>다른 전략 비교</span><span aria-hidden="true">{showAlternatives ? '▴' : '▾'}</span>
        </button>
        <div className={`plan-alt-content${showAlternatives ? ' is-open' : ''}`}>
          <div className="plan-seclabel">전략 카드 — {payload.month}월 목표 선택</div>
          <div className="plan-stack">
          {comparisons.map(c => {
            const sel = !isCustom && c.targetMinutes === selected;
            return (
              <button key={c.key} type="button" aria-pressed={sel}
                className={`plan-strat${sel ? ' is-selected' : ''}`}
                onClick={() => setTarget(c.targetMinutes)}>
                <span className="plan-strat__row1">
                  <span className={`radio${sel ? ' is-on' : ''}`} />
                  <span className="plan-strat__name">{c.label}</span>
                  <span className={`plan-badge${sel ? ' plan-badge--sel' : c.key === 'fixed_ot' ? ' plan-badge--ot' : ''}`}>
                    {sel ? '선택됨' : BADGE[c.key] || '전략'}
                  </span>
                </span>
                <span className="plan-goal">
                  <b className="mono plan-goal__h">{fmt(c.targetMinutes)}</b>
                  <span className="mono plan-goal__delta">
                    {c.key === 'fixed_ot' ? '초과분부터 수당 발생' : fixedOt ? `고정OT ${signed(c.targetMinutes - fixedOt)}` : ''}
                    {' · 잔여 '}{fmt(c.remainingMinutes)}
                  </span>
                </span>
                <span className="plan-meta">
                  <span>
                    <span className="plan-meta__k">세후 수당</span>
                    <b className={`mono plan-meta__v${c.projectedExtraPayAfterTaxKrw ? '' : ' is-zero'}`}>
                      +{krw(c.projectedExtraPayAfterTaxKrw)}<i className="plan-u">원</i>
                    </b>
                  </span>
                  <span>
                    <span className="plan-meta__k">긴 날</span>
                    <b className={`mono plan-meta__v${c.summary?.longDays ? '' : ' is-zero'}`}>
                      {c.summary?.longDays || 0}<i className="plan-u">회</i>
                    </b>
                  </span>
                  <span>
                    <span className="plan-meta__k">Effort</span>
                    <b className="plan-meta__v">
                      <span className={`plan-effort plan-effort--${EFFORT[c.key] || 'mid'}`} title={c.effortMessage}>
                        {c.effortLabel || '—'}
                      </span>
                    </b>
                  </span>
                </span>
              </button>
            );
          })}

          {/* 커스텀 목표 (R2) */}
          <article className={`plan-strat plan-strat--custom${isCustom ? ' is-selected' : ''}`}>
            <span className="plan-strat__row1">
              <span className={`radio${isCustom ? ' is-on' : ''}`} />
              <span className="plan-strat__name">커스텀</span>
              <span className={`plan-badge plan-badge--custom${isCustom ? ' plan-badge--sel' : ''}`}>
                {isCustom ? '선택됨' : '직접 설정'}
              </span>
            </span>
            <span className="plan-custom-input">
              <button type="button" className="plan-step" aria-label="15분 감소" disabled={selected <= min}
                onClick={() => setTarget(clampT(selected - 15))}>
                <span className="plan-step__s">−</span><span className="plan-step__u">15분</span>
              </button>
              <input className={`mono plan-custom-field${flashKind === 'invalid' ? ' is-invalid' : ''}`}
                value={custom} placeholder={fmt(selected)}
                aria-label="커스텀 목표 (시:분)"
                onChange={e => setCustom(e.currentTarget.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyCustomText(); }} />
              <button type="button" className="plan-step" aria-label="15분 증가" disabled={selected >= max}
                onClick={() => setTarget(clampT(selected + 15))}>
                <span className="plan-step__s">+</span><span className="plan-step__u">15분</span>
              </button>
            </span>
            <span className="plan-custom-rel mono">
              {fixedOt ? <>고정OT <b>{signed(customVal - fixedOt)}</b></> : null}
              {isCustom && <> · 세후 예상 <b>+{krw(plan.projectedExtraPayAfterTaxKrw)}원</b></>}
            </span>
            <span className={`plan-custom-note${flashKind === 'clamp' ? ' is-clamped' : ''}`}>
              허용 범위 <span className="mono">{fmt(min)} – {fmt(max)}</span> · 입력 즉시 추천 근무표 재계산
            </span>
            <span className="plan-custom-note plan-custom-note--foot">Flex에 기록되지 않음 · 시뮬레이션 전용</span>
          </article>
          </div>
        </div>
      </div>

      {/* ======== right: selected strategy result ======== */}
      <div className="plan-col plan-col--result">

        {/* 전략 요약 스트립 */}
        <Card className="plan-strip">
          <span className="plan-strip__head">
            <b>{strategy.title || '전략 요약'}</b>
            {plan.status && <span className="chip"><span className="mono">{STATUS_KO[plan.status] || plan.status}</span></span>}
          </span>
          {strategy.message && <span className="plan-strip__msg">{strategy.message}</span>}
          <span className="plan-strip__stats">
            <span className="plan-tag">목표 <b>{fmt(plan.targetMinutes)}</b></span>
            <span className="plan-tag">160시간 목표 인정 <b>{fmt(plan.recognizedMinutes)}</b></span>
            <span className="plan-tag">선택 목표 잔여 <b>{fmt(plan.remainingMinutes)}</b></span>
            <span className="plan-tag">계획 <b>{fmt(plan.plannedTotalMinutes)}</b></span>
            <span className="plan-tag">예상 <b>{fmt(plan.forecastMinutes ?? ((plan.recognizedMinutes || 0) + (plan.plannedTotalMinutes || 0)))}</b></span>
            <span className="plan-tag">갭 <b>{fmt(plan.gapMinutes)}</b></span>
            {(plan.overTargetMinutes || 0) > 0 && <span className="plan-tag plan-tag--warn">초과 <b>{fmt(plan.overTargetMinutes)}</b></span>}
            <span className="plan-tag">세후 <b>+{krw(plan.projectedExtraPayAfterTaxKrw)}원</b></span>
          </span>
          <TargetAccountingSummary accounting={plan.accounting} />
          {statutoryMax > 0 && (
            <span className="plan-strip__stats plan-strip__limits">
              <span className="plan-tag">실근무 법정 상한 <b>{fmt(statutoryMax)}</b></span>
              <span className="plan-tag">유급휴가 인정 <b>+{fmt(timeOff)}</b></span>
              <span className="plan-tag">인정시간 목표 <b>{fmt(recognizedMax)}</b></span>
            </span>
          )}
        </Card>

        {/* 상태 이름 대신 백엔드가 보낸 충돌 근거로 판정 — 새 status가 생겨도 숨지 않음 */}
        {(Boolean(plan.conflictReason) || (plan.overTargetMinutes || 0) > 0) && (
          <div className="plan-feas plan-feas--warn" role="alert">
            <span className="plan-feas__st">고정 계획 충돌</span>
            <span className="plan-feas__msg">{plan.conflictReason || `초과 ${fmt(plan.overTargetMinutes)}`}</span>
          </div>
        )}
        {/* 실현 가능성 배너 */}
        {feasOk ? (
          <div className="plan-feas">
            <span className="plan-feas__st">배치 가능</span>
            <span className="plan-feas__msg">
              잔여 <b className="mono">{fmt(plan.remainingMinutes)}</b> 를 남은 근무일에 배치 완료 · 계획 반영됨
            </span>
            <span className="plan-feas__tags">
              <span className="plan-tag">긴 날 <b>{plan.summary?.longDays || 0}회</b></span>
              <span className="plan-tag">조정 <b>{plan.summary?.adjustDays || 0}회</b></span>
            </span>
          </div>
        ) : (
          <div className="plan-feas plan-feas--warn">
            <span className="plan-feas__st">배치 부족</span>
            <span className="plan-feas__msg">
              남은 근무일로 목표를 채울 수 없습니다 · 부족 <b className="mono">{fmt(feas?.gapMinutes)}</b>
            </span>
            <span className="plan-feas__tags">
              <span className="plan-tag">부족분 <b>{fmt(feas?.gapMinutes)}</b></span>
              <span className="plan-tag">목표 하향 <b>{fmt(feas?.targetReductionMinutes)}</b></span>
              <span className={`plan-tag${feas?.requiredLongDayFeasible ? '' : ' plan-tag--warn'}`}>
                필요 긴 날 <b>{fmt(feas?.requiredLongDayMinutes)}</b> · {feas?.requiredLongDayFeasible ? '가능' : '불가'}
              </span>
              {feas?.possibleTargetMinutes != null && (
                <button type="button" className="plan-feas__apply"
                  onClick={() => setTarget(clampT(feas.possibleTargetMinutes!))}>
                  가능한 최대 적용 <b className="mono">{fmt(feas.possibleTargetMinutes)}</b>
                </button>
              )}
            </span>
          </div>
        )}

        {/* 추천 근무표 */}
        <Card>
          <div className="plan-card-h">
            <span className="plan-card-t">추천 근무표</span>
            <span className="plan-card-sum">계획 합계 <b>{fmt(plan.plannedTotalMinutes)}</b></span>
          </div>
          <div className="plan-card-b plan-tablewrap">
            <table className="plan-table">
              <thead>
                <tr>
                  <th>날짜</th><th>구분</th><th>추천 출퇴근</th>
                  <th className="plan-r">추가</th><th className="plan-r">실적</th>
                  <th className="plan-r">휴가</th><th className="plan-r">누적</th>
                </tr>
              </thead>
              <tbody>
                <tr className="plan-tr--base">
                  <td colSpan={6}>현재 160시간 목표 인정 · 출근과 유급휴가 기준</td>
                  <td className="plan-r"><span className="mono">{fmt(plan.recognizedMinutes)}</span></td>
                </tr>
                {days.map(d => {
                  const additional = d.plannedAdditionalMinutes ?? d.plannedMinutes ?? 0;
                  const accounted = d.isToday ? d.plannedMinutes ?? additional : additional;
                  cum += accounted;
                  const cls = [
                    (d.currentWorkedMinutes || 0) > 0 ? 'plan-tr--done' : '',
                    d.isToday ? 'plan-tr--today' : '',
                  ].join(' ').trim();
                  return (
                    <tr key={d.date} className={cls || undefined}>
                      <td>
                        <span className="mono plan-date">{md(d.date)}</span>
                        <span className="mono plan-dow">{d.weekday}</span>
                      </td>
                      <td><span className={`kind-tag kind-tag--${d.kind}`}>{d.isDateOverride ? '16시 고정' : kindLabel(d.kind)}</span></td>
                      <td><span className="mono plan-win">{d.window}</span></td>
                      <td className="plan-r"><span className="mono plan-add">+{fmt(additional)}</span></td>
                      <td className="plan-r"><span className="mono">{(d.currentWorkedMinutes || 0) > 0 ? fmt(d.currentWorkedMinutes) : '—'}</span></td>
                      <td className="plan-r"><span className="mono">{(d.timeoffMinutes || 0) > 0 ? fmt(d.timeoffMinutes) : '—'}</span></td>
                      <td className="plan-r"><b className="mono">{fmt(cum)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {bufferDay && (
            <div className="plan-buffer">
              <span className="plan-buffer__k">조정 버퍼</span>
              <span className="plan-buffer__d">
                <span className="mono">{md(bufferDay.date)}</span> {bufferDay.weekday} · 월말 오차 흡수용 · 실적에 따라 자동 재산정
              </span>
              <span className="mono plan-buffer__v">{fmt(bufferDay.plannedMinutes)}<i> 배정</i></span>
            </div>
          )}
        </Card>

        {/* 주 52시간 상한 */}
        <Card>
          <div className="plan-card-h">
            <span className="plan-card-t">주 52시간 상한</span>
            <span className="plan-card-sum">계획 추가 <b>{fmt(weekTotal)}</b></span>
          </div>
          <div className="plan-card-b">
            {weekly.map(w => (
              <div key={w.key} className={`plan-week${w.todayIncluded ? ' is-now' : ''}`}>
                <span className="mono plan-week__label">
                  {w.label}{w.todayIncluded && <em>이번 주</em>}
                </span>
                <span className="plan-week__bar">
                  <i className={(w.longDays || 0) > 0 ? 'is-long' : 'is-normal'}
                    style={{width: `${Math.min(100, Math.round(100 * (w.projectedActualMinutes || 0) / Math.max(1, w.weeklyMaxMinutes || 3120)))}%`}} />
                </span>
                <b className="mono plan-week__val">{fmt(w.projectedActualMinutes)} / {fmt(w.weeklyMaxMinutes || 3120)}</b>
                <span className="mono plan-week__mix">
                  추가 {fmt(w.plannedAdditionalMinutes)} · 긴 {w.longDays || 0} · 보통 {w.normalDays || 0}{(w.adjustDays || 0) > 0 ? ` · 조정 ${w.adjustDays}` : ''}
                </span>
              </div>
            ))}
            {weekly.length === 0 && <span className="muted">계획된 주가 없습니다.</span>}
            <div className="plan-week-foot mono">
              <span><i className="plan-ki plan-ki--long" />긴 날 <b>{sumLong}일</b></span>
              <span><i className="plan-ki plan-ki--normal" />보통 <b>{sumNormal}일</b></span>
              <span className="plan-week-foot__total">합계 <b>{fmt(weekTotal)}</b></span>
            </div>
          </div>
        </Card>


      </div>
    </div>
  );
}
