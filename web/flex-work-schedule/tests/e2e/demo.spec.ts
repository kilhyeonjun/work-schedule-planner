import {expect, test} from '@playwright/test';

const forbidden: string[] = [];
const errors: string[] = [];
test.beforeEach(async ({page}, testInfo) => {
  forbidden.length = 0;
  errors.length = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text());
  });
  page.on('response', response => {
    if (response.status() < 400) return;
    if (testInfo.title.includes('month fetch failure') && response.status() === 500) return;
    if (testInfo.title.includes('demo explains unavailable') && response.status() === 405) return;
    if (testInfo.title.includes('collection request') && [429, 503].includes(response.status())) return;
    errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', request => {
    if (page.url().includes('/demo/') && new URL(request.url()).pathname.startsWith('/api/')) forbidden.push(request.url());
  });
});
test.afterEach(() => {
  expect(forbidden, 'demo requested a private /api/* route').toEqual([]);
  expect(errors, 'unexpected console/page/network errors').toEqual([]);
});
test('landing routes to public demo and private app', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('link', {name: '데모 보기'})).toHaveAttribute('href', '/demo/');
  await expect(page.getByRole('link', {name: '로그인'})).toHaveAttribute('href', '/app/');
});

test('desktop keeps canonical five tabs, target switching, custom target, and archive mode', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/demo/');
  await expect(page.getByText('근무 플래너', {exact: true})).toBeVisible();
  await expect(page.locator('.statusbar__chip', {hasText: '합성 데이터'})).toBeVisible({timeout: 30_000});

  for (const [key, label] of [['today', '오늘'], ['plan', '계획'], ['calendar', '달력'], ['analysis', '분석'], ['archive', '기록']] as const) {
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

test('daily-average target supports 8/9/10-hour presets, minute precision, and survives a fresh login URL', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/demo/?year=2042&month=3&tab=today');
  await page.locator('.switcher__trigger').click();
  const dialog = page.getByRole('dialog', {name: '전략 설정'});

  await expect(dialog.getByRole('button', {name: /일 평균 8시간/})).toBeVisible();
  await expect(dialog.getByRole('button', {name: /일 평균 9시간/})).toBeVisible();
  await expect(dialog.getByRole('button', {name: /일 평균 10시간/})).toBeVisible();
  await dialog.getByRole('button', {name: /일 평균 9시간/}).click();
  const workdayCount = await dialog.getByText(/근무일 \d+일 기준/).evaluate(element => Number(element.textContent?.match(/근무일 (\d+)일/)?.[1]));
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('target'))).toBe(9 * 60 * workdayCount);
  await page.getByRole('button', {name: '일 평균 1분 증가'}).click();
  await expect(dialog.getByText('9:01', {exact: true})).toBeVisible();
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('target'))).toBe((9 * 60 + 1) * workdayCount);
  const persistedTarget = new URL(page.url()).searchParams.get('target');
  expect(persistedTarget).not.toBeNull();
  await page.getByRole('button', {name: '보통 1분 증가'}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('normal')).toBe('501');

  await page.goto('/demo/?year=2042&month=3&tab=today');
  await page.locator('.switcher__trigger').click();
  const restored = page.getByRole('dialog', {name: '전략 설정'});
  await expect(restored.getByText('9:01', {exact: true})).toBeVisible();
  await expect(restored.getByText('8:21', {exact: true})).toBeVisible();
  expect(new URL(page.url()).searchParams.get('target')).toBe(persistedTarget);

  await restored.locator('.switcher__presets .switcher__preset').first().click();
  await expect.poll(() => new URL(page.url()).searchParams.get('daily')).toBeNull();
  await page.keyboard.press('Escape');

  await page.getByRole('button', {name: '다음 달'}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('target')).toBeNull();
  await page.getByRole('button', {name: '이전 달'}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('target')).not.toBeNull();
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
  await expect(dialog.locator('input[type="range"]')).toHaveCount(5);
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
      const aprilHeader = document.querySelector('.statusbar__nav')?.textContent?.includes('2042년 4월');
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
  await page.locator('.tabbar__item', {hasText: '달력'}).click();
  await expect(page.locator('.cal-tab')).toBeVisible();
  await page.locator('button.cal-cell:not([disabled]):visible').first().click();
  await expect(page.locator('.cal-detail')).toBeVisible();
  await page.locator('.switcher__trigger').click();
  const sheet = page.getByRole('dialog', {name: '전략 설정'});
  await expect(sheet.locator('input[type="range"]')).toHaveCount(5);
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
  await page.locator('.cal-cell--plan:visible').first().click();
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
  await expect(page.locator('.cal-metrics')).toContainText('15:03');
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
  await page.locator('button.cal-cell[data-date="2042-03-05"]:visible').click();
  await expect(page.getByRole('region', {name: '날짜 계획 편집'})).toBeVisible();
  await expect(page.getByRole('button', {name: '기본 500'})).toBeVisible();
  await expect(page.locator('.cal-detail .cal-hero__k')).toHaveText('계획');
});

