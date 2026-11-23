import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { hashPassword } from '../src/auth/credentials.js';
import {
  cleanupE2eFixtures,
  createE2eDb,
  resetLocalRateLimits,
} from './helpers';

async function expectNoHorizontalOverflow(page: Page, contextLabel: string) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    metrics.scrollWidth,
    `Overflow horizontal detectado em ${contextLabel}: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`,
  ).toBeLessThanOrEqual(metrics.innerWidth);
}

async function expectMinTouchTarget(locator: Locator, label: string, minPx = 44) {
  await expect(locator, `Elemento "${label}" deveria estar visível`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `Bounding box ausente para "${label}"`).not.toBeNull();
  expect(
    box!.width,
    `Largura de "${label}" abaixo de ${minPx}px (${box!.width.toFixed(1)}px)`,
  ).toBeGreaterThanOrEqual(minPx - 0.5);
  expect(
    box!.height,
    `Altura de "${label}" abaixo de ${minPx}px (${box!.height.toFixed(1)}px)`,
  ).toBeGreaterThanOrEqual(minPx - 0.5);
}

async function expectDrawerInputsAtLeast16px(dialog: Locator, contextLabel: string) {
  const fields = dialog.locator('input, select, textarea');
  const count = await fields.count();
  expect(count, `Nenhum campo encontrado em ${contextLabel}`).toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const field = fields.nth(i);
    if (!(await field.isVisible())) continue;
    const { fontSize, id } = await field.evaluate((el) => ({
      fontSize: Number.parseFloat(window.getComputedStyle(el).fontSize),
      id: el.id || el.getAttribute('name') || el.tagName,
    }));
    expect(
      fontSize,
      `Campo "${id}" em ${contextLabel} com font-size=${fontSize}px (< 16px causa auto-zoom no iOS)`,
    ).toBeGreaterThanOrEqual(16);
  }
}

