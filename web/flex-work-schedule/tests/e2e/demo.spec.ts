import {expect, test} from '@playwright/test';

const forbidden: string[] = [];
test.beforeEach(async ({page}) => {
  forbidden.length = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) forbidden.push(request.url());
  });
});
test.afterEach(() => expect(forbidden, 'demo requested a private /api/* route').toEqual([]));

test('landing routes to public demo and private app', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('link', {name: '데모 보기'})).toHaveAttribute('href', '/demo/');
  await expect(page.getByRole('link', {name: '로그인'})).toHaveAttribute('href', '/app/');
});

test('desktop keeps canonical five tabs, target switching, custom target, and archive mode', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/demo/');
  await expect(page.getByText('❯ flex-planner')).toBeVisible();
  await expect(page.locator('.statusbar__chip', {hasText: '합성 데이터'})).toBeVisible({timeout: 30_000});

  for (const [key, label] of [['today', '오늘'], ['plan', '계획'], ['calendar', '캘린더'], ['analysis', '분석'], ['archive', '기록']] as const) {
    await page.locator('.sidebar__item', {hasText: label}).click();
    await expect(page).toHaveURL(new RegExp(`tab=${key}`));
    await expect(page.locator('.content')).not.toBeEmpty();
  }

  await page.locator('.switcher__trigger').click();
  const dialog = page.getByRole('dialog', {name: '전략 설정'});
  await dialog.locator('.switcher__preset').first().click();
  const before = Number(new URL(page.url()).searchParams.get('target'));
  await page.getByRole('button', {name: '목표 1분 증가'}).click();
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('target'))).toBe(before + 1);
  await page.keyboard.press('Escape');

  await page.locator('.sidebar__item', {hasText: '기록'}).click();
  await page.locator('button.rec-mrow', {hasText: '2월'}).click();
  await expect(page.getByText('읽기 전용 확정 기록')).toBeVisible();
  await expect(page.locator('.sidebar__item', {hasText: '오늘'})).toHaveCount(0);
  await expect(page.locator('.sidebar__item', {hasText: '계획'})).toHaveCount(0);
  await expect(page.locator('.sidebar__item', {hasText: '분석'})).toHaveCount(0);
});

test('global strategy modal resets to its initial baseline and latest request wins', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  const aborted: string[] = [];
  page.on('requestfailed', request => {
    if (request.url().includes('/demo/api/month?')) aborted.push(request.url());
  });
  await page.route('**/demo/api/month?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('normal') === '499') await new Promise(resolve => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.goto('/demo/?year=2042&month=3&tab=calendar');
  const trigger = page.locator('.switcher__trigger');
  await trigger.click();
  const dialog = page.getByRole('dialog', {name: '전략 설정'});
  await expect(dialog.locator('input[type="range"]')).toHaveCount(4);
  await expect(page.locator('.content')).toHaveJSProperty('inert', true);
  await expect(page.locator('.statusbar__nav')).toHaveJSProperty('inert', true);

  await dialog.locator('.switcher__preset').first().click();
  await page.getByRole('button', {name: '보통 1분 감소'}).click();
  await expect(dialog.getByText('업데이트 중')).toBeVisible();
  await page.getByRole('button', {name: '보통 1분 감소'}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('normal')).toBe('498');
  await expect.poll(() => aborted.some(url => new URL(url).searchParams.get('normal') === '499')).toBe(true);

  await page.getByRole('button', {name: '기본값 복원'}).click();
  await expect.poll(() => {
    const params = new URL(page.url()).searchParams;
    return [params.get('target'), params.get('normal'), params.get('long'), params.get('short')];
  }).toEqual(['7800', '500', '719', '285']);

  const monthBefore = new URL(page.url()).searchParams.get('month');
  await page.locator('.switcher__scrim').click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(new URL(page.url()).searchParams.get('month')).toBe(monthBefore);

  await trigger.click();
  const focusable = dialog.locator('button:not([disabled]), input:not([disabled])');
  await focusable.last().focus();
  await page.keyboard.press('Tab');
  await expect(focusable.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.locator('.content')).toHaveJSProperty('inert', false);
});


test('month fetch failure does not render cross-scope zero dashboard', async ({page}) => {
  await page.route('**/demo/api/month?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('month') === '4') {
      await route.fulfill({status: 500, contentType: 'application/json', body: JSON.stringify({ok: false, error: 'demo failure'})});
      return;
    }
    await route.continue();
  });
  await page.goto('/demo/?year=2042&month=3&tab=today');
  await expect(page.locator('.today')).toBeVisible();
  await page.evaluate(() => {
    const state = window as typeof window & {__crossScopeStale?: boolean};
    state.__crossScopeStale = false;
    const check = () => {
      const aprilHeader = document.querySelector('.accent')?.textContent?.includes('2042−04');
      if (aprilHeader && document.querySelector('.today-hero, .today-month')) state.__crossScopeStale = true;
    };
    new MutationObserver(check).observe(document.body, {subtree: true, childList: true, characterData: true});
  });
  await page.getByRole('button', {name: '다음 달'}).click();
  await expect(page.locator('.refresh-error')).toContainText('데이터를 불러오지 못했습니다');
  await expect(page.locator('.today')).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & {__crossScopeStale?: boolean}).__crossScopeStale)).toBe(false);
});

