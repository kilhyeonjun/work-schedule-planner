import './analysis.css';
import React from 'react';
import {Comparison, fmt, krw, pad, TabProps, todayIso} from '../lib';
import {Card, Skel} from '../ui';

const isWarnRow = (c: Comparison) => {
  const f = c.feasibility;
  return (c.gapMinutes || 0) > 0 || (f?.gapMinutes || 0) > 0 || f?.requiredLongDayFeasible === false
    || (!!f?.status && f.status !== 'planned' && f.status !== 'ok');
};

export function AnalysisTab({payload, loading, selected, setTarget, settings, year, month}: TabProps) {
  if (loading && !payload) {
    return (
      <div className="an-grid">
        <div className="an-col">
          <Card><Skel className="an-skel an-skel--chart" /></Card>
          <Card><Skel className="an-skel an-skel--rows" /></Card>
        </div>
        <div className="an-col">
          <Card><Skel className="an-skel an-skel--tiles" /></Card>
          <Card><Skel className="an-skel an-skel--tiles" /></Card>
        </div>
      </div>
    );
  }
  if (!payload) return null;

  const d = payload.derived || {};
  const days = payload.days || [];
  const planner = payload.planner;
  const plan = planner?.plan;
  const comparisons = planner?.comparisons || [];
  const today = todayIso();
  const isCurMonth = today.slice(0, 7) === `${year}-${pad(month)}`;
  const lastDay = new Date(year, month, 0).getDate();

  const truth = payload.truth?.current;
  const recognized = truth?.effectiveRecognizedMinutes ?? d.recognizedMinutes ?? 0;
  const selTarget = truth?.selectedTargetMinutes || selected || d.targetMinutes || 0;
  // stale payload의 c.selected는 무시 — 사용자 선택 target(selTarget)만 신뢰
  const selComp = comparisons.find(c => c.targetMinutes === selTarget);
  const remaining = truth?.remainingToSelectedTargetMinutes ?? Math.max(0, selTarget - recognized);
  const pct = selTarget > 0 ? Math.round((recognized / selTarget) * 100) : 0;
  const workedRows = days.filter(r => (r.recognized_minutes || 0) > 0);

  // ---- burn-up geometry (comp: viewBox 750x292, plot x 40..730, y 250..30) ----
  const actualPts: {day: number; cum: number}[] = [];
  let cum = 0;
  for (const row of days) {
    if (row.date > today) break;
    cum += row.recognized_minutes || 0;
    actualPts.push({day: Number(row.date.slice(8, 10)), cum});
  }
  const last = actualPts[actualPts.length - 1];

  const projPts: {day: number; cum: number}[] = [];
  if (isCurMonth && last && plan?.days?.length) {
    let c = last.cum;
    projPts.push(last);
    for (const p of plan.days) {
      if (p.date < today) continue;
      c += p.plannedAdditionalMinutes ?? p.plannedMinutes ?? 0;
      projPts.push({day: Number(p.date.slice(8, 10)), cum: c});
    }
  }

  const fixedOt = d.fixedOtMinutes || 0;
  const goal = d.targetMinutes || 0;
  const yMax = Math.max(selTarget, fixedOt, goal, last?.cum || 0, projPts[projPts.length - 1]?.cum || 0, 60);
  const x = (day: number) => 40 + ((day - 1) / (lastDay - 1)) * 690;
  const y = (v: number) => 250 - (v / yMax) * 220;
  const pts = (arr: {day: number; cum: number}[]) =>
    arr.map(p => `${x(p.day).toFixed(1)},${y(p.cum).toFixed(1)}`).join(' ');

  const xTicks: number[] = [];
  for (let dd = 1; dd <= lastDay; dd += 5) xTicks.push(dd);
  if (xTicks[xTicks.length - 1] !== lastDay) xTicks.push(lastDay);

  // marker labels: 값이 같으면 페이스 라벨은 중복이라 숨기고, 근접하면 밀어낸다
  const goalLblY = y(goal) - 5;
  const otLblY = y(fixedOt) - 5;
  const paceLblHidden = selTarget === fixedOt || selTarget === goal;
  let paceLblY = y(selTarget) - 5;
  if (fixedOt > 0 && Math.abs(paceLblY - otLblY) < 14) paceLblY = otLblY - 14;
  if (goal > 0 && Math.abs(paceLblY - goalLblY) < 14) paceLblY = Math.min(paceLblY, goalLblY - 14);
  const todayDay = Number(today.slice(8, 10));
  const flip = last ? x(last.day) > 620 : false;

  const maxPay = Math.max(...comparisons.map(c => c.projectedExtraPayAfterTaxKrw || 0), 0);

  // ---- 수당 효율 ----
  const afterTax = plan?.projectedExtraPayAfterTaxKrw ?? selComp?.projectedExtraPayAfterTaxKrw ?? 0;
  const preTax = plan?.projectedExtraPayPreTaxKrw ?? 0;
  const overFixed = plan?.projectedOverFixedMinutes ?? Math.max(0, selTarget - fixedOt);
  const perHour = overFixed > 0 ? afterTax / (overFixed / 60) : 0;

  // ---- 최근 추세: 마지막 7개 확정일 ----
  const trend = workedRows.slice(-7).map(r => ({date: r.date, v: r.recognized_minutes || 0}));
  const trendAvg = trend.length ? trend.reduce((a, t) => a + t.v, 0) / trend.length : 0;
  const trendMax = Math.max(...trend.map(t => t.v), settings.normalDayMinutes, 1) * 1.2;

  return (
    <div className={`an-grid ${payload && loading ? 'is-refreshing' : ''}`}>
      <div className="an-col">

        {/* burn-up */}
        <Card className="an-card">
          <div className="an-card-h">
            <span className="an-t">누적 인정 추이 · {year}-{pad(month)}</span>
            <span className="an-sum">
              <b>{fmt(recognized)}</b>&nbsp;/&nbsp;{fmt(selTarget)}&nbsp;·&nbsp;달성&nbsp;<b>{pct}%</b>
              &nbsp;·&nbsp;남은&nbsp;<b>{fmt(remaining)}</b>&nbsp;·&nbsp;근무일&nbsp;<b>{workedRows.length}일</b>
            </span>
          </div>
          <div className="an-card-b">
            <svg className="an-chart" viewBox="0 0 750 292" role="img"
              aria-label={`${month}월 1일부터 ${lastDay}일까지 누적 인정 시간과 목표 페이스 비교`}>
              {/* baseline + y ticks */}
              <line className="an-hair" x1="40" y1="250" x2="730" y2="250" />
              <text className="an-ax an-ax--y" x="34" y="253">0</text>
              <text className="an-ax an-ax--y" x="34" y={(y(yMax / 2) + 3).toFixed(1)}>{fmt(yMax / 2)}</text>
              <text className="an-ax an-ax--y" x="34" y={(y(yMax) + 3).toFixed(1)}>{fmt(yMax)}</text>

              {/* 목표 marker */}
              {goal > 0 && <>
                <line className="an-goal" x1="40" y1={y(goal).toFixed(1)} x2="730" y2={y(goal).toFixed(1)} strokeDasharray="2 4" />
                <text className="an-lbl an-lbl--goal" x="44" y={goalLblY.toFixed(1)}>목표 {fmt(goal)}</text>
              </>}

              {/* 고정OT marker */}
              {fixedOt > 0 && <>
                <line className="an-ot" x1="40" y1={y(fixedOt).toFixed(1)} x2="730" y2={y(fixedOt).toFixed(1)} />
                <text className="an-lbl an-lbl--ot" x="44" y={otLblY.toFixed(1)}>고정OT {fmt(fixedOt)}</text>
              </>}

              {/* 선택 목표 pace */}
              {selTarget > 0 && <>
                <line className="an-pace" strokeDasharray="5 5"
                  x1="40" y1={y(selTarget / lastDay).toFixed(1)} x2="730" y2={y(selTarget).toFixed(1)} />
                {!paceLblHidden && (
                  <text className="an-lbl an-lbl--pace" x="44" y={paceLblY.toFixed(1)}>
                    {selComp?.label || '커스텀'} 목표 {fmt(selTarget)}
                  </text>
                )}
                <circle className="an-pace-dot" cx="730" cy={y(selTarget).toFixed(1)} r="3" />
              </>}

              {/* today vertical */}
              {isCurMonth && <line className="an-hair" x1={x(todayDay).toFixed(1)} y1="24" x2={x(todayDay).toFixed(1)} y2="250" />}

              {/* actual cumulative area + line */}
              {actualPts.length > 1 && last &&
                <polygon className="an-area"
                  points={`${pts(actualPts)} ${x(last.day).toFixed(1)},250 ${x(actualPts[0].day).toFixed(1)},250`} />}
              {actualPts.length > 0 && <polyline className="an-line" points={pts(actualPts)} />}

              {/* plan projection */}
              {projPts.length > 1 && <polyline className="an-proj" strokeDasharray="2 3" points={pts(projPts)} />}

              {/* today dot + labels */}
              {isCurMonth && last && <>
                <circle className="an-today-dot" cx={x(last.day).toFixed(1)} cy={y(last.cum).toFixed(1)} r="4" />
                <text className="an-today-val" textAnchor={flip ? 'end' : 'start'}
                  x={(flip ? x(last.day) - 10 : x(last.day) + 10).toFixed(1)} y={(y(last.cum) + 17).toFixed(1)}>{fmt(last.cum)}</text>
                <text className="an-ax" textAnchor={flip ? 'end' : 'start'}
                  x={(flip ? x(last.day) - 10 : x(last.day) + 10).toFixed(1)} y={(y(last.cum) + 31).toFixed(1)}>오늘 {month}/{todayDay}</text>
              </>}

              {/* x axis */}
              {xTicks.map(dd => (
                <text key={dd} className="an-ax" textAnchor="middle" x={x(dd).toFixed(1)} y="272">{month}/{dd}</text>
              ))}
            </svg>
            <div className="an-legend">
              <span className="is-cum"><i />누적 인정</span>
              {selTarget > 0 && <span className="is-pace"><i />선택 목표 페이스</span>}
              {projPts.length > 1 && <span className="is-proj"><i />계획 투영</span>}
              {fixedOt > 0 && <span className="is-ot"><i />고정OT {fmt(fixedOt)}</span>}
              {goal > 0 && <span className="is-goal"><i />목표 {fmt(goal)}</span>}
            </div>
          </div>
        </Card>

        {/* strategy compare (R2: row select) */}
        {comparisons.length > 0 && (
          <Card className="an-card">
            <div className="an-card-h">
              <span className="an-t">전략별 비교</span>
              <span className="an-sum">세후 수당 · 긴 날 · effort</span>
            </div>
            <div className="an-card-cap">행을 선택하면 해당 전략 기준으로 전체 화면이 다시 계산됩니다</div>
            <div className="an-card-b">
              <div className="an-cmp-scroll">
                <div className="an-cmp-head">
                  <span /><span>전략</span><span className="an-r">월 목표</span><span>세후 수당</span>
                  <span className="an-r">금액</span><span>긴 날</span><span className="an-r">Effort</span>
                </div>
                <div className="an-cmp">
                  {comparisons.map(c => {
                    const isSel = c.targetMinutes === selTarget;
                    const warn = isWarnRow(c);
                    const pay = c.projectedExtraPayAfterTaxKrw || 0;
                    const longDays = c.summary?.longDays || 0;
                    return (
                      <button key={c.key} type="button"
                        className={`an-cmp-row ${isSel ? 'is-selected' : ''} ${warn ? 'is-warn' : ''}`}
                        onClick={() => setTarget(c.targetMinutes)}
                        aria-pressed={isSel}>
                        <span className={`radio ${isSel ? 'is-on' : ''}`} />
                        <span className="an-name">{c.label}{isSel && <span className="an-name-b">선택됨</span>}</span>
                        <span className="an-target mono">{fmt(c.targetMinutes)}</span>
                        <span className="an-track">
                          <i style={{width: maxPay > 0 ? `${Math.round((pay / maxPay) * 100)}%` : '0%'}} />
                        </span>
                        <span className={`an-pay mono ${pay > 0 ? '' : 'is-zero'}`}>
                          {pay > 0 ? krw(pay) : '+0'}<span className="an-u">원</span>
                        </span>
                        <span className="an-dots mono">
                          {Array.from({length: Math.min(longDays, 6)}, (_, i) => <i key={i} />)}
                          <span>{longDays}회</span>
                        </span>
                        <span className="an-effort">{c.effortLabel || '—'}</span>
                        <span className="an-meta mono">
                          남은 {fmt(c.remainingMinutes)} · <span className={warn ? 'an-warn-txt' : ''}>격차 {fmt(c.gapMinutes)}</span>
                          {' '}· 평균 {fmt(c.summary?.averageDailyMinutes)}/일
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="an-cmp-foot an-legend">
                <span className="is-pay"><i />세후 수당</span>
                <span className="is-fat"><i />긴 날 (피로)</span>
                <span className="an-foot-note">수당은 고정OT 초과분에만 발생</span>
              </div>
            </div>
          </Card>
        )}

      </div>
      <div className="an-col">

        {/* 수당 효율 */}
        {planner && (
          <Card className="an-card">
            <div className="an-card-h">
              <span className="an-t">수당 효율</span>
              <span className="an-sum">{selComp?.label || '커스텀'} {fmt(selTarget)} 기준</span>
            </div>
            <div className="an-card-b">
              <div className="an-tiles">
                <div className="an-tile">
                  <div className="an-k">고정OT 초과</div>
                  <div className="an-v">{fmt(overFixed)}</div>
                </div>
                <div className="an-tile is-hi">
                  <div className="an-k">세후 수당</div>
                  <div className="an-v">{krw(afterTax)}<span className="an-u">원</span></div>
                </div>
                <div className="an-tile">
                  <div className="an-k">세전 수당</div>
                  <div className="an-v">{krw(preTax)}<span className="an-u">원</span></div>
                </div>
                <div className="an-tile">
                  <div className="an-k">체감 시급</div>
                  <div className="an-v">{overFixed > 0 ? krw(perHour) : '—'}<span className="an-u">원/h</span></div>
                </div>
              </div>
              <div className="an-eff-note">
                고정OT <span className="mono">{fmt(fixedOt)}</span> 초과분에만 수당 발생 · 세후 우선 표기
              </div>
            </div>
          </Card>
        )}

        {/* 최근 추세 */}
        <Card className="an-card">
          <div className="an-card-h">
            <span className="an-t">최근 추세</span>
            {trend.length > 0 && <span className="an-sum">{trend.length}일 평균&nbsp;<b>{fmt(trendAvg)}</b></span>}
          </div>
          <div className="an-card-b">
            {trend.length === 0 ? (
              <div className="muted">확정된 근무일이 아직 없습니다</div>
            ) : (
              <div className="an-trend">
                <div className="an-trend-plot">
                  <div className="an-trend-marker" style={{bottom: `${((settings.normalDayMinutes / trendMax) * 100).toFixed(1)}%`}}>
                    <span>보통 {fmt(settings.normalDayMinutes)}</span>
                  </div>
                  {trend.map(t => (
                    <div key={t.date} className="an-tb">
                      <span className="an-val mono">{fmt(t.v)}</span>
                      <div className="an-bar" style={{height: `${((t.v / trendMax) * 100).toFixed(1)}%`}} />
                    </div>
                  ))}
                </div>
                <div className="an-trend-days">
                  {trend.map(t => <span key={t.date}>{Number(t.date.slice(5, 7))}/{Number(t.date.slice(8, 10))}</span>)}
                </div>
                <div className="an-legend an-trend-legend">
                  <span className="is-cum"><i />확정 인정</span>
                  <span className="is-goal"><i />보통 {fmt(settings.normalDayMinutes)}</span>
                </div>
              </div>
            )}
          </div>
        </Card>

      </div>
    </div>
  );
}
