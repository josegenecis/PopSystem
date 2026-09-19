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

  await finishButton.click();
  await expect(page).toHaveURL(new RegExp(`/track/${fakeOrderId}$`));
  expect(submittedOrders).toBe(1);
  expect(pageErrors).toEqual([]);
});
