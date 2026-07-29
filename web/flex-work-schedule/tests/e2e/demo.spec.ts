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
  await expect(page.getByRole('button', {name: '500분 보통'})).toBeVisible();
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