test('mobile renders canonical bottom navigation without page overflow', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/demo/?tab=today');
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(page.locator('.tabbar')).toBeVisible();
  await page.locator('.tabbar__item', {hasText: '캘린더'}).click();
  await expect(page.locator('.cal-tab')).toBeVisible();
  await page.locator('button.cal-cell:not([disabled])').first().click();
  await expect(page.locator('.cal-detail')).toBeVisible();
  await page.locator('.switcher__trigger').click();
  const sheet = page.getByRole('dialog', {name: '전략 설정'});
  await expect(sheet.locator('input[type="range"]')).toHaveCount(4);
  await expect(sheet.getByLabel('단축', {exact: true})).toHaveAttribute('min', '285');
  const geometry = await sheet.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const targets = [...element.querySelectorAll('button')].map(node => node.getBoundingClientRect());
    return {
      position: getComputedStyle(element).position,
      bottom: Math.round(innerHeight - rect.bottom),
      width: Math.round(rect.width),
      minTarget: Math.min(...targets.map(rect => Math.min(rect.width, rect.height))),
    };
  });
  expect(geometry).toEqual({position: 'fixed', bottom: 0, width: 390, minTarget: 44});
  await expect(page.locator('.tabbar')).toHaveJSProperty('inert', true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('date override requires preview before local save and exposes reset', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  let preview: Record<string, unknown>;
  await page.route('**/demo/api/planner/overrides**', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ok: true, localOnly: true, preview, previewToken: 'demo-preview', overrides: {}}),
  }));
  const monthResponse = page.waitForResponse(response => response.url().includes('/demo/api/month?'));
  await page.goto('/demo/?tab=calendar');
  preview = await (await monthResponse).json() as Record<string, unknown>;
  const plan = (preview.planner as {plan: {plannedTotalMinutes: number}}).plan;
  plan.plannedTotalMinutes = 123;
  await page.locator('.cal-cell--plan').first().click();
  await expect(page.getByRole('button', {name: '기본 500'})).toBeVisible();
  await expect(page.getByRole('button', {name: '이 날짜 고정'})).toBeVisible();
  await page.getByRole('button', {name: '목표 맞추기에 사용'}).click();
  await expect(page.getByText('이전/선호값: 목표 맞추기에 사용 (최종 배정 보장 안 함)')).toBeVisible();
  await page.getByRole('button', {name: '긴 날 719'}).click();
  await page.getByRole('button', {name: '출퇴근·휴게'}).click();
  await expect(page.getByLabel('출근')).toHaveValue('06:40');
  await expect(page.getByLabel('퇴근')).toHaveValue('19:40');
  await expect(page.getByLabel('휴게 분')).toHaveValue('61');
  await expect(page.getByRole('button', {name: '로컬 저장'})).toBeDisabled();
  await page.getByRole('button', {name: '미리보기'}).click();
  await expect(page.getByText('미리보기 완료 · 저장 전까지 Flex에는 기록되지 않습니다.')).toBeVisible();
  await expect(page.locator('.cal-metrics')).toContainText('2:03');
  await expect(page.getByRole('button', {name: '로컬 저장'})).toBeEnabled();
  await page.getByRole('button', {name: '로컬 저장'}).click();
  await expect(page.getByText('로컬 계획을 저장했습니다. Flex에는 기록되지 않습니다.')).toBeVisible();
  await page.getByRole('button', {name: '이 날짜 초기화'}).click();
  await expect(page.getByText('이 날짜만 기본 계획으로 되돌렸습니다.')).toBeVisible();
});

test('today hybrid detail preserves actual, remaining, forecast, and recommendation window', async ({page}) => {
  await page.route('**/demo/api/month?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    const today = body.days.find((day: {date: string}) => day.date === '2042-03-04');
    const plan = body.planner.plan.days.find((day: {date: string}) => day.date === '2042-03-04');
    Object.assign(today, {work_minutes: 531, recognized_minutes: 531, day_type: 'workday'});
    Object.assign(plan, {window: '06:40–17:44', plannedMinutes: 604, plannedAdditionalMinutes: 73});
    await route.fulfill({response, body: JSON.stringify(body)});
  });
  await page.goto('/demo/?year=2042&month=3&tab=calendar&selectedDate=2042-03-04');
  const detail = page.locator('.cal-detail');
  await expect(detail.locator('.cal-progress')).toContainText('실적8:51');
  await expect(detail.locator('.cal-progress')).toContainText('남은 계획+1:13');
  await expect(detail.locator('.cal-progress')).toContainText('예상 합계10:04');
  await expect(detail.getByText('권장 퇴근 17:44')).toBeVisible();
  await expect(detail.getByText('권장 시간대 06:40–17:44')).toBeVisible();
});

