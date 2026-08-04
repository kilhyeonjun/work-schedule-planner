import './record.css';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ArchiveMonth, DayRow, TabProps, dayTypeLabel, fmt, pad} from '../lib';
import {Card, Chip, Skel, TargetAccountingSummary} from '../ui';

const PAGE_SIZE = 10;

/** 일별 인정분: 서버가 recognized_minutes를 안 주는 달은 실근무+휴가로 환산. */
const recMin = (d: DayRow) => d.recognized_minutes ?? (d.work_minutes || 0) + (d.timeoff_minutes || 0);

const kindText = (d: DayRow) =>
  [dayTypeLabel(d.day_type), d.remote_minutes ? '재택' : '', d.timeoff_minutes ? '휴가' : '']
    .filter(Boolean).join('·');

const dash = <span className="rec-dash mono">—</span>;

export function RecordTab({payload, loading, archive, archiveMode, year, month, onSelectMonth}: TabProps) {
  const [page, setPage] = useState(1);
  const [openYears, setOpenYears] = useState<number[]>([]);
  useEffect(() => setPage(1), [year, month]);

  // 활성 달 칩이 마운트/변경될 때 모바일 가로 스크롤 가운데로 (callback ref라 늦은 첫 렌더도 커버)
  const activeChipRef = useCallback((el: HTMLButtonElement | null) => {
    el?.scrollIntoView({inline: 'center', block: 'nearest'});
  }, []);

  const currentTruth = !archiveMode ? payload?.truth?.current : undefined;
  const months = (archive.months || []).map(m =>
    currentTruth && m.year === year && m.month === month
      ? {...m, recognizedMinutes: currentTruth.effectiveRecognizedMinutes}
      : m);
  const viewedKey = `${year}-${pad(month)}`;

  // 연도별 그룹 (최신 연도 먼저, 월은 서버 정렬 유지)
  const years = useMemo(() => {
    const map = new Map<number, ArchiveMonth[]>();
    months.forEach(m => map.set(m.year, [...(map.get(m.year) || []), m]));
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [months]);

  // 조회 월 포함 최근 4개월
  const trend = useMemo(() => {
    const idx = months.findIndex(m => m.key === viewedKey);
    const end = idx >= 0 ? idx + 1 : months.length;
    return months.slice(Math.max(0, end - 4), end);
  }, [months, viewedKey]);

  // 해당 월 모든 날 표시 — 0분 근무일은 숨길 게 아니라 확인해야 할 이상치
  const rows = payload?.days || [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pageCount);
  const pageRows = rows.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
  const pageSum = pageRows.reduce((a, d) => a + recMin(d), 0);

  if (loading && !payload) {
    return (
      <div className="rec">
        <div className="rec-col"><Skel className="rec-skel--nav" /></div>
        <div className="rec-col">
          <div className="rec-stats">
            <Skel className="rec-skel--stat" /><Skel className="rec-skel--stat" /><Skel className="rec-skel--stat" />
          </div>
          <Skel className="rec-skel--card" />
          <Skel className="rec-skel--table" />
        </div>
      </div>
    );
  }
  if (!payload) return null;

  const dv = payload.derived || {};
  const actualMinutes = currentTruth?.effectiveActualMinutes ?? dv.actualMinutes ?? 0;
  const recognizedMinutes = currentTruth?.effectiveRecognizedMinutes ?? dv.recognizedMinutes ?? 0;
  const accounting = payload.planner?.plan?.accounting;
  const targetMinutes = currentTruth?.selectedTargetMinutes ?? dv.targetMinutes ?? 0;
  const workDays = payload.days.filter(d => (d.work_minutes || 0) > 0).length;
  const timeoffDays = payload.days.filter(d => (d.timeoff_minutes || 0) > 0).length;
  const diff = recognizedMinutes - targetMinutes;
  const trendMax = Math.max(1, ...trend.map(m => m.recognizedMinutes || 0));
  const trendAvg = trend.length
    ? trend.reduce((a, m) => a + (m.recognizedMinutes || 0), 0) / trend.length : 0;
  const best = trend.length
    ? trend.reduce((a, m) => ((m.recognizedMinutes || 0) > (a.recognizedMinutes || 0) ? m : a)) : null;
  const worst = trend.length
    ? trend.reduce((a, m) => ((m.recognizedMinutes || 0) < (a.recognizedMinutes || 0) ? m : a)) : null;
  const viewed = trend.find(m => m.key === viewedKey);

  return (
    <div className={`rec ${loading ? 'is-refreshing' : ''}`}>

      {/* ---- left: year/month nav ---- */}
      <div className="rec-col">
        <div className="rec-seclabel">아카이브 — 연월 선택</div>
        <Card>
          <div className="rec-ynav">
            {months.length === 0 && <div className="rec-empty">아카이브된 달 없음</div>}
            {years.map(([y, list]) => {
              const open = openYears.includes(y) || y === year;
              return (
                <div key={y}>
                  <button className="rec-ygroup" aria-expanded={open}
                    onClick={() => setOpenYears(p => p.includes(y) ? p.filter(v => v !== y) : [...p, y])}>
                    <b>{y}년</b>
                    <span className="mono rec-ycnt">{list.length}개월</span>
                    <span className="rec-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
                  </button>
                  {open && (
                    <div className="rec-mlist">
                      {list.map(m => (
                        <button key={m.key}
                          ref={m.key === viewedKey ? activeChipRef : undefined}
                          className={`rec-mrow ${m.key === viewedKey ? 'is-active' : ''}`}
                          aria-current={m.key === viewedKey || undefined}
                          onClick={() => onSelectMonth(m.year, m.month)}>
                          <span>{m.month}월</span>
                          <span className="mono rec-mv">{fmt(m.recognizedMinutes)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ---- right: confirmed records ---- */}
      <div className="rec-col">
        <div className="rec-seclabel-row">
          <div className="rec-seclabel">{archiveMode ? '확정 집계' : '진행 중 스냅샷'} — {year}년 {month}월</div>
          {!archiveMode && <Chip className="chip--indigo">이번 달은 아직 확정 전</Chip>}
        </div>

        <div className="rec-stats">
          <Card className="rec-stat">
            <div className="rec-stat__k">{archiveMode ? '확정 실근무' : '현재 실근무'}</div>
            <div className="rec-stat__v mono">{fmt(actualMinutes)}</div>
            <div className="rec-stat__s mono">
              근무 {workDays}일 · 일평균 {fmt(workDays ? actualMinutes / workDays : 0)}
            </div>
          </Card>
          <Card className="rec-stat">
            <div className="rec-stat__k">휴가 인정</div>
            <div className="rec-stat__v mono">{fmt(dv.timeOffMinutes)}</div>
            <div className="rec-stat__s mono">{timeoffDays > 0 ? `사용 ${timeoffDays}일` : '인정 합계에 포함'}</div>
          </Card>
          <Card className="rec-stat rec-stat--total">
            <div className="rec-stat__k">{archiveMode ? '확정 인정 합계' : '160시간 목표 인정'}</div>
            <div className="rec-stat__v mono">{fmt(recognizedMinutes)}</div>
            <div className="rec-stat__s mono">
              목표 {fmt(targetMinutes)} 대비{' '}
              <span className={diff >= 0 ? 'rec-pos' : 'rec-neg'}>{diff >= 0 ? '+' : ''}{fmt(diff)}</span>
            </div>
          </Card>
        </div>
        <TargetAccountingSummary accounting={accounting} />

        <Card>
          <div className="rec-cardh">
            <span className="rec-cardh__t">최근 4개월 추세</span>
            <span className="rec-cardh__sum mono">{trend.length}개월 평균 <b>{fmt(trendAvg)}</b></span>
          </div>
          <div className="rec-cardb">
            {trend.length === 0 ? <div className="rec-empty">아카이브된 달 없음</div> : (
              <>
                <div className="rec-trend">
                  {trend.map(m => (
                    <div key={m.key} className={`rec-trow ${m.key === viewedKey ? 'is-cur' : ''}`}>
                      <span className="rec-tm mono">{m.month}월</span>
                      <span className="rec-track">
                        <i style={{width: `${Math.round((m.recognizedMinutes || 0) / trendMax * 1000) / 10}%`}} />
                      </span>
                      <span className="rec-tv mono">{fmt(m.recognizedMinutes)}</span>
                    </div>
                  ))}
                </div>
                <div className="rec-tfoot mono">
                  {best && <span>최고 <b>{best.month}월 {fmt(best.recognizedMinutes)}</b></span>}
                  {worst && <span>최저 <b>{worst.month}월 {fmt(worst.recognizedMinutes)}</b></span>}
                  <span className="rec-tfoot__end">
                    조회 월 <b>{viewed ? `${viewed.month}월 ${fmt(viewed.recognizedMinutes)}` : `${month}월 ${fmt(recognizedMinutes)}`}</b>
                  </span>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card>
          <div className="rec-cardh">
            <span className="rec-cardh__t">일자별 {archiveMode ? '확정 기록' : '진행 중 기록'}</span>
            <span className="rec-cardh__sum mono">표시 {pageRows.length}건 인정 <b>{fmt(pageSum)}</b></span>
          </div>
          <div className="rec-tablewrap">
            <table className="rec-table">
              <thead>
                <tr>
                  <th>날짜</th><th>구분</th>
                  <th className="r">Flex 원본 인정</th><th className="r rec-col--secondary">사무실</th>
                  <th className="r rec-col--secondary">재택</th><th className="r rec-col--secondary">미분류</th><th className="r rec-col--secondary">휴가</th>
                  <th>출퇴근</th><th className="rec-col--secondary">비고</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(d => (
                  <tr key={d.date}>
                    <td>
                      <span className="rec-date mono">{Number(d.date.slice(5, 7))}/{Number(d.date.slice(8, 10))}</span>
                      <span className="rec-dow mono">{d.weekday}</span>
                    </td>
                    <td><span className="rec-kind">{kindText(d)}</span></td>
                    <td className="r">{recMin(d) > 0 || d.day_type === 'workday'
                      ? <span className="rec-cred mono">{fmt(recMin(d))}</span> : dash}</td>
                    <td className="r rec-col--secondary">{d.office_minutes ? <span className="rec-sec mono">{fmt(d.office_minutes)}</span> : dash}</td>
                    <td className="r rec-col--secondary">{d.remote_minutes ? <span className="rec-sec mono">{fmt(d.remote_minutes)}</span> : dash}</td>
                    <td className="r rec-col--secondary">{d.unknown_minutes ? <span className="rec-sec mono">{fmt(d.unknown_minutes)}</span> : dash}</td>
                    <td className="r rec-col--secondary">{d.timeoff_minutes ? <span className="rec-vac mono">{fmt(d.timeoff_minutes)}</span> : dash}</td>
                    <td>{d.first_start && d.last_end
                      ? <span className="rec-win mono">{d.first_start} – {d.last_end}</span> : dash}</td>
                    <td className="rec-col--secondary">{d.notes?.length ? <span className="rec-note">{d.notes.join(' · ')}</span> : dash}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={9}><div className="rec-empty">확정 기록 없음</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && (
            <div className="rec-pager">
              <span className="rec-pinfo mono">
                {(cur - 1) * PAGE_SIZE + 1}–{(cur - 1) * PAGE_SIZE + pageRows.length} / {rows.length}건
              </span>
              <span className="rec-pbtns">
                <button className="rec-pbtn mono" disabled={cur === 1}
                  onClick={() => setPage(cur - 1)} aria-label="이전 페이지">‹</button>
                {Array.from({length: pageCount}, (_, i) => i + 1).map(p => (
                  <button key={p} className={`rec-pbtn mono ${p === cur ? 'is-on' : ''}`}
                    aria-current={p === cur || undefined} onClick={() => setPage(p)}>{p}</button>
                ))}
                <button className="rec-pbtn mono" disabled={cur === pageCount}
                  onClick={() => setPage(cur + 1)} aria-label="다음 페이지">›</button>
              </span>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
