import { test, expect } from '@playwright/test';

test('Finalizar Pedido habilita com PIX padrão selecionado', async ({ page, baseURL }) => {
  const userId = process.env.MENU_TEST_USER_ID;
  test.skip(!userId, 'Defina MENU_TEST_USER_ID para executar este teste.');
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.route('**/functions/v1/pix-settings-public*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        settings: { enabled: false, pix_key: 'chave-pix-teste', merchant_name: 'Loja', merchant_city: 'Cidade' }
      })
    });
  });

  await page.goto(`${baseURL}/menu/${userId}`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder(/buscar/i).waitFor({ state: 'visible' });

  await page.getByRole('button', { name: /adicionar/i }).first().click();
  const addDialog = page.getByRole('dialog');
  await addDialog.waitFor({ state: 'visible' });

  const addBtn = addDialog.getByRole('button', { name: /^Adicionar$/i });
  await addBtn.click();

  const viewCart = page.getByRole('button', { name: /ver carrinho/i });
  await viewCart.waitFor({ state: 'visible' });
  await viewCart.click();

  const checkout = page.getByRole('dialog');
  await checkout.waitFor({ state: 'visible' });

  await checkout.getByPlaceholder('Seu nome completo').fill('Cliente Teste');
  await checkout.getByPlaceholder('(11) 99999-9999').fill('(11) 99999-9999');
  await checkout.getByPlaceholder('Rua, número, complemento, bairro').fill('Rua A, 10, Centro');

  const zoneSelect = checkout.getByText('Selecione sua área');
  if (await zoneSelect.count()) {
    await zoneSelect.click();
    const firstZone = page.getByRole('option').first();
    if (await firstZone.count()) await firstZone.click();
  }

  const finishButton = checkout.getByRole('button', { name: 'Finalizar Pedido' });
  await expect(finishButton).toBeEnabled();

  const fakeOrderId = '00000000-0000-4000-8000-000000000001';
  let submittedOrders = 0;
  await page.route('**/rest/v1/upsell_rules*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }));
  await page.route('**/rest/v1/customers*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: route.request().method() === 'POST'
      ? JSON.stringify({ id: '00000000-0000-4000-8000-000000000002' })
      : 'null',
  }));
  await page.route('**/rest/v1/orders*', (route) => {
    submittedOrders += 1;
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: fakeOrderId }),
    });
  });
  await page.route('**/functions/v1/public-order-tracking', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      order: {
        id: fakeOrderId,
        order_number: 'PEDIDO-TESTE',
        customer_name: 'Cliente Teste',
        customer_phone: '11999999999',
        order_type: 'delivery',
        status: 'pending',
        acceptance_status: 'pending_acceptance',
        total: 10,
        payment_method: 'dinheiro',
        created_at: '2026-09-19T12:00:00.000Z',
        estimated_time: '30-45 min',
        user_id: userId,
      },
    }),
  }));

  await finishButton.click();
  await expect(page).toHaveURL(new RegExp(`/track/${fakeOrderId}$`));
  await expect(page.getByRole('heading', { name: 'Acompanhar Pedido' })).toBeVisible();
  await expect(page.getByText('PEDIDO-TESTE')).toBeVisible();
  expect(submittedOrders).toBe(1);
  expect(pageErrors).toEqual([]);
});

test('MenuApp renderiza o acompanhamento após navegação interna', async ({ page, baseURL }) => {
  const userId = process.env.MENU_TEST_USER_ID;
  test.skip(!userId, 'Defina MENU_TEST_USER_ID para executar este teste.');
  const fakeOrderId = '00000000-0000-4000-8000-000000000003';

  await page.route('**/functions/v1/public-order-tracking', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      order: {
        id: fakeOrderId,
        order_number: 'PEDIDO-ROTA',
        customer_name: 'Cliente Rota',
        order_type: 'delivery',
        status: 'pending',
        acceptance_status: 'pending_acceptance',
        total: 15,
        payment_method: 'dinheiro',
        created_at: '2026-09-19T12:00:00.000Z',
        user_id: userId,
      },
    }),
  }));

  await page.goto(`${baseURL}/menu/${userId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Cardápio' }).waitFor({ state: 'visible' });
  await page.evaluate((orderId) => {
    window.history.pushState({}, '', `/track/${orderId}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, fakeOrderId);

  await expect(page).toHaveURL(new RegExp(`/track/${fakeOrderId}$`));
  await expect(page.getByRole('heading', { name: 'Acompanhar Pedido' })).toBeVisible();
  await expect(page.getByText('PEDIDO-ROTA')).toBeVisible();
});
