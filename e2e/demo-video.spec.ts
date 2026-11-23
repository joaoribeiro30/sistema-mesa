import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { hashPassword } from '../src/auth/credentials.js';
import {
  cleanupE2eFixtures,
  createE2eDb,
  getAdminCredentials,
  resetLocalRateLimits,
  sendSignedMockWebhook,
} from './helpers';

const DEMO_BASE_URL = 'http://localhost:5173';
const DEMO_VIDEO_OUTPUT = resolve(
  process.cwd(),
  'test-results',
  'demo-sistema-mesa.webm',
);

test.use({
  baseURL: DEMO_BASE_URL,
  viewport: { width: 1280, height: 720 },
  colorScheme: 'dark',
  video: {
    mode: 'on',
    size: { width: 1280, height: 720 },
  },
  launchOptions: {
    slowMo: 900,
  },
});

const INITIAL_AURORA_COORDS: Record<string, { x: number; y: number }> = {
  P01: { x: 25, y: 42 },
  P02: { x: 50, y: 42 },
  P03: { x: 75, y: 42 },
  T01: { x: 35, y: 72 },
  T02: { x: 65, y: 72 },
};

/**
 * Injects a crisp animated presentation cursor (pointer arrow + soft accent halo)
 * and a click ripple wave that follows `mousemove` and `mousedown` events.
 */