for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 844}]) {
  test(`draft A insights, target progress and responsive shell ${viewport.width}`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.goto('/demo/?year=2042&month=3&tab=today');
    await expect(page.locator('.leave-now')).toContainText('지금 퇴근하면');
    await expect(page.locator('.leave-now')).toContainText('하루 +');
    const progress = page.locator('.target-progress');
    await expect(progress.getByRole('heading', {name: '목표별 진행'})).toBeVisible();
    await expect(progress.locator('.target-progress__row')).toHaveCount(4);
    await expect(progress).toContainText(/속도 \d+:\d{2}\/일 · 근무일 \d+\/\d+/);
    await expect(progress.locator('.target-progress__bar i')).toHaveCount(4);
    await expect(page.getByRole('radiogroup', {name: '목표 선택'}).getByRole('radio')).toHaveCount(4);
    await expect(page.getByRole('button', {name: '지금 수집', exact: true})).toHaveCount(0);
    const nav = page.locator(viewport.width < 1024 ? '.tabbar' : '.sidebar__nav');
    for (const label of ['오늘', '계획', '달력', '분석', '기록']) {
      await nav.getByRole('button', {name: label, exact: true}).click();
      await expect(page.locator('.content')).not.toBeEmpty();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), label).toBeLessThanOrEqual(0);
    }
    await nav.getByRole('button', {name: '분석', exact: true}).click();
    await expect(page.locator('.target-progress--detailed .target-progress__row')).toHaveCount(4);
    await expect(page.locator('.target-progress--detailed')).toContainText('공식');
    await expect(page.locator('.forecast-card')).toBeVisible();
    await expect(page.locator('.an-chart')).toBeVisible();
    await expect(page.locator('.an-cmp-row')).toHaveCount(4);
    await page.screenshot({path: `test-results/draft-a-analysis-${viewport.width}.png`, fullPage: true});
    await nav.getByRole('button', {name: '기록', exact: true}).click();
    await page.locator('button.rec-mrow', {hasText: '2월'}).click();
    await expect(nav.getByRole('button')).toHaveCount(2);
    await expect(page.locator('.switcher__trigger, .target-segments')).toHaveCount(0);
    await expect(page.locator('.archive-notice')).toContainText('읽기 전용 확정 기록');
  });
}

test('guard count and actionable details use server facts without all-clear noise', async ({page}) => {
  await page.route('**/demo/api/month?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.planner.insights.guards = [{key: 'weekly_max', level: 'risk', weekKey: '2042-03-03', label: '주간 상한 임박 · 50:00 / 52:00', minutes: 3000, limitMinutes: 3120}];
    await route.fulfill({response, body: JSON.stringify(body)});
  });
  await page.goto('/demo/?tab=today');
  await expect(page.locator('.guard-count')).toHaveText('제약 1건');
  await expect(page.locator('.guards')).toContainText('주간 상한 임박');
  await page.locator('.sidebar__item', {hasText: '계획'}).click();
  await expect(page.locator('.guards')).toContainText('50:00 / 52:00');
});

