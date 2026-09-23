import { isMiniChefUrl, normalizeMiniChefMenu } from "../_shared/minichef-menu.ts";

const assertEquals = (actual: unknown, expected: unknown) => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) throw new Error(`Esperado ${expectedJson}, recebido ${actualJson}`);
};

const product = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  nome: "Marmita P",
  descricao: "Arroz, feijão e carne",
  preco: "14.00",
  preco_delivery: null,
  categoria_id: 115,
  ordem: 1,
  ativo: true,
  disponivel: true,
  disponivel_delivery: true,
  por_peso: false,
  imagem_url_formatada: "https://app.minichef.online/storage/produtos/10/card.jpg",
  grupos_modificadores: [{
    nome: "Proteína",
    obrigatorio: true,
    min_selecao: 1,
    max_selecao: 1,
    modificadores: [{ nome: "Frango", preco: "2.50", ativo: true, disponivel: true, pivot: { ativo: 1 } }],
  }],
  ...overrides,
});

const embed = (value: unknown) => JSON.stringify(value)
  .replace(/'/g, "\\u0027")
  .replace(/"/g, "\\u0022")
  .replace(/\//g, "\\/");

Deno.test("reconhece somente links públicos de loja MiniChef", () => {
  assertEquals(isMiniChefUrl("https://app.minichef.online/delivery/lel-marmitaria/?utm_source=ig"), true);
  assertEquals(isMiniChefUrl("https://app.minichef.online/admin"), false);
});

Deno.test("extrai categorias, deduplica destaques e preserva complementos", () => {
  const encoded = embed(product());
  const html = `
    <title>L&amp;L Marmitaria — Cardápio</title>
    <section id="cat-115"><h2>Marmitas</h2></section>
    <div x-data="{ product: JSON.parse('${encoded}') }"></div>
    <div x-data="{ product: JSON.parse('${encoded}') }"></div>
  `;

  const result = normalizeMiniChefMenu("https://app.minichef.online/delivery/lel-marmitaria/", html);
  assertEquals(result.platform, "minichef");
  assertEquals(result.restaurant.name, "L&L Marmitaria");
  assertEquals(result.stats.categories, 1);
  assertEquals(result.stats.products, 1);
  assertEquals(result.stats.productsWithImages, 1);
  assertEquals(result.stats.variationLinks, 1);
  assertEquals(result.categories[0].name, "Marmitas");
  assertEquals(result.categories[0].products[0].variations[0].options[0], { name: "Frango", price: 2.5 });
});

Deno.test("mantém preço de delivery, venda por peso e ignora placeholder", () => {
  const html = `
    <title>Peixaria — Cardápio</title>
    <section id="cat-9"><h2>Peixes</h2></section>
    <div x-data="{ product: JSON.parse('${embed(product({
      id: 20,
      categoria_id: 9,
      nome: "Tilápia",
      preco: "30.00",
      preco_delivery: "34.90",
      por_peso: true,
      imagem_url_formatada: "https://app.minichef.online/images/default-placeholder.svg",
    }))}') }"></div>
  `;

  const parsed = normalizeMiniChefMenu("https://app.minichef.online/delivery/peixaria/", html);
  assertEquals(parsed.categories[0].products[0].price, 34.9);
  assertEquals(parsed.categories[0].products[0].weight_based, true);
  assertEquals(parsed.categories[0].products[0].image_url, null);
});
