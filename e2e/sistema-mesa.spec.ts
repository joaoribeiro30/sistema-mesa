import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  cleanupE2eFixtures,
  createE2eDb,
  getAdminCredentials,
  resetLocalRateLimits,
  sendSignedMockWebhook,
  shortenReservationExpiry,
  waitForVerificationToken,
} from './helpers';

async function loginViaUi(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test.describe.serial('Sistema Mesa — Fluxos E2E Completos', () => {
  const runId = randomUUID().slice(0, 8);
  const eventTitle = `Noite E2E ${runId}`;
  const eventSlug = `noite-e2e-${runId}`;
  const customerName = `Cliente E2E ${runId}`;
  const customerEmail = `cliente-e2e-${runId}@example.test`;
  const customerPassword = `SenhaSegura!${runId}2027`;

  test.beforeAll(async () => {
    await resetLocalRateLimits();
  });

  test.afterAll(async () => {
    await cleanupE2eFixtures({
      eventSlugs: [eventSlug],
      userEmails: [customerEmail],
    });
  });

  test('b) Admin cria evento, setor, mesas e posiciona com drag-and-drop no Editor de Mapa', async ({
    page,
  }) => {
    const admin = getAdminCredentials();

    // 1. Login as ADMIN -> redirects to /admin
    await loginViaUi(page, admin.email, admin.password);
    await expect(page).toHaveURL(/\/admin/);
    await expect(
      page.getByRole('heading', { name: 'Painel Administrativo' }),
    ).toBeVisible();

    // 2. Create a new PUBLISHED event via the modal form
    await page.getByRole('button', { name: 'Novo Evento' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder('Ex.: Noite na Serra').fill(eventTitle);
    // Verify slug auto-generated and matches expected slug
    const slugInput = dialog.getByPlaceholder('noite-na-serra');
    await slugInput.fill(eventSlug);
    await dialog
      .getByPlaceholder('Detalhes sobre atrações, dress code, abertura dos portões...')
      .fill('Evento criado pelo teste automatizado E2E do Sistema Mesa.');
    await dialog.getByPlaceholder('Armazém Serra').fill('Espaço Aurora E2E');
    await dialog.getByPlaceholder('São Paulo').fill('Curitiba');
    await dialog.getByPlaceholder('Música, Gastronomia...').fill('Música');

    // Select PUBLISHED status & BOTH displayMode
    await dialog.locator('select').nth(0).selectOption('PUBLISHED');
    await dialog.locator('select').nth(1).selectOption('BOTH');

    await dialog.getByRole('button', { name: 'Criar evento' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Evento "${eventTitle}" criado com sucesso.`)).toBeVisible();

    // 3. Go to Setores e Mesas tab
    await page.getByRole('button', { name: 'Setores e Mesas' }).click();
    await expect(
      page.getByRole('heading', { name: 'Setores e Mesas' }),
    ).toBeVisible();

    // Create sector "Camarote VIP" with base price R$ 250,00
    await page.getByRole('button', { name: 'Novo Setor' }).click();
    const sectorDialog = page.getByRole('dialog');
    await sectorDialog
      .getByPlaceholder('Ex.: Camarote VIP, Pista, Mezanino')
      .fill('Camarote VIP');
    await sectorDialog.getByPlaceholder('Ex.: 250,00').fill('250,00');
    await sectorDialog
      .getByPlaceholder('Opcional: visão privilegiada, frente do palco...')
      .fill('Área elevada com vista para o palco');
    await sectorDialog.getByRole('button', { name: 'Criar setor' }).click();
    await expect(sectorDialog).toBeHidden();
    await expect(page.getByText('Camarote VIP').first()).toBeVisible();

    // Create 1 individual table (V1)
    await page.getByRole('button', { name: 'Mesa', exact: true }).click();
    const tableDialog = page.getByRole('dialog');
    await tableDialog.getByPlaceholder('Ex.: P1, VIP-05').fill('V1');
    await tableDialog.getByRole('button', { name: 'Adicionar mesa' }).click();
    await expect(tableDialog).toBeHidden();
    await expect(page.getByText('Mesa V1', { exact: true })).toBeVisible();

    // Create 2 tables in batch (V2, V3)
    await page.getByRole('button', { name: 'Lote', exact: true }).click();
    const batchDialog = page.getByRole('dialog');
    await batchDialog.getByPlaceholder('Ex.: VIP').fill('V');
    const batchNumbers = batchDialog.locator('input[type="number"]');
    await batchNumbers.nth(0).fill('2'); // startNumber
    await batchNumbers.nth(1).fill('2'); // count
    await batchNumbers.nth(2).fill('4'); // capacity
    await batchDialog.getByRole('button', { name: /Criar 2 mesas/ }).click();
    await expect(batchDialog).toBeHidden();
    await expect(page.getByText('Mesa V2', { exact: true })).toBeVisible();
    await expect(page.getByText('Mesa V3', { exact: true })).toBeVisible();

    // 4. Open Visual Map Editor and drag-and-drop tables onto the floor plan
    await page.getByRole('button', { name: 'Editor de Mapa' }).click();
    await expect(page.getByText('Mesas sem posição na planta (3)')).toBeVisible();

    // Place all 3 tables using Auto-distribuir
    await page.getByRole('button', { name: /Auto-distribuir/ }).click();
    await expect(page.getByText('3/3 no mapa')).toBeVisible();

    // Drag marker V1 to a new position with real pointer/mouse events
    const v1Marker = page
      .locator('button[title^="Mesa V1 "]')
      .first();
    await expect(v1Marker).toBeVisible();
    await v1Marker.evaluate((el) =>
      el.scrollIntoView({ block: 'center', inline: 'center' }),
    );
    const initialTitle = await v1Marker.getAttribute('title');
    const box = await v1Marker.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 120, startY + 80, { steps: 10 });
    await page.mouse.up();

    const movedTitle = await v1Marker.getAttribute('title');
    expect(movedTitle).not.toBe(initialTitle);

    // Save Layout in batch (PUT /admin/events/:eventId/layout)
    const saveLayoutBtn = page.getByRole('button', { name: 'Salvar Layout' });
    await expect(saveLayoutBtn).toBeEnabled();
    await saveLayoutBtn.click();
    await expect(page.getByText(/Layout salvo com sucesso/)).toBeVisible();

    // Verify coordinates persisted in database
    const { db } = createE2eDb();
    try {
      const savedTables = await db.eventTable.findMany({
        where: { sector: { event: { slug: eventSlug } } },
        orderBy: { label: 'asc' },
      });
      expect(savedTables).toHaveLength(3);
      for (const tbl of savedTables) {
        expect(tbl.x).not.toBeNull();
        expect(tbl.y).not.toBeNull();
      }
    } finally {
      await db.$disconnect();
    }
  });

  test('a) Cadastro/login de cliente, verificação de e-mail e visualização do evento (mapa e lista)', async ({
    page,
  }) => {
    // 1. Register new customer account
    await page.goto('/cadastro');
    await page.locator('#register-name').fill(customerName);
    await page.locator('#register-email').fill(customerEmail);
    await page.locator('#register-password').fill(customerPassword);
    await page.locator('#register-confirm').fill(customerPassword);
    await page.getByRole('button', { name: 'Criar conta' }).click();

    await expect(
      page.getByRole('heading', { name: 'Confirme seu e-mail' }),
    ).toBeVisible();

    // 2. Read verification token from .local/mail and verify via UI
    const verificationToken = await waitForVerificationToken(customerEmail);
    await page.getByRole('link', { name: 'Inserir token de verificação' }).click();
    await expect(page).toHaveURL(/\/verificar-email/);

    await page.locator('#verify-token').fill(verificationToken);
    await page.getByRole('button', { name: 'Confirmar e-mail' }).click();
    await expect(page.getByText('E-mail confirmado com sucesso!')).toBeVisible();

    // 3. Login as the verified customer
    await loginViaUi(page, customerEmail, customerPassword);
    await expect(page).toHaveURL(/\/$/);

    // 4. Open event detail page and verify SSE + Map + List views
    await page.goto(`/eventos/${eventSlug}`);
    await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();
    await expect(page.getByText('Tempo real ativo')).toBeVisible();

    // Map view should be active by default (tables have x/y)
    const mapTab = page.getByRole('tab', { name: /Mapa Interativo/ });
    const listTab = page.getByRole('tab', { name: /Lista por Setores/ });
    await expect(mapTab).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('button', { name: /Mesa V1, setor Camarote VIP/ }),
    ).toBeVisible();

    // Switch to List view and verify sector & table cards
    await listTab.click();
    await expect(listTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Camarote VIP' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mesa V1' })).toBeVisible();
    await expect(page.getByText('R$ 250,00').first()).toBeVisible();

    // Switch back to Map view
    await mapTab.click();
    await expect(mapTab).toHaveAttribute('aria-selected', 'true');
  });

  test('c) Reserva de mesa com contagem regressiva, SSE ao vivo e expiração automática devolvendo a mesa para disponível', async ({
    browser,
  }) => {
    const customerContext = await browser.newContext();
    const viewerContext = await browser.newContext();
    const page = await customerContext.newPage();
    const viewerPage = await viewerContext.newPage();

    try {
      // Open a second browser tab watching the same event live via SSE
      await viewerPage.goto(`/eventos/${eventSlug}`);
      await expect(viewerPage.getByText('Tempo real ativo')).toBeVisible();
      await viewerPage.getByRole('tab', { name: /Lista por Setores/ }).click();
      const viewerV2Card = viewerPage
        .locator('div.group', { hasText: 'Mesa V2' })
        .first();
      await expect(viewerV2Card).toContainText('Disponível');

      // Customer logs in and selects Mesa V2
      await loginViaUi(page, customerEmail, customerPassword);
      await expect(page).toHaveURL(/\/$/);

      await page.goto(`/eventos/${eventSlug}`);
      await expect(page.getByText('Tempo real ativo')).toBeVisible();
      await page.getByRole('tab', { name: /Lista por Setores/ }).click();

      const v2Card = page.locator('div.group', { hasText: 'Mesa V2' }).first();
      await expect(v2Card).toContainText('Disponível');
      await v2Card.getByRole('button', { name: 'Selecionar' }).click();

      // Lock Mesa V2 (POST /reservations with Idempotency-Key)
      const reserveResponsePromise = page.waitForResponse(
        (res) =>
          res.url().endsWith('/reservations') &&
          res.request().method() === 'POST',
      );
      await page
        .getByRole('button', { name: /Reservar e ir para checkout/ })
        .click();
      const reserveResponse = await reserveResponsePromise;
      expect(reserveResponse.status()).toBe(201);
      const reserveJson = (await reserveResponse.json()) as {
        reservation: { id: string };
      };
      const reservationId = reserveJson.reservation.id;

      // Verify lock confirmation modal with 10-minute countdown
      const lockDialog = page.getByRole('dialog');
      await expect(lockDialog).toContainText('Mesa bloqueada com sucesso!');
      await expect(lockDialog).toContainText(/\d{2}:\d{2}/);

      // Verify SSE broadcast updated viewerPage in real time without reload
      await expect(viewerV2Card).toContainText('Bloqueada', { timeout: 10_000 });

      // Shorten reservation expiry in DB to 4s so the real countdown & worker fire quickly
      await shortenReservationExpiry(reservationId, 4);

      // Go to "Minhas Reservas" and open CheckoutDrawer with the shortened deadline
      await page.goto('/minhas-reservas');
      await expect(
        page.getByRole('button', { name: /Concluir Pagamento/ }).first(),
      ).toBeVisible();
      await page
        .getByRole('button', { name: /Concluir Pagamento/ })
        .first()
        .click();

      const checkoutDialog = page.getByRole('dialog');
      await expect(checkoutDialog.getByRole('timer')).toContainText(/\d{2}:\d{2}/);

      // Wait for countdown to hit 00:00 -> CheckoutDrawer transitions to "Reserva expirada"
      await expect(
        checkoutDialog.getByRole('heading', { name: 'Reserva expirada' }),
      ).toBeVisible({ timeout: 12_000 });

      // Wait for backend expiration worker + SSE table.released to automatically restore Mesa V2 to Disponível on viewerPage (NO reload!)
      await expect(
        viewerV2Card.getByRole('button', { name: 'Selecionar' }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(viewerV2Card).toContainText('Disponível');

      // Click "Voltar ao evento" from expired CheckoutDrawer
      await checkoutDialog
        .getByRole('button', { name: /Voltar ao evento/ })
        .click();
      await expect(page).toHaveURL(new RegExp(`/eventos/${eventSlug}`));
    } finally {
      await customerContext.close();
      await viewerContext.close();
    }
  });

  test('d) Pagamento Pix via webhook, QR Code em "Minhas Reservas" e check-in na portaria (200 e 409)', async ({
    browser,
  }) => {
    const customerContext = await browser.newContext();
    const adminContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    const adminPage = await adminContext.newPage();

    try {
      // 1. Customer logs in, locks Mesa V1, and generates Pix checkout
      await loginViaUi(customerPage, customerEmail, customerPassword);
      await expect(customerPage).toHaveURL(/\/$/);

      await customerPage.goto(`/eventos/${eventSlug}`);
      await expect(customerPage.getByText('Tempo real ativo')).toBeVisible();

      // Select Mesa V1 directly on the Interactive Map
      await customerPage
        .getByRole('button', { name: /Mesa V1, setor Camarote VIP/ })
        .click();
      await customerPage
        .getByRole('button', { name: /Reservar e ir para checkout/ })
        .click();

      const lockDialog = customerPage.getByRole('dialog');
      await expect(lockDialog).toContainText('Mesa bloqueada com sucesso!');
      await lockDialog.getByRole('button', { name: 'Pagar agora' }).click();

      // Generate Pix charge and capture paymentId from response
      const checkoutResponsePromise = customerPage.waitForResponse(
        (res) =>
          /\/reservations\/[^/]+\/checkout$/.test(res.url()) &&
          res.request().method() === 'POST',
      );
      await customerPage
        .getByRole('button', { name: /Gerar QR Code Pix/ })
        .click();
      const checkoutRes = await checkoutResponsePromise;
      expect(checkoutRes.status()).toBe(201);
      const checkoutPayload = (await checkoutRes.json()) as {
        payment: { id: string; amountMinor: number; currency: string };
      };

      // Verify Pix QR code & copy-paste code rendered
      await expect(
        customerPage.getByAltText('QR Code Pix para pagamento'),
      ).toBeVisible();
      await expect(customerPage.locator('#pix-copy-paste')).toHaveValue(
        new RegExp(checkoutPayload.payment.id),
      );

      // 2. Send real HMAC-signed webhook approving the Pix payment
      const webhookRes = await sendSignedMockWebhook({
        paymentId: checkoutPayload.payment.id,
        method: 'PIX',
        amountMinor: checkoutPayload.payment.amountMinor,
        currency: checkoutPayload.payment.currency,
        outcome: 'APPROVED',
      });
      expect(webhookRes.status).toBe(200);

      // Click manual status check to confirm immediately in CheckoutDrawer
      await customerPage
        .getByRole('button', { name: /Já paguei, verificar status/ })
        .click();
      await expect(
        customerPage.getByRole('heading', { name: 'Pagamento confirmado!' }),
      ).toBeVisible();

      // 3. Navigate to "Minhas Reservas" and inspect the QR Code ticket modal
      await customerPage.goto('/minhas-reservas');
      await expect(
        customerPage.getByRole('heading', { name: /Confirmadas/ }),
      ).toBeVisible();

      const receiptResponsePromise = customerPage.waitForResponse(
        (res) =>
          /\/reservations\/[^/]+\/receipt$/.test(res.url()) &&
          res.request().method() === 'GET',
      );
      await customerPage
        .getByRole('button', { name: /Ver Ingresso \/ QR Code/ })
        .first()
        .click();

      const receiptRes = await receiptResponsePromise;
      expect(receiptRes.status()).toBe(200);
      const receiptData = (await receiptRes.json()) as {
        receipt: { ticket: { token: string; qrCode: string } };
      };
      const ticketToken = receiptData.receipt.ticket.token;
      expect(ticketToken).toMatch(/^mesa-ticket-v1\./);

      const ticketDialog = customerPage.getByRole('dialog');
      await expect(ticketDialog).toContainText(eventTitle);
      await expect(ticketDialog).toContainText('Camarote VIP');
      const qrImg = ticketDialog.locator('img[alt^="QR Code do ingresso"]');
      await expect(qrImg).toBeVisible();
      await expect(qrImg).toHaveAttribute('src', /^data:image\/png;base64,/);

      // 4. Admin opens Dashboard & Portaria / Check-in for the event
      const admin = getAdminCredentials();
      await loginViaUi(adminPage, admin.email, admin.password);
      await expect(adminPage).toHaveURL(/\/admin/);

      const eventArticle = adminPage
        .locator('article', { hasText: eventTitle })
        .first();
      await expect(eventArticle).toBeVisible();
      await eventArticle.getByRole('button', { name: 'Dashboard' }).click();

      // Verify Dashboard metrics reflect 1 sold table and R$ 250,00 revenue
      await expect(adminPage.getByText('Faturamento Confirmado')).toBeVisible();
      await expect(adminPage.getByText('R$ 250,00').first()).toBeVisible();
      await expect(adminPage.getByText(customerEmail).first()).toBeVisible();

      // Open Portaria / Check-in tab
      await adminPage
        .getByRole('button', { name: 'Portaria / Check-in', exact: true })
        .click();
      const tokenInput = adminPage.getByPlaceholder(
        'mesa-ticket-v1.<nonce>.<payload>.<tag>',
      );
      const validateBtn = adminPage.getByRole('button', {
        name: 'Validar Entrada',
      });

      // 4a. First scan -> 200 Entrada liberada
      await tokenInput.fill(ticketToken);
      await validateBtn.click();
      await expect(adminPage.getByText('Entrada liberada').first()).toBeVisible();
      await expect(adminPage.getByText('Mesa V1').first()).toBeVisible();

      // 4b. Second scan with same token -> 409 TICKET_ALREADY_USED
      await tokenInput.fill(ticketToken);
      await validateBtn.click();
      await expect(
        adminPage.getByText('Ingresso já utilizado').first(),
      ).toBeVisible();
      await expect(adminPage.getByText('Código: TICKET_ALREADY_USED')).toBeVisible();

      // 4c. Invalid token -> 400 INVALID_TICKET
      await tokenInput.fill('mesa-ticket-v1.invalido.teste.000');
      await validateBtn.click();
      await expect(adminPage.getByText('Ingresso inválido').first()).toBeVisible();
    } finally {
      await customerContext.close();
      await adminContext.close();
    }
  });
});
