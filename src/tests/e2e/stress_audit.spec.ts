import { test, expect } from '@playwright/test';

// CONFIGURAÇÃO DOS CENÁRIOS DA FASE 2
const SCENARIO_1 = { amount: '1000', rate: '10', installments: '1', expected: '1.100,00' };
const SCENARIO_2 = { amount: '1000', rate: '10', installments: '10', expected: '162,75' };

test.describe('Fase 3: Exploração Estressante - LMS Live Audit', () => {

  test.beforeEach(async ({ page }) => {
    // 1. LOGIN
    await page.goto('https://lms-emprestimos.onrender.com/login');
    await page.fill('input[type="email"]', 'admin@creditnow.com');
    await page.fill('input[type="password"]', '123456');
    await page.click('button:has-text("Entrar no Sistema")');

    // Espera explícita pelo dashboard com timeout maior
    try {
        await expect(page).toHaveURL(/.*dashboard/, { timeout: 15000 });
    } catch (e) {
        const errorMsg = await page.locator('div.bg-red-50').textContent();
        console.log("Erro de Login Detectado no Site:", errorMsg);
        throw e;
    }
  });

  test('Crawler: Navegação por todas as rotas', async ({ page }) => {
    const routes = [
      '/dashboard', '/clients', '/billing',
      '/overdue', '/blacklist', '/affiliates',
      '/history', '/settings'
    ];
    for (const route of routes) {
      await page.goto(`https://lms-emprestimos.onrender.com${route}`);
      await page.waitForLoadState('networkidle');
      // Verifica se não há erro 404 ou crash na tela
      const bodyText = await page.innerText('body');
      expect(bodyText).not.toContain('404');
      expect(bodyText).not.toContain('Error');
    }
  });

  test('Teste de Limites (Edge Cases): Inputs Inválidos', async ({ page }) => {
    await page.goto('https://lms-emprestimos.onrender.com/billing');
    await page.click('button:has-text("Novo Contrato")');

    // 1. Valor Zero ou Negativo
    await page.fill('label:has-text("Valor (R$)") + input', '0');
    await page.fill('label:has-text("Taxa Mensal (%)") + input', '10');
    await page.fill('label:has-text("Qtd. Parcelas") + input', '1');
    await page.fill('label:has-text("Data da Operação") + input', '2025-01-01');

    // O sistema não deve permitir avançar se o cálculo for zero/inválido
    const simulateText = await page.innerText('div:has-text("Simulação Financeira")');
    expect(simulateText).toContain('Aguardando dados'); // Ou R$ 0,00 conforme o código

    // 2. CPF Incompleto no Cadastro de Cliente
    await page.goto('https://lms-emprestimos.onrender.com/clients');
    await page.click('button:has-text("Novo Cliente")');
    await page.fill('input[placeholder="000.000.000-00"]', '123'); // CPF Inválido
    await page.click('button:has-text("Salvar Cliente")');

    // Verificamos se houve alerta de campo obrigatório ou erro
    // (O HTML do Clients.tsx exige 'required', o browser deve bloquear o submit)
    const isRequired = await page.getAttribute('input[placeholder="000.000.000-00"]', 'required');
    expect(isRequired).not.toBeNull();
  });

  test('Conferência Financeira: Validação dos Cenários da Fase 2', async ({ page }) => {
    await page.goto('https://lms-emprestimos.onrender.com/billing');

    // Teste Cenário 1
    await page.click('button:has-text("Novo Contrato")');
    await page.fill('label:has-text("Valor (R$)") + input', SCENARIO_1.amount);
    await page.fill('label:has-text("Taxa Mensal (%)") + input', SCENARIO_1.rate);
    await page.fill('label:has-text("Qtd. Parcelas") + input', SCENARIO_1.installments);
    await page.fill('label:has-text("Data da Operação") + input', '2025-01-01');

    await page.waitForTimeout(1000); // Espera debouncing da simulação
    const result1 = await page.locator('span:has-text("R$")').filter({ hasText: SCENARIO_1.expected }).isVisible();
    expect(result1).toBeTruthy();
    await page.click('button:has-text("Cancelar")');

    // Teste Cenário 2
    await page.click('button:has-text("Novo Contrato")');
    await page.fill('label:has-text("Valor (R$)") + input', SCENARIO_2.amount);
    await page.fill('label:has-text("Taxa Mensal (%)") + input', SCENARIO_2.rate);
    await page.fill('label:has-text("Qtd. Parcelas") + input', SCENARIO_2.installments);
    await page.fill('label:has-text("Data da Operação") + input', '2025-01-01');

    await page.waitForTimeout(1000);
    const result2 = await page.locator('span:has-text("R$")').filter({ hasText: SCENARIO_2.expected }).isVisible();
    expect(result2).toBeTruthy();
  });

  test('Verificação de Atraso e Mora (Cenário 3)', async ({ page }) => {
    // Para testar o cenário 3, precisamos de um contrato que JÁ esteja vencido.
    // Vamos navegar para a tela de Atrasados.
    await page.goto('https://lms-emprestimos.onrender.com/overdue');
    await page.waitForLoadState('networkidle');

    // Verificamos se há algum contrato e se o cálculo de dias bate com a lógica
    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount > 0 && !(await rows.first().innerText()).includes('Nenhum contrato')) {
       console.log("Contratos em atraso detectados para validação visual.");
       // Validamos se o "Valor Atualizado" é maior que o "Valor Original"
       const original = await rows.first().locator('td:nth-child(4)').innerText();
       const updated = await rows.first().locator('td:nth-child(5)').innerText();

       const numOriginal = parseFloat(original.replace('R$', '').replace('.', '').replace(',', '.'));
       const numUpdated = parseFloat(updated.replace('R$', '').replace('.', '').replace(',', '.'));

       expect(numUpdated).toBeGreaterThanOrEqual(numOriginal);
    }
  });

});