test.describe('Sistema Mesa — Fluxo Mobile (375x812, touch)', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });

  const runId = randomUUID().slice(0, 8);
  const eventTitle = `Noite Mobile ${runId}`;
  const eventSlug = `noite-mobile-${runId}`;
  const customerEmail = `mobile-e2e-${runId}@example.test`;
  const customerPassword = `SenhaMobile!${runId}2027`;

  test.beforeAll(async () => {
    await resetLocalRateLimits();
    const passwordHash = await hashPassword(customerPassword);
    const startsAt = new Date(Date.now() + 14 * 86_400_000);
    const endsAt = new Date(startsAt.getTime() + 6 * 3_600_000);

    const { db } = createE2eDb();
    try {
      await db.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            email: customerEmail,
            name: `Cliente Mobile ${runId}`,
            passwordHash,
            role: 'CUSTOMER',
            emailVerifiedAt: new Date(),
          },
        });

        const event = await tx.event.create({
          data: {
            slug: eventSlug,
            title: eventTitle,
            description: 'Evento para validação E2E mobile 375x812.',
            venue: 'Espaço Aurora Mobile',
            city: 'Curitiba',
            category: 'Música',
            displayMode: 'BOTH',
            currency: 'BRL',
            status: 'PUBLISHED',
            startsAt,
            endsAt,
          },
        });

        const sector = await tx.sector.create({
          data: {
            eventId: event.id,
            name: 'Camarote VIP',
            description: 'Área elevada com vista para o palco',
            basePriceMinor: 25_000,
          },
        });

        await tx.eventTable.createMany({
          data: [
            {
              eventId: event.id,
              sectorId: sector.id,
              label: 'M1',
              capacity: 4,
              priceMinor: 25_000,
              x: 32,
              y: 45,
            },
            {
              eventId: event.id,
              sectorId: sector.id,
              label: 'M2',
              capacity: 6,
              priceMinor: 35_000,
              x: 68,
              y: 55,
            },
          ],
        });
      });
    } finally {
      await db.$disconnect();
    }
  });

  test.afterAll(async () => {
    await cleanupE2eFixtures({
      eventSlugs: [eventSlug],
      userEmails: [customerEmail],
    });
  });

  test('Opção A no mapa, SelectionBar, ReservationLockModal, CheckoutDrawer sticky timer, overflow zero e ergonomia de toque', async ({
    page,
  }) => {
    // 1. Login via UI on mobile viewport
    await page.goto('/login');
    await page.locator('#login-email').fill(customerEmail);
    await page.locator('#login-password').fill(customerPassword);
    await page.getByRole('button', { name: 'Entrar', exact: true }).tap();
    await expect(page).toHaveURL(/\/$/);

    // 2. Open EventDetailPage in Map mode and verify live SSE + zero horizontal overflow
    await page.goto(`/eventos/${eventSlug}`);
    await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();
    await expect(page.getByText('Tempo real ativo')).toBeVisible();

    const sseStatusRegion = page.locator('[role="status"][aria-live="polite"]');
    await expect(sseStatusRegion).toHaveCount(1);

    await expectNoHorizontalOverflow(page, 'EventDetailPage');

    // Verify map HUD touch targets (>= 44x44px)
    await expectMinTouchTarget(
      page.getByRole('button', { name: 'Diminuir zoom' }),
      'Diminuir zoom',
    );
    await expectMinTouchTarget(
      page.getByRole('button', { name: 'Aumentar zoom' }),
      'Aumentar zoom',
    );
    await expectMinTouchTarget(
      page.getByRole('button', { name: 'Centralizar mapa' }),
      'Centralizar mapa',
    );

    // 3. Option A: tapping a table on InteractiveFloorMap opens Bottom Sheet WITHOUT selecting directly
    const m1Marker = page.getByRole('button', {
      name: /Mesa M1, setor Camarote VIP/,
    });
    await expectMinTouchTarget(m1Marker, 'Marcador Mesa M1');
    await m1Marker.tap();

    const bottomSheet = page.getByRole('dialog', { name: 'Detalhes da Mesa M1' });
    await expect(bottomSheet).toBeVisible();
    await expect(bottomSheet).toContainText('Setor Camarote VIP');
    await expect(bottomSheet).toContainText('R$ 250,00');

    // Must NOT have selected the table directly on first tap
    await expect(
      page.getByRole('button', { name: /Reservar e ir para checkout/ }),
    ).toBeHidden();
    await expect(m1Marker).toHaveAttribute('aria-pressed', 'false');

    // Verify Bottom Sheet primary CTA & close button touch targets (>= 44x44px)
    const selectTableBtn = bottomSheet.getByRole('button', {
      name: 'Selecionar mesa',
    });
    const closeSheetBtn = bottomSheet.getByRole('button', {
      name: 'Fechar detalhes da mesa',
    });
    await expectMinTouchTarget(selectTableBtn, 'Selecionar mesa (Bottom Sheet)');
    await expectMinTouchTarget(closeSheetBtn, 'Fechar detalhes da mesa');
    await expectNoHorizontalOverflow(page, 'EventDetailPage com Bottom Sheet');

    // 4. Tap "Selecionar mesa" -> closes Bottom Sheet and updates SelectionBar
    await selectTableBtn.tap();
    await expect(bottomSheet).toBeHidden();

    const proceedBtn = page.getByRole('button', {
      name: /Reservar e ir para checkout/,
    });
    await expectMinTouchTarget(proceedBtn, 'Reservar e ir para checkout');
    await expect(page.getByText('Mesa M1').first()).toBeVisible();
    await expect(page.getByText('R$ 250,00').first()).toBeVisible();
    await expectNoHorizontalOverflow(page, 'EventDetailPage com SelectionBar');

    // 5. Tap "Reservar e ir para checkout" -> opens ReservationLockModal
    const reserveResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith('/reservations') &&
        res.request().method() === 'POST',
    );
    await proceedBtn.tap();
    const reserveResponse = await reserveResponsePromise;
    expect(reserveResponse.status()).toBe(201);

    const lockDialog = page.getByRole('dialog');
    await expect(lockDialog).toBeVisible();
    await expect(lockDialog).toContainText('Mesa bloqueada com sucesso!');
    await expect(lockDialog.getByRole('timer')).toContainText(/\d{2}:\d{2}/);
    await expectNoHorizontalOverflow(page, 'ReservationLockModal');

    const payNowBtn = lockDialog.getByRole('button', { name: 'Pagar agora' });
    const closeLockBtn = lockDialog.getByRole('button', {
      name: 'Fechar resumo da reserva',
    });
    await expectMinTouchTarget(payNowBtn, 'Pagar agora (ReservationLockModal)');
    await expectMinTouchTarget(closeLockBtn, 'Fechar resumo da reserva');

    // 6. Tap "Pagar agora" -> opens CheckoutDrawer with sticky timer
    await payNowBtn.tap();

    const checkoutDialog = page.getByRole('dialog', { name: eventTitle });
    await expect(checkoutDialog).toBeVisible();
    await expectNoHorizontalOverflow(page, 'CheckoutDrawer (Pix form)');

    const stickyTimer = checkoutDialog.getByRole('timer');
    await expect(stickyTimer).toBeVisible();
    await expect(stickyTimer).toContainText(/\d{2}:\d{2}/);

    const closeCheckoutBtn = checkoutDialog.getByRole('button', {
      name: 'Fechar checkout',
    });
    const generatePixBtn = checkoutDialog.getByRole('button', {
      name: /Gerar QR Code Pix/,
    });
    await expectMinTouchTarget(closeCheckoutBtn, 'Fechar checkout');
    await expectMinTouchTarget(generatePixBtn, 'Gerar QR Code Pix');

    // Verify Pix input font-size >= 16px (prevents iOS Safari auto-zoom)
    await expectDrawerInputsAtLeast16px(checkoutDialog, 'CheckoutDrawer Pix');

    // 7. Switch to Credit Card tab -> verify all inputs >= 16px & sticky timer remains visible on scroll
    await checkoutDialog
      .getByRole('tab', { name: /Cartão de crédito/ })
      .tap();
    await expect(checkoutDialog.locator('#card-number')).toBeVisible();
    await expectNoHorizontalOverflow(page, 'CheckoutDrawer (Cartão de crédito)');
    await expectDrawerInputsAtLeast16px(
      checkoutDialog,
      'CheckoutDrawer Cartão de crédito',
    );
    await expectMinTouchTarget(
      checkoutDialog.getByRole('button', { name: /Pagar R\$/ }),
      'Pagar com cartão',
    );

    // Scroll drawer body to bottom and confirm sticky timer stays inside the viewport
    const timerBoxBeforeScroll = await stickyTimer.boundingBox();
    expect(timerBoxBeforeScroll).not.toBeNull();

    const scrolled = await checkoutDialog.evaluate((dialogEl) => {
      const scrollBody = dialogEl.querySelector('div.overflow-y-auto');
      if (!scrollBody) return false;
      scrollBody.scrollTop = scrollBody.scrollHeight;
      return scrollBody.scrollHeight > scrollBody.clientHeight;
    });
    expect(scrolled).toBe(true);

    await expect(stickyTimer).toBeVisible();
    const timerBoxAfterScroll = await stickyTimer.boundingBox();
    expect(timerBoxAfterScroll).not.toBeNull();
    expect(timerBoxAfterScroll!.y).toBeGreaterThanOrEqual(0);
    expect(timerBoxAfterScroll!.y + timerBoxAfterScroll!.height).toBeLessThanOrEqual(
      812,
    );
    expect(Math.abs(timerBoxAfterScroll!.y - timerBoxBeforeScroll!.y)).toBeLessThanOrEqual(
      2,
    );

    // 8. Switch back to Pix, generate QR Code, and verify #pix-copy-paste input is also >= 16px
    await checkoutDialog.getByRole('tab', { name: /Pix/ }).tap();
    const checkoutResponsePromise = page.waitForResponse(
      (res) =>
        /\/reservations\/[^/]+\/checkout$/.test(res.url()) &&
        res.request().method() === 'POST',
    );
    await generatePixBtn.tap();
    const checkoutRes = await checkoutResponsePromise;
    expect(checkoutRes.status()).toBe(201);

    await expect(checkoutDialog.locator('#pix-copy-paste')).toBeVisible();
    await expectDrawerInputsAtLeast16px(
      checkoutDialog,
      'CheckoutDrawer Pix gerado (#pix-copy-paste)',
    );
    await expectNoHorizontalOverflow(page, 'CheckoutDrawer (Pix gerado)');
    await expectMinTouchTarget(
      checkoutDialog.getByRole('button', { name: 'Copiar' }),
      'Copiar Pix',
    );
  });
});
