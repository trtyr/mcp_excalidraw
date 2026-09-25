import { test, expect } from '@playwright/test';

// Multi-canvas acceptance: /<scene> URL routing, REST isolation, WS room
// isolation and per-scene persistence. Network-level assertions only —
// the same philosophy as scene-reload.spec.mjs.

const SCENE = 'sceneA';

async function purgeScenes(request) {
  for (const name of [SCENE, 'sceneB']) {
    await request.delete(`/api/scenes/${name}?purge=1`).catch(() => {});
  }
  await request.post('/api/elements/sync', { data: { elements: [] } }).catch(() => {});
}

test.describe('multi-canvas', () => {
  let cleanupDone = false;
  test.beforeEach(async ({ request }) => {
    if (!cleanupDone) {
      await purgeScenes(request);
      cleanupDone = true;
    }
  });
  test.afterAll(async ({ request }) => {
    await purgeScenes(request);
  });

  test('SPA serves the frontend on /<scene>', async ({ page }) => {
    const resp = await page.goto(`/${SCENE}`);
    expect(resp.ok()).toBeTruthy();
    await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 15000 });
  });

  test('REST isolation: /api/s/<scene> vs default', async ({ request }) => {
    const create = await request.post(`/api/s/${SCENE}/elements`, {
      data: { type: 'rectangle', x: 0, y: 0, width: 5, height: 5 }
    });
    expect(create.ok()).toBeTruthy();

    const sceneRes = await request.get(`/api/s/${SCENE}/elements`);
    const scene = await sceneRes.json();
    expect(scene.count).toBe(1);
    expect(scene.elements[0].type).toBe('rectangle');

    const defRes = await request.get('/api/elements');
    const def = await defRes.json();
    expect(def.count).toBe(0);
  });

  test('WS room isolation: broadcasts stay inside their scene', async ({ browser, request }) => {
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();

    const wsTypesB = [];
    await pageB.routeWebSocket('**', socket => {
      const upstream = socket.connectToServer();
      upstream.onMessage(message => wsTypesB.push(JSON.parse(String(message)).type));
      socket.onMessage(m => upstream.send(m));
    });
    await pageB.goto('/'); // default scene
    await pageB.waitForResponse(r => r.url().endsWith('/api/elements') && r.request().method() === 'GET');

    // Broadcast into sceneA — page B (default room) must not hear it.
    await request.post(`/api/s/${SCENE}/elements`, {
      data: { type: 'rectangle', x: 1, y: 1, width: 2, height: 2 }
    });
    await pageB.waitForTimeout(700);
    expect(wsTypesB).not.toContain('element_created');

    // Broadcast into default — page B must hear it.
    await request.post('/api/elements', {
      data: { type: 'ellipse', x: 5, y: 5, width: 3, height: 3 }
    });
    await expect.poll(() => wsTypesB.includes('element_created'), { timeout: 5000 }).toBe(true);

    await ctxB.close();
  });

  test('per-scene persistence across reload', async ({ browser, request }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // After reload the scene may arrive via WS initial_elements — the HTTP
    // fallback is intentionally skipped when WS wins the race (App.tsx
    // sceneLoadStatus guard). Assert on the WS signal, not an HTTP request.
    let sawInitial = false;
    await page.routeWebSocket('**', socket => {
      const upstream = socket.connectToServer();
      upstream.onMessage(message => {
        if (JSON.parse(String(message)).type === 'initial_elements') sawInitial = true;
        socket.send(message);
      });
      socket.onMessage(m => upstream.send(m));
    });

    await page.goto(`/${SCENE}`);
    await expect.poll(() => sawInitial, { timeout: 10000 }).toBe(true);

    sawInitial = false;
    await page.reload();
    await expect.poll(() => sawInitial, { timeout: 10000 }).toBe(true);

    const res = await request.get(`/api/s/${SCENE}/elements`);
    const scene = await res.json();
    expect(scene.count).toBeGreaterThanOrEqual(1);
    await ctx.close();
  });
});