async function installVisualCursor(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mesa-theme', 'dark');
    } catch {
      // Ignore storage errors
    }

    const mountCursor = () => {
      if (document.getElementById('mesa-demo-cursor-root')) return;

      const style = document.createElement('style');
      style.id = 'mesa-demo-cursor-style';
      style.textContent = `
        #mesa-demo-cursor-root {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 2147483647;
          overflow: hidden;
        }
        #mesa-demo-cursor {
          position: fixed;
          top: 0;
          left: 0;
          width: 28px;
          height: 28px;
          transform: translate3d(-100px, -100px, 0);
          transition: opacity 150ms ease;
          will-change: transform;
          filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.65)) drop-shadow(0 0 8px rgba(255, 51, 102, 0.45));
        }
        #mesa-demo-cursor-inner {
          position: relative;
          width: 28px;
          height: 28px;
          transform-origin: 3px 3px;
          transition: transform 110ms cubic-bezier(0.2, 0.9, 0.3, 1);
        }
        #mesa-demo-cursor.is-pressed #mesa-demo-cursor-inner {
          transform: scale(0.84);
        }
        #mesa-demo-cursor-dot {
          position: absolute;
          top: -6px;
          left: -6px;
          width: 14px;
          height: 14px;
          border-radius: 9999px;
          background: rgba(255, 51, 102, 0.28);
          border: 1.5px solid rgba(255, 51, 102, 0.7);
        }
        .mesa-demo-ripple {
          position: fixed;
          width: 18px;
          height: 18px;
          margin-left: -9px;
          margin-top: -9px;
          border-radius: 9999px;
          border: 2.5px solid #ff3366;
          background: rgba(255, 51, 102, 0.24);
          box-shadow: 0 0 18px rgba(255, 51, 102, 0.55);
          pointer-events: none;
          animation: mesa-demo-ripple-expand 540ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes mesa-demo-ripple-expand {
          0% {
            transform: scale(0.5);
            opacity: 0.95;
          }
          100% {
            transform: scale(3.2);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);

      const root = document.createElement('div');
      root.id = 'mesa-demo-cursor-root';

      const cursor = document.createElement('div');
      cursor.id = 'mesa-demo-cursor';
      cursor.innerHTML = `
        <div id="mesa-demo-cursor-inner">
          <div id="mesa-demo-cursor-dot"></div>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3.5 2.5L20 11.2L12.6 13.3L9.4 20.5L3.5 2.5Z" fill="#ffffff" stroke="#0b0b10" stroke-width="1.8" stroke-linejoin="round"/>
          </svg>
        </div>
      `;

      root.appendChild(cursor);
      document.body.appendChild(root);

      const moveCursor = (x: number, y: number) => {
        cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      };

      const spawnRipple = (x: number, y: number) => {
        const ripple = document.createElement('div');
        ripple.className = 'mesa-demo-ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        root.appendChild(ripple);
        window.setTimeout(() => ripple.remove(), 580);
      };

      window.addEventListener(
        'mousemove',
        (e) => moveCursor(e.clientX, e.clientY),
        { passive: true, capture: true },
      );
      window.addEventListener(
        'pointermove',
        (e) => moveCursor(e.clientX, e.clientY),
        { passive: true, capture: true },
      );
      window.addEventListener(
        'mousedown',
        (e) => {
          moveCursor(e.clientX, e.clientY);
          cursor.classList.add('is-pressed');
          spawnRipple(e.clientX, e.clientY);
        },
        { passive: true, capture: true },
      );
      window.addEventListener(
        'mouseup',
        () => cursor.classList.remove('is-pressed'),
        { passive: true, capture: true },
      );
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountCursor, { once: true });
    } else {
      mountCursor();
    }
  });
}

/**
 * Smoothly scrolls `locator` into center view and glides the visual cursor to its center.
 */
async function humanMove(
  page: Page,
  locator: Locator,
  steps = 35,
): Promise<{ x: number; y: number }> {
  await expect(locator).toBeVisible();
  await locator.evaluate((el) =>
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }),
  );
  await page.waitForTimeout(550);

  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Não foi possível obter a área do elemento para mover o cursor.');
  }

  let x = box.x + box.width / 2;
  let y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps });

  // Re-verify position in case a toast banner dismissed or smooth scroll settled during glide
  const freshBox = await locator.boundingBox();
  if (freshBox) {
    const fx = freshBox.x + freshBox.width / 2;
    const fy = freshBox.y + freshBox.height / 2;
    if (Math.hypot(fx - x, fy - y) > 4) {
      x = fx;
      y = fy;
      await page.mouse.move(x, y, { steps: 6 });
    }
  }

  return { x, y };
}

/**
 * Slides the visual cursor smoothly to the center of `locator` (`steps: 35`)
 * and performs a natural click with visible press & ripple animation.
 */
async function humanMoveAndClick(
  page: Page,
  locator: Locator,
  steps = 35,
): Promise<void> {
  await humanMove(page, locator, steps);
  await page.mouse.down();
  await page.waitForTimeout(140);
  await page.mouse.up();
}

/**
 * Slides to an input field, clicks to focus, and fills the value smoothly.
 */
async function humanFill(
  page: Page,
  locator: Locator,
  value: string,
): Promise<void> {
  await humanMoveAndClick(page, locator);
  await locator.fill(value);
}

/**
 * Smoothly glides to a map marker and drags it across the floor plan.
 */
async function humanDragBy(
  page: Page,
  locator: Locator,
  deltaX: number,
  deltaY: number,
  steps = 35,
): Promise<void> {
  const { x, y } = await humanMove(page, locator, 35);
  await page.mouse.down();
  await page.waitForTimeout(220);
  await page.mouse.move(x + deltaX, y + deltaY, { steps });
  await page.waitForTimeout(260);
  await page.mouse.up();
}

test.describe('Demonstração Visual — Sistema Mesa (Vídeo 1280x720)', () => {
  const runId = randomUUID().slice(0, 8);
  const demoCustomerName = 'Mariana Costa';
  const demoCustomerEmail = `demo-mariana-${runId}@example.test`;
  const demoCustomerPassword = `DemoMesa!${runId}2027`;
  let targetTableLabel = 'P01';
  let dragTableLabel = 'T02';

  test.beforeAll(async () => {
    await resetLocalRateLimits();

    const { db } = createE2eDb();
    try {
      const passwordHash = await hashPassword(demoCustomerPassword);
      await db.user.create({
        data: {
          email: demoCustomerEmail,
          name: demoCustomerName,
          passwordHash,
          role: 'CUSTOMER',
          emailVerifiedAt: new Date(),
        },
      });

      const aurora = await db.event.findUnique({
        where: { slug: 'noite-aurora' },
        include: {
          sectors: {
            include: {
              tables: {
                include: {
                  reservations: {
                    where: {
                      OR: [
                        { status: 'CONFIRMED' },
                        {
                          status: 'PENDING_PAYMENT',
                          expiresAt: { gt: new Date() },
                        },
                      ],
                    },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!aurora) {
        throw new Error(
          'Evento "Noite Aurora" não encontrado. Execute `npm run db:seed` antes da demo.',
        );
      }

      const futureStart =
        aurora.startsAt.getTime() > Date.now() + 3_600_000
          ? aurora.startsAt
          : new Date(Date.now() + 30 * 86_400_000);
      const futureEnd = new Date(futureStart.getTime() + 6 * 3_600_000);

      await db.event.update({
        where: { id: aurora.id },
        data: {
          status: 'PUBLISHED',
          displayMode: 'BOTH',
          city: aurora.city ?? 'São Paulo',
          category: aurora.category ?? 'Música',
          startsAt: futureStart,
          endsAt: futureEnd,
        },
      });

      const allTables = aurora.sectors.flatMap((s) => s.tables);
      for (const table of allTables) {
        const preset = INITIAL_AURORA_COORDS[table.label];
        if (preset) {
          await db.eventTable.update({
            where: { id: table.id },
            data: { x: preset.x, y: preset.y, isEnabled: true },
          });
        }
      }

      const availableTables = allTables.filter(
        (t) => t.isEnabled && t.reservations.length === 0,
      );
      if (availableTables.length === 0) {
        throw new Error(
          'Nenhuma mesa disponível no evento Noite Aurora para a gravação da demo.',
        );
      }

      targetTableLabel =
        availableTables.find((t) => t.label === 'P01')?.label ??
        availableTables[0]!.label;
      dragTableLabel =
        allTables.find(
          (t) => t.label === 'T02' && t.label !== targetTableLabel,
        )?.label ??
        allTables.find((t) => t.label !== targetTableLabel)?.label ??
        targetTableLabel;
    } finally {
      await db.$disconnect();
    }
  });

  test.afterAll(async () => {
    await cleanupE2eFixtures({
      userEmails: [demoCustomerEmail],
    });
  });

  test('grava demonstração fluida com cursor animado e ritmo de apresentação', async ({
    browser,
  }) => {
    test.setTimeout(360_000);

    const rawVideoDir = join(tmpdir(), `sistema-mesa-demo-${runId}`);
    await mkdir(rawVideoDir, { recursive: true });

    const context = await browser.newContext({
      baseURL: DEMO_BASE_URL,
      viewport: { width: 1280, height: 720 },
      colorScheme: 'dark',
      recordVideo: {
        dir: rawVideoDir,
        size: { width: 1280, height: 720 },
      },
    });

    const page = await context.newPage();
    await installVisualCursor(page);

    try {
      // =====================================================================
      // CENA 1: Home Page em Dark Mode (carrossel e filtros)
      // =====================================================================
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.getByText('Noite Aurora').first()).toBeVisible();

      // Park cursor gently near the hero carousel and let viewer read
      await page.mouse.move(640, 310, { steps: 25 });
      await page.waitForTimeout(2200);

      // Scroll smoothly down to the catalog & filters section
      await page
        .locator('#eventos')
        .evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await page.waitForTimeout(1800);

      // Open advanced filters panel
      const filtersBtn = page.getByRole('button', { name: /Filtros/ });
      await humanMoveAndClick(page, filtersBtn);
      await page.waitForTimeout(2000);

      // Click "Disponíveis" availability filter pill
      await humanMoveAndClick(
        page,
        page.getByRole('button', { name: 'Disponíveis', exact: true }),
      );
      await page.waitForTimeout(1800);

      // Close advanced filters and open "Noite Aurora"
      await humanMoveAndClick(page, filtersBtn);
      await page.waitForTimeout(900);

      await humanMoveAndClick(
        page,
        page.locator('#eventos').getByRole('link', { name: /Noite Aurora/ }).first(),
      );

      // =====================================================================
      // CENA 2: Detalhes de Noite Aurora (Mapa Interativo ↔ Lista por Setores)
      // =====================================================================
      await expect(page).toHaveURL(/\/eventos\/noite-aurora/);
      await expect(
        page.getByRole('heading', { name: 'Noite Aurora' }),
      ).toBeVisible();
      await expect(page.getByText('Tempo real ativo')).toBeVisible();
      await page.waitForTimeout(2000);

      // Scroll smoothly to table selection workspace
      await page
        .getByRole('heading', { name: 'Escolha onde ficar' })
        .evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await page.waitForTimeout(1500);

      // Ensure Interactive Map is active and hover over a table to show the rich popover
      const mapTab = page.getByRole('tab', { name: /Mapa Interativo/ });
      const listTab = page.getByRole('tab', { name: /Lista por Setores/ });
      if ((await mapTab.getAttribute('aria-selected')) !== 'true') {
        await humanMoveAndClick(page, mapTab);
      }

      const targetMapBtn = page
        .getByRole('button', { name: new RegExp(`Mesa ${targetTableLabel},`) })
        .first();
      await humanMove(page, targetMapBtn, 35);
      await page.waitForTimeout(2300);

      // Switch to Lista por Setores and pause for reading
      await humanMoveAndClick(page, listTab);
      await expect(listTab).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { name: 'Pista' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Terraço' })).toBeVisible();
      await page.waitForTimeout(2400);

      // Switch back to Mapa Interativo
      await humanMoveAndClick(page, mapTab);
      await expect(mapTab).toHaveAttribute('aria-selected', 'true');
      await page.waitForTimeout(1500);

      // =====================================================================
      // CENA 3: Login do cliente, bloqueio (10 min) e pagamento Pix simulado
      // =====================================================================
      await humanMoveAndClick(page, targetMapBtn);
      await page.waitForTimeout(1800);

      await humanMoveAndClick(
        page,
        page.getByRole('link', { name: /Entrar para reservar/ }),
      );
      await expect(page).toHaveURL(/\/login/);

      await humanFill(page, page.locator('#login-email'), demoCustomerEmail);
      await humanFill(page, page.locator('#login-password'), demoCustomerPassword);
      await humanMoveAndClick(
        page,
        page.getByRole('button', { name: 'Entrar', exact: true }),
      );

      await expect(page).toHaveURL(/\/eventos\/noite-aurora/);
      await expect(page.getByText('Tempo real ativo')).toBeVisible();
      await page.waitForTimeout(1000);

      // Select table again now authenticated
      const tableBtnAuthed = page
        .getByRole('button', { name: new RegExp(`Mesa ${targetTableLabel},`) })
        .first();
      await humanMoveAndClick(page, tableBtnAuthed);
      await page.waitForTimeout(1400);

      // Lock table (10-minute hold)
      await humanMoveAndClick(
        page,
        page.getByRole('button', { name: /Reservar e ir para checkout/ }),
      );

      const lockDialog = page.getByRole('dialog');
      await expect(lockDialog).toContainText('Mesa bloqueada com sucesso!');
      await expect(lockDialog).toContainText(/\d{2}:\d{2}/);
      await page.waitForTimeout(2200);

      // Open CheckoutDrawer and display the 10-minute countdown
      await humanMoveAndClick(
        page,
        lockDialog.getByRole('button', { name: 'Pagar agora' }),
      );
      await expect(page.getByRole('timer')).toContainText(/\d{2}:\d{2}/);
      await page.waitForTimeout(2200);

      // Generate simulated Pix QR Code
      const checkoutResponsePromise = page.waitForResponse(
        (res) =>
          /\/reservations\/[^/]+\/checkout$/.test(res.url()) &&
          res.request().method() === 'POST',
      );
      await humanMoveAndClick(
        page,
        page.getByRole('button', { name: /Gerar QR Code Pix/ }),
      );
      const checkoutRes = await checkoutResponsePromise;
      expect(checkoutRes.status()).toBe(201);
      const { payment } = (await checkoutRes.json()) as {
        payment: { id: string; amountMinor: number; currency: string };
      };

      await expect(
        page.getByAltText('QR Code Pix para pagamento'),
      ).toBeVisible();
      await page.waitForTimeout(2500);

      // Confirm Pix via real HMAC-signed webhook
      const webhookRes = await sendSignedMockWebhook({
        paymentId: payment.id,
        method: 'PIX',
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        outcome: 'APPROVED',
      });
      expect(webhookRes.status).toBe(200);

      await humanMoveAndClick(
        page,
        page.getByRole('button', { name: /Já paguei, verificar status/ }),
      );
      await expect(
        page.getByRole('heading', { name: 'Pagamento confirmado!' }),
      ).toBeVisible();
      await page.waitForTimeout(2200);

      // Close checkout drawer -> ReservationLockModal shows "Pago"
      await humanMoveAndClick(
        page,
        page.getByRole('button', { name: 'Fechar', exact: true }),
      );
      await page.waitForTimeout(1000);

      // =====================================================================
      // CENA 4: Tela "Minhas Reservas" e QR Code do ingresso digital
      // =====================================================================
      await humanMoveAndClick(
        page,
        page.getByRole('dialog').getByRole('link', { name: 'Minhas Reservas' }),
      );
      await expect(page).toHaveURL(/\/minhas-reservas/);
      await expect(
        page.getByRole('heading', { name: /Confirmadas/ }),
      ).toBeVisible();
      await page.waitForTimeout(2000);

      const receiptPromise = page.waitForResponse(
        (res) =>
          /\/reservations\/[^/]+\/receipt$/.test(res.url()) &&
          res.request().method() === 'GET',
      );
      await humanMoveAndClick(
        page,
        page.getByRole('button', { name: /Ver Ingresso \/ QR Code/ }).first(),
      );

      const receiptRes = await receiptPromise;
      expect(receiptRes.status()).toBe(200);
      const { receipt } = (await receiptRes.json()) as {
        receipt: { ticket: { token: string; qrCode: string } };
      };
      const ticketToken = receipt.ticket.token;

      const ticketDialog = page.getByRole('dialog');
      await expect(
        ticketDialog.locator('img[alt^="QR Code do ingresso"]'),
      ).toBeVisible();
      await page.waitForTimeout(2500);

      // Close TicketModal
      await humanMoveAndClick(
        page,
        page.getByRole('button', { name: 'Fechar ingresso' }),
      );
      await page.waitForTimeout(800);

      // =====================================================================
      // CENA 5: Painel Admin — Editor de Mapa, Dashboard e Portaria / Check-in
      // =====================================================================
      await humanMoveAndClick(
        page,
        page.locator('header button[aria-haspopup="menu"]'),
      );
      await humanMoveAndClick(page, page.getByRole('menuitem', { name: 'Sair' }));

      // Login as ADMIN
      const admin = getAdminCredentials();
      await page.waitForTimeout(600);
      if (!page.url().includes('/login')) {
        await humanMoveAndClick(
          page,
          page.getByRole('link', { name: 'Entrar', exact: true }).first(),
        );
      }
      await expect(page).toHaveURL(/\/login/);
      await humanFill(page, page.locator('#login-email'), admin.email);
      await humanFill(page, page.locator('#login-password'), admin.password);
      await humanMoveAndClick(
        page,
        page.getByRole('button', { name: 'Entrar', exact: true }),
      );

      // If logout redirected via `/login?redirect=/minhas-reservas`, click Painel Admin smoothly
      await expect(page).not.toHaveURL(/\/login/);
      if (!page.url().includes('/admin')) {
        await humanMoveAndClick(
          page,
          page.getByRole('link', { name: /Painel Admin/ }).first(),
        );
      }

      await expect(page).toHaveURL(/\/admin/);
      await expect(
        page.getByRole('heading', { name: 'Painel Administrativo' }),
      ).toBeVisible();
      await page.waitForTimeout(1800);

      // Open Noite Aurora in the Visual Map Editor
      const auroraRow = page
        .locator('article', { hasText: 'Noite Aurora' })
        .first();
      await expect(auroraRow).toBeVisible();
      await humanMoveAndClick(
        page,
        auroraRow.getByRole('button', { name: 'Mapa', exact: true }),
      );
      await page.waitForTimeout(1800);

      // Smooth drag-and-drop of a table marker across the floor plan
      const dragMarker = page
        .locator(`button[title^="Mesa ${dragTableLabel} "]`)
        .first();
      await humanDragBy(page, dragMarker, 120, -70, 35);
      await page.waitForTimeout(1800);

      // Save Layout in batch
      const saveLayoutBtn = page.getByRole('button', { name: 'Salvar Layout' });
      await humanMoveAndClick(page, saveLayoutBtn);
      await expect(page.getByText(/Layout salvo com sucesso/)).toBeVisible();
      await page.waitForTimeout(2000);

      // Open Realtime Dashboard tab to inspect revenue & buyers table
      await humanMoveAndClick(
        page,
        page.getByRole('button', { name: 'Dashboard', exact: true }).first(),
      );
      await expect(page.getByText('Faturamento Confirmado')).toBeVisible();
      await expect(page.getByText(demoCustomerEmail).first()).toBeVisible();
      await page.waitForTimeout(2500);

      // Open Portaria / Check-in tab
      await humanMoveAndClick(
        page,
        page.getByRole('button', { name: 'Portaria / Check-in', exact: true }),
      );
      await page.waitForTimeout(1200);

      const tokenInput = page.getByPlaceholder(
        'mesa-ticket-v1.<nonce>.<payload>.<tag>',
      );
      const validateBtn = page.getByRole('button', {
        name: 'Validar Entrada',
      });

      // 1st scan: 200 Entrada liberada
      await humanFill(page, tokenInput, ticketToken);
      await humanMoveAndClick(page, validateBtn);
      await expect(page.getByText('Entrada liberada').first()).toBeVisible();
      await page.waitForTimeout(2500);

      // 2nd scan: 409 TICKET_ALREADY_USED
      await humanFill(page, tokenInput, ticketToken);
      await humanMoveAndClick(page, validateBtn);
      await expect(
        page.getByText('Ingresso já utilizado').first(),
      ).toBeVisible();
      await page.waitForTimeout(2500);
    } finally {
      const video = page.video();
      await context.close();
      if (video) {
        await mkdir(resolve(process.cwd(), 'test-results'), { recursive: true });
        await video.saveAs(DEMO_VIDEO_OUTPUT);
        console.log(`DEMO_VIDEO_PATH=${DEMO_VIDEO_OUTPUT}`);
      }
    }
  });
});
