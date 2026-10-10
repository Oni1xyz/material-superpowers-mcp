// Fixed executable template. User input enters only via a JSON data declaration.
export const runnerSource = String.raw`
function assert(condition, message) { if (!condition) throw new Error(message); }
function requestSample(value) {
  try {
    const parsed = new URL(value);
    return (parsed.origin + parsed.pathname).slice(0, 256);
  } catch { return '[invalid URL]'; }
}
function reportError(error) {
  // Playwright navigation errors include the original URL in their call log.
  return String(error).replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/g, requestSample).slice(0, 2000);
}

// Playwright has no public unrouteWebSocket API. Keep exactly one fail-closed
// blocker per context, but detach all per-run recording state in finally.
// The caller owns this dedicated context and must close it after evaluation.
const socketGuards = new WeakMap();

export async function runGeneratedPlan(page, { url, AxeBuilder, screenshotPath } = {}) {
  // Metadata URL is deliberately NOT a navigation default. This runner is local-only.
  const destination = new URL(url);
  assert(destination.protocol === 'http:' && destination.hostname === '127.0.0.1' && !destination.username && !destination.password, 'Runner requires an explicit http://127.0.0.1 loopback fixture URL');
  const context = page.context();
  assert(typeof context.routeWebSocket === 'function', 'NETWORK-ISOLATION requires Playwright >= 1.48 with BrowserContext.routeWebSocket');
  let socketGuard = socketGuards.get(context);
  if (!socketGuard) {
    socketGuard = { active: null, ready: null };
    socketGuards.set(context, socketGuard);
    socketGuard.ready = context.routeWebSocket('**/*', async socket => {
      if (socketGuard.active) socketGuard.active(socket.url());
      // Never connectToServer: even same-origin sockets are prohibited.
      await socket.close();
    });
  }
  assert(socketGuard.active === null, 'NETWORK-ISOLATION requires sequential runs in a dedicated context');
  const blockedRequests = [];
  let blockedRequestCount = 0;
  let recording = true;
  const recordBlocked = value => {
    if (!recording) return;
    blockedRequestCount++;
    if (blockedRequests.length >= 100) return;
    // Never retain credentials, query strings or fragments. Bound every sample
    // as well as the shared HTTP/WebSocket sample count; paths can still be sensitive.
    blockedRequests.push(requestSample(value));
  };
  socketGuard.active = recordBlocked;
  const guard = async route => {
    const request = new URL(route.request().url());
    if (request.origin !== destination.origin) {
      recordBlocked(request.href);
      await route.abort('blockedbyclient');
      return;
    }
    // route.continue() only intercepts the first URL: browser redirects bypass
    // the hook. Fetch exactly one hop and reject ALL 3xx responses (including
    // same-origin redirects and 304); never give a redirect to the browser.
    let response;
    try {
      response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 10000 });
    } catch {
      // Fail closed on fetch/timeout errors, without logging URL-bearing errors.
      recordBlocked(request.href);
      await route.abort('blockedbyclient');
      return;
    }
    try {
      if (response.status() >= 300 && response.status() < 400) {
        recordBlocked(request.href);
        await route.abort('blockedbyclient');
      } else await route.fulfill({ response });
    } finally {
      await response.dispose();
    }
  };
  const results = [];
  const screenshots = [];
  const interactive = 'button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]';
  const openDialog = () => page.locator('[data-eval="open-dialog"]');
  const dialog = () => page.locator('dialog[data-eval="dialog"]');
  const effects = async () => {
    const value = await page.locator('[data-eval="side-effects"]').textContent();
    assert(value !== null && /^\d+$/.test(value.trim()), 'Side-effect counter must be a nonnegative integer');
    return Number(value);
  };
  const gates = {
    'A11Y-AXE': async () => {
      assert(AxeBuilder, 'Pass the @axe-core/playwright AxeBuilder constructor');
      const report = await new AxeBuilder({ page }).analyze();
      const violations = report.violations.filter(v => ['serious', 'critical'].includes(v.impact));
      assert(violations.length === 0, 'Serious/critical axe violations: ' + violations.map(v => v.id).join(', '));
      return { seriousCritical: violations.length, otherViolations: report.violations.map(v => ({ id: v.id, impact: v.impact })), incompleteRules: report.incomplete.map(v => v.id) };
    },
    'LAYOUT-OVERFLOW': async () => {
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
      assert(dimensions.content <= dimensions.width + 1, 'Horizontal overflow: ' + JSON.stringify(dimensions));
      return dimensions;
    },
    'KEYBOARD-FOCUS': async () => {
      const candidates = page.locator(interactive);
      let target;
      for (let i = 0; i < Math.min(await candidates.count(), 60); i++) {
        if (await candidates.nth(i).isVisible()) { target = candidates.nth(i); break; }
      }
      assert(target, 'No visible interactive control available to test');
      const style = el => {
        const s = getComputedStyle(el);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        // Let the browser resolve modern color spaces and slash/percentage alpha.
        // Invalid/unsupported canvas colors retain the previous fillStyle: two
        // sentinels distinguish that case from a successfully resolved color.
        const colorPixels = color => {
          if (!context || !CSS.supports('color', color)) return null;
          context.fillStyle = '#010203'; context.fillStyle = color;
          const first = context.fillStyle;
          context.fillStyle = '#040506'; context.fillStyle = color;
          if (first !== context.fillStyle) return null;
          context.clearRect(0, 0, 1, 1);
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        // Split only at top-level separators, never commas/spaces inside a color.
        const split = (value, separator) => {
          const parts = []; let depth = 0; let start = 0;
          for (let i = 0; i < value.length; i++) {
            if (value[i] === '(') depth++;
            if (value[i] === ')' && --depth < 0) return null;
            if (depth === 0 && separator.test(value[i])) {
              if (value.slice(start, i).trim()) parts.push(value.slice(start, i).trim());
              start = i + 1;
            }
          }
          if (depth !== 0) return null;
          if (value.slice(start).trim()) parts.push(value.slice(start).trim());
          return parts;
        };
        const visibleShadows = value => {
          if (value === 'none') return [];
          const layers = split(value, /,/);
          if (!layers || !layers.length) return null;
          const visible = [];
          for (const layer of layers) {
            const tokens = split(layer, /\s/);
            // Inset and negative-spread geometry need a separate paint/occlusion
            // review. Unsupported evidence must never be treated as a pass.
            if (!tokens || tokens.includes('inset')) return null;
            const lengths = tokens.filter(t => /^-?(?:\d+(?:\.\d*)?|\.\d+)px$/.test(t));
            const colors = tokens.filter(t => !lengths.includes(t));
            if (lengths.length !== 4 || colors.length !== 1) return null;
            const [x, y, blur, spread] = lengths.map(parseFloat);
            const rgba = colorPixels(colors[0]);
            if (!rgba || blur < 0) return null;
            if (rgba[3] === 0) continue;
            if (spread < 0) return null;
            // A zero-offset/blur/spread outer shadow is concealed by the box.
            if (x === 0 && y === 0 && blur === 0 && spread === 0) continue;
            visible.push({ x, y, blur, spread, rgba });
          }
          return visible;
        };
        const width = parseFloat(s.outlineWidth);
        const rgba = colorPixels(s.outlineColor);
        const visibleOutline = !rgba ? null : width >= 1 && !['none', 'hidden'].includes(s.outlineStyle) && rgba[3] > 0
          ? { width, kind: s.outlineStyle, offset: s.outlineOffset, rgba } : false;
        return { outline: s.outline, width, kind: s.outlineStyle, color: s.outlineColor, shadow: s.boxShadow, visibleOutline, visibleShadows: visibleShadows(s.boxShadow) };
      };
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      const before = await target.evaluate(style);
      let reached = false;
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab');
        if (await target.evaluate(el => el === document.activeElement)) { reached = true; break; }
      }
      assert(reached, 'First visible control is not keyboard reachable');
      // Allow finite focus transitions to settle before taking computed-style evidence.
      await page.waitForTimeout(200);
      const after = await target.evaluate(style);
      const outlineChanged = before.visibleOutline !== null && after.visibleOutline && JSON.stringify(before.visibleOutline) !== JSON.stringify(after.visibleOutline);
      const shadowChanged = before.visibleShadows !== null && after.visibleShadows && after.visibleShadows.length > 0 && JSON.stringify(before.visibleShadows) !== JSON.stringify(after.visibleShadows);
      assert(outlineChanged || shadowChanged, 'Keyboard focus produced no measurable visible outline/shadow change; unsupported colors or shadow geometry require manual review');
      return { scope: 'First visible interactive control; contrast, occlusion and other controls require manual review', before, after };
    },
    'MOTION-REDUCED': async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const result = await page.evaluate(() => {
        const seconds = value => value.split(',').map(v => parseFloat(v) * (v.trim().endsWith('ms') ? .001 : 1));
        const offenders = [...document.querySelectorAll('*')].filter(el => {
          const s = getComputedStyle(el);
          return (s.animationName !== 'none' && seconds(s.animationDuration).some(n => n > .01)) || seconds(s.transitionDuration).some(n => n > .01) || s.scrollBehavior === 'smooth';
        });
        return { preference: matchMedia('(prefers-reduced-motion: reduce)').matches, offenders: offenders.slice(0, 10).map(el => el.tagName + (el.id ? '#' + el.id : '')), count: offenders.length };
      });
      assert(result.preference && result.count === 0, 'Reduced-motion project policy violated: ' + JSON.stringify(result));
      return result;
    },
    'DIALOG-ESCAPE': async () => {
      await openDialog().focus();
      await openDialog().click();
      assert(await dialog().isVisible(), 'Dialog did not open');
      assert(await dialog().evaluate(el => el.contains(document.activeElement)), 'Opening dialog did not move focus inside');
      await page.keyboard.press('Escape');
      assert(!(await dialog().isVisible()), 'Escape did not close dialog');
      assert(await openDialog().evaluate(el => el === document.activeElement), 'Dialog did not return focus to opener');
      return { opened: true, focusEntered: true, escapeClosed: true, focusReturned: true };
    },
    'RISK-CONFIRM': async () => {
      const before = await effects();
      await openDialog().click();
      assert(await effects() === before, 'Opening confirmation caused a side effect');
      const confirm = page.locator('[data-eval="confirm"]');
      assert(await confirm.isVisible() && await confirm.isEnabled(), 'An explicit enabled confirmation control is required');
      await confirm.click();
      assert(await effects() === before + 1, 'Explicit confirmation must produce exactly one recorded fixture action');
      assert(!(await dialog().isVisible()), 'Confirmation must close the fixture dialog');
      return { before, after: await effects(), scope: 'Instrumented fixture action, not a production backend audit' };
    },
    'RISK-CANCEL': async () => {
      const before = await effects();
      await openDialog().click();
      await page.locator('[data-eval="cancel"]').click();
      assert(!(await dialog().isVisible()), 'Cancel did not close dialog');
      assert(await effects() === before, 'Cancellation changed the side-effect counter');
      assert(await openDialog().evaluate(el => el === document.activeElement), 'Cancellation did not restore focus');
      return { before, after: await effects(), closed: true, focusReturned: true };
    },
    'RISK-NO-SIDE-EFFECTS': async () => {
      const before = await effects();
      await openDialog().click();
      assert(await effects() === before, 'Opening dialog changed side effects');
      await page.keyboard.press('Escape');
      assert(!(await dialog().isVisible()), 'Escape must dismiss confirmation');
      assert(await effects() === before, 'Dismissing without confirmation changed side effects');
      return { before, after: await effects(), scope: 'Instrumented side-effect counter only; real persistence/network review remains manual' };
    },
  };
  try {
    // Both guards must be ready before the first fixture navigation.
    await socketGuard.ready;
    await context.route('**/*', guard);
    for (const viewport of specification.breakpoints) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const check of specification.checks.filter(c => c.execution === 'runnable')) {
        try {
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          await page.goto(destination.href, { waitUntil: 'networkidle', timeout: 15000 });
          assert(page.url().startsWith(destination.origin + '/'), 'Navigation escaped fixture origin');
          assert(gates[check.id], 'No assertion implementation for ' + check.id);
          const evidence = await gates[check.id]();
          results.push({ id: check.id, breakpoint: viewport.name, status: 'passed', evidence });
        } catch (error) {
          results.push({ id: check.id, breakpoint: viewport.name, status: 'failed', error: reportError(error) });
        }
      }
      if (screenshotPath) {
        await page.goto(destination.href, { waitUntil: 'networkidle', timeout: 15000 });
        const path = screenshotPath(viewport.name);
        await page.screenshot({ path, fullPage: true, animations: 'disabled' });
        screenshots.push({ breakpoint: viewport.name, path, status: 'captured-not-compared', baseline: null });
      }
    }
    if (blockedRequestCount) results.push({ id: 'NETWORK-ISOLATION', status: 'failed', blockedRequests, blockedRequestCount, omittedBlockedRequestCount: blockedRequestCount - blockedRequests.length });
    return {
      status: results.some(r => r.status === 'failed') ? 'failed' : 'automated-checks-passed-manual-outstanding',
      results,
      manual: specification.checks.filter(c => c.execution === 'manual').map(c => ({ ...c, status: 'outstanding' })),
      screenshots,
      limitations: specification.limitations,
    };
  } finally {
    recording = false;
    socketGuard.active = null;
    await context.unroute('**/*', guard);
  }
}
`;