test('plan row what-if previews month impact and uses token for local save', async ({page}) => {
  let previewBody: Record<string, unknown> = {};
  await page.route('**/demo/api/planner/overrides**', async route => {
    const request = route.request().postDataJSON();
    previewBody = request;
    const response = await page.request.get('/demo/api/month?year=2042&month=3');
    const preview = await response.json();
    preview.planner.plan.plannedTotalMinutes = 123;
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({ok: true, preview, plannedTotalMinutes: 123, previewToken: 'what-if-token', gapMinutes: 0})});
  });
  await page.goto('/demo/?tab=plan');
  await page.getByRole('button', {name: '2042-03-05 가정 바꾸기'}).click();
  const panel = page.getByRole('region', {name: '날짜별 가정'});
  await expect(panel.getByRole('button', {name: '로컬 저장'})).toBeDisabled();
  await panel.getByRole('button', {name: /휴가 0/}).click();
  await expect(panel).toContainText('계획 합계 2:03');
  expect(previewBody.minutes).toBe(0);
  await panel.getByRole('button', {name: '로컬 저장'}).click();
  await expect(panel).toContainText('로컬 계획을 저장했습니다');
  expect(previewBody.previewToken).toBe('what-if-token');
  expect(previewBody.locked).toBe(true);
});

test('theme choices persist and URL history restores selected date and tab', async ({page}) => {
  await page.goto('/demo/?year=2042&month=3&tab=calendar&selectedDate=2042-03-05');
  await page.getByRole('radio', {name: '어둡게', exact: true}).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.locator('.sidebar__item', {hasText: '오늘'}).click();
  await page.goBack();
  await expect(page.locator('.cal-detail')).toContainText('3/5');
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('radio', {name: '밝게', exact: true}).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('demo explains unavailable what-if without inventing results', async ({page}) => {
  await page.goto('/demo/?tab=plan');
  await page.getByRole('button', {name: '2042-03-05 가정 바꾸기'}).click();
  const panel = page.getByRole('region', {name: '날짜별 가정'});
  await panel.getByRole('button', {name: /단축/}).click();
  await expect(panel).toContainText('데모에서는 미리보기·로컬 저장을 사용할 수 없습니다');
  await expect(panel.getByRole('button', {name: '로컬 저장'})).toBeDisabled();
  await expect(panel.locator('.what-if__impact')).toHaveCount(0);
});

test('non-workday recommends next workday and absent insights stay silent', async ({page}) => {
  await page.route('**/demo/api/month?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.days.find((day: {date: string}) => day.date === '2042-03-04').day_type = 'holiday';
    body.planner.insights = null;
    await route.fulfill({response, body: JSON.stringify(body)});
  });
  await page.goto('/demo/?tab=today');
  await expect(page.locator('.today-rest')).toContainText('오늘은 휴무');
  await expect(page.locator('.today-rest')).toContainText('다음 근무일');
  await expect(page.locator('.guards, .guard-count, .leave-now, .target-progress')).toHaveCount(0);
});

test('collection request discloses started, running, cooldown and unavailable', async ({page}) => {
  const response = await page.request.get('/demo/api/month?year=2042&month=3');
  const body = await response.json();
  body.sync = {lastSyncAt: '2042-03-04T00:00:00+09:00', stale: true};
  await page.route('**/app/**', async route => {
    const html = await page.request.get('/demo/');
    await route.fulfill({contentType: 'text/html', body: await html.text()});
  });
  await page.route('**/api/month?**', route => route.fulfill({contentType: 'application/json', body: JSON.stringify(body)}));
  await page.route('**/api/archive', route => route.fulfill({contentType: 'application/json', body: '{"months":[]}'}));
  let index = 0;
  const states = [{state: 'started'}, {state: 'running'}, {state: 'unavailable'}, {state: 'cooldown', retryAfterSeconds: 600}];
  await page.route('**/api/sync', route => {
    const result = states[index++];
    expect(route.request().method()).toBe('POST');
    return route.fulfill({status: result.state === 'unavailable' ? 503 : result.state === 'cooldown' ? 429 : 202, contentType: 'application/json', body: JSON.stringify(result)});
  });
  await page.goto('/app/?year=2042&month=3');
  const collect = page.getByRole('button', {name: '지금 수집'});
  for (const message of ['수집 시작됨', '수집 중', '수집 불가', '수집 대기']) {
    await collect.click();
    await expect(page.locator('.collect')).toContainText(message);
  }
  await expect(collect).toBeDisabled();
  await expect(page.locator('.collect')).toContainText(/599|600/);
});