test('future workday without allocation opens a non-empty local recommendation editor', async ({page}) => {
  await page.route('**/demo/api/month?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.planner.plan.days = body.planner.plan.days.filter((day: {date: string}) => day.date !== '2042-03-05');
    await route.fulfill({response, body: JSON.stringify(body)});
  });
  await page.goto('/demo/?tab=calendar');
  await page.locator('button.cal-cell[data-date="2042-03-05"]').click();
  await expect(page.getByRole('region', {name: '날짜 계획 편집'})).toBeVisible();
  await expect(page.getByRole('button', {name: '기본 500'})).toBeVisible();
  await expect(page.locator('.cal-detail .cal-hero__k')).toHaveText('계획');
});

test('production-shaped auto adjustment shows final truth across calendar, today, and record', async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(window, '__DEMO_TODAY__', {get: () => '2026-07-30', set: () => {}}));
  await page.route('**/demo/api/month?**', async route => {
    const response = await route.fetch({url: 'http://127.0.0.1:18787/demo/api/month?year=2042&month=3'});
    const body = await response.json();
    body.year = 2026;
    body.month = 7;
    body.days.forEach((day: {date: string}) => { day.date = `2026-07-${day.date.slice(-2)}`; });
    body.planner.plan.days.forEach((day: {date: string; plannedMinutes: number; plannedAdditionalMinutes: number}) => {
      day.date = `2026-07-${day.date.slice(-2)}`;
      day.plannedMinutes = 0;
      day.plannedAdditionalMinutes = 0;
    });
    const today = body.days.find((day: {date: string}) => day.date === '2026-07-30');
    Object.assign(today, {day_type: 'workday', work_minutes: 671, recognized_minutes: 671, office_minutes: 609, remote_minutes: 62, unknown_minutes: 0, rest_minutes: 60});
    const thu = body.planner.plan.days.find((day: {date: string}) => day.date === '2026-07-30');
    const fri = body.planner.plan.days.find((day: {date: string}) => day.date === '2026-07-31');
    Object.assign(thu, {kind: 'normal', window: '06:40–16:00', plannedMinutes: 500, plannedAdditionalMinutes: 500, isDateOverride: true});
    Object.assign(fri, {kind: 'adjust', window: '06:40–14:53', plannedMinutes: 433, plannedAdditionalMinutes: 433, isDateOverride: true});
    Object.assign(body.planner.plan, {status: 'planned', gapMinutes: 0, overTargetMinutes: 0, plannedTotalMinutes: 14112, forecastMinutes: 14112, isAutoAdjusted: true, adjustments: [{date: '2026-07-31', beforeMinutes: 500, afterMinutes: 433}], reason: '목표 자동 보정'});
    await route.fulfill({response, body: JSON.stringify(body)});
  });
  await page.goto('/demo/?year=2026&month=7&tab=calendar');
  await expect(page.locator('.plan-feas').filter({hasText: '목표 자동 보정'})).toContainText('목표 자동 보정 · 7/31 8:20 → 7:13 · 예상 235:12');
  const adjusted = page.locator('button.cal-cell[data-date="2026-07-31"]');
  await expect(adjusted).toContainText('목표 자동 보정');
  await expect(adjusted).toContainText('7:13');
  await expect(adjusted).not.toContainText('16시 고정');
  await expect(page.getByText('고정 계획 충돌')).toHaveCount(0);
  await adjusted.click();
  await expect(page.getByText('이전/선호 8:20 → 최종 배정 7:13')).toBeVisible();
  await page.locator('.sidebar__item', {hasText: '오늘'}).click();
  await expect(page.locator('.today-ledger')).toContainText('사무실10:09');
  await expect(page.locator('.today-ledger')).toContainText('원격1:02');
  await expect(page.locator('.today-ledger')).toContainText('추가 근무0:00');
  await page.locator('.sidebar__item', {hasText: '기록'}).click();
  await page.locator('button.rec-pbtn', {hasText: '3'}).click();
  const currentRow = page.locator('.rec-table tbody tr').filter({hasText: '7/30'});
  await expect(currentRow).toContainText('재택');
  await expect(currentRow).toContainText('10:09');
  await expect(currentRow).toContainText('1:02');
});

test('unknown work is never classified as office or remote', async ({page}) => {
  await page.route('**/demo/api/month?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    const today = body.days.find((day: {date: string}) => day.date === '2042-03-04');
    Object.assign(today, {office_minutes: 0, remote_minutes: 0, unknown_minutes: 45, work_minutes: 45, recognized_minutes: 45});
    await route.fulfill({response, body: JSON.stringify(body)});
  });
  await page.goto('/demo/?tab=today');
  await expect(page.locator('.today-ledger')).toContainText('추가 근무0:45');
  await expect(page.locator('.today-ledger')).not.toContainText('사무실0:45');
  await expect(page.locator('.today-ledger')).not.toContainText('원격0:45');
  await page.locator('.sidebar__item', {hasText: '기록'}).click();
  const unknownRow = page.locator('.rec-table tbody tr').filter({hasText: '3/4'});
  await expect(unknownRow).toContainText('추가 근무');
  await expect(unknownRow).not.toContainText('재택');
});
