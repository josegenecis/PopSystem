import React from 'react';
import { Helmet } from 'react-helmet-async';
import {
  ArrowRight, BarChart3, Bot, Check, Clock3, CreditCard, FileCheck2, Headphones,
  HeartHandshake, Megaphone, MessageCircle, MonitorSmartphone, PackageCheck, Play,
  QrCode, ShieldCheck, ShoppingBag, Store, TrendingUp, UtensilsCrossed, WalletCards,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import LandingLayout from '@/components/landing/LandingLayout';
import ProductProofSection from '@/components/landing/ProductProofSection';
import { ScrollToTop } from '@/components/landing/ScrollToTop';
import { PLAN_CATALOG } from '@/data/planCatalog';
import { trackMarketing } from '@/lib/marketingAnalytics';

const SUPPORT_PHONE = '5585992918273';
const WHATSAPP_URL = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent('Olá! Quero conhecer o PopSystem e organizar meu restaurante.')}`;

const heroCallouts = [
  { title: 'PDV', text: 'Atendimento rápido e completo', position: 'left-[31%] top-[59%]' },
  { title: 'App Garçom', text: 'Pedidos direto na mesa', position: 'left-[33%] top-[29%]' },
  { title: 'Totem de autoatendimento', text: 'Mais vendas e menos filas', position: 'left-[46%] top-[15%]' },
  { title: 'KDS na cozinha', text: 'Produção mais eficiente', position: 'right-[20%] top-[38%]' },
  { title: 'App Motoboy', text: 'Rotas na palma da mão', position: 'right-[3%] top-[58%]' },
];

const heroBenefits = [
  { icon: TrendingUp, title: 'Tráfego pago automático', text: 'Mais clientes no piloto automático.' },
  { icon: CreditCard, title: 'Pagamento integrado', text: 'Produção liberada após o pagamento.' },
  { icon: Clock3, title: 'Controle de ponto', text: 'Jornada, faltas e fechamento.' },
  { icon: FileCheck2, title: 'Fiscal nativo', text: 'NFC-e, NF-e, IBS/CBS e XML.' },
  { icon: PackageCheck, title: 'Estoque e compras', text: 'Notas, ficha técnica e CMV.' },
  { icon: BarChart3, title: 'Relatórios completos', text: 'Vendas, lucro e indicadores.' },
];

const channels = [
  { icon: MonitorSmartphone, title: 'PDV rápido', subtitle: 'Venda sem travar a fila' },
  { icon: QrCode, title: 'Cardápio digital', subtitle: 'Pedido direto do celular' },
  { icon: UtensilsCrossed, title: 'Mesas e comandas', subtitle: 'Conta organizada por cliente' },
  { icon: Store, title: 'Totem', subtitle: 'Autoatendimento integrado' },
  { icon: MessageCircle, title: 'WhatsApp', subtitle: 'Atendimento e automações' },
  { icon: ShoppingBag, title: 'iFood e delivery', subtitle: 'Pedidos centralizados' },
];

const compactBenefits = [
  { icon: PackageCheck, title: 'Estoque, ficha técnica e CMV', text: 'Baixa automática de insumos, custo real e margem de cada produto.' },
  { icon: HeartHandshake, title: 'Fidelidade que traz o cliente de volta', text: 'Cupons, campanhas, cashback e ofertas para aumentar a recorrência.' },
  { icon: WalletCards, title: 'Financeiro que fecha com a operação', text: 'Caixa, contas a pagar e receber, despesas, DRE e visão do lucro.' },
];

const faqs = [
  ['Preciso instalar alguma coisa?', 'Não para começar. O PopSystem funciona pela internet em computador, tablet e celular. Para impressão, balança e outros dispositivos, o PopConnect complementa a operação.'],
  ['Consigo trazer meu cardápio atual?', 'Sim. Você pode importar ou cadastrar produtos, categorias, complementos, imagens, preços e códigos usados no sistema anterior.'],
  ['O PopSystem serve para delivery e salão?', 'Serve para os dois. O mesmo sistema organiza balcão, mesas, comandas, retirada, delivery próprio, cardápio digital, WhatsApp e iFood.'],
  ['Posso mudar de plano depois?', 'Sim. Você pode evoluir conforme a operação cresce, com cálculo proporcional no upgrade.'],
  ['Funciona para mais de uma loja?', 'Sim. O plano Multi oferece troca rápida entre unidades, permissões por loja e visão consolidada da rede.'],
  ['Como funciona o suporte?', 'Você fala com uma equipe que conhece a rotina de restaurante e acompanha implantação, configuração e operação.'],
];

const Eyebrow = ({ children, light = false }: { children: React.ReactNode; light?: boolean }) => (
  <div className={`mb-4 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[.22em] ${light ? 'text-[#b9e98c]' : 'text-[#e95f12]'}`}>
    <span className="h-2 w-2 rounded-full bg-current" />{children}
  </div>
);

const HeroCallout = ({ title, text, position }: { title: string; text: string; position: string }) => (
  <div className={`absolute z-20 hidden max-w-[220px] rounded-xl border border-white/80 bg-[#064733]/95 px-4 py-3 text-white shadow-2xl backdrop-blur lg:block ${position}`}>
    <strong className="block text-sm font-black">{title}</strong>
    <span className="mt-0.5 block text-xs font-medium leading-4 text-white/85">{text}</span>
    <span className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b border-r border-white/70 bg-[#064733]" />
  </div>
);

const VisualFeatureCard = ({ eyebrow, title, text, image, className }: { eyebrow: string; title: string; text: string; image: string; className?: string }) => (
  <article className={`group relative min-h-[360px] overflow-hidden rounded-[28px] border border-[#dce6de] bg-[#062f23] shadow-sm ${className || ''}`}>
    <img src={image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.035]" />
    <div className="absolute inset-0 bg-gradient-to-t from-[#031f17] via-[#062f23]/35 to-transparent" />
    <div className="absolute inset-x-0 bottom-0 p-6 text-white md:p-7">
      <span className="rounded-full border border-white/25 bg-black/20 px-3 py-1 text-[10px] font-black uppercase tracking-[.15em] backdrop-blur">{eyebrow}</span>
      <h3 className="mt-4 text-2xl font-black tracking-[-.035em]">{title}</h3>
      <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-white/75">{text}</p>
    </div>
  </article>
);

const getVisiblePlanFeatures = (plan: (typeof PLAN_CATALOG)[number]) => {
  if (plan.slug !== 'pro') return plan.featureGroups.flatMap(group => group.features).slice(0, 8);

  return plan.featureGroups.flatMap((group) => {
    if (['Atendimento e produção', 'Estoque, financeiro e rentabilidade', 'Marketing e relacionamento', 'Fiscal, contabilidade e segurança'].includes(group.title)) {
      return group.features.slice(0, 2);
    }
    return group.features.slice(0, 1);
  });
};

const LandingPage = () => (
  <>
    <Helmet>
      <title>PopSystem | Tudo funcionando em perfeita sintonia</title>
      <meta name="description" content="PDV, cardápio digital, delivery, mesas, cozinha, estoque, financeiro, fiscal, equipe, WhatsApp e marketing em um único sistema para restaurantes." />
      <meta name="keywords" content="sistema para restaurante, PDV restaurante, cardápio digital, sistema delivery, controle de estoque restaurante, gestão para restaurante" />
      <meta property="og:title" content="PopSystem | Seu restaurante inteiro em perfeita sintonia" />
      <meta property="og:description" content="Do pedido ao delivery, um único sistema integrando seu restaurante de ponta a ponta." />
      <meta property="og:image" content="https://popsystem.com.br/og-popsystem.webp" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:image" content="https://popsystem.com.br/og-popsystem.webp" />
      <link rel="canonical" href="https://popsystem.com.br/" />
      <link rel="preload" as="image" href="/landing/hero-restaurante-popsystem.webp" />
    </Helmet>

    <LandingLayout>
      <section className="relative min-h-[760px] overflow-hidden bg-[#eee9df] lg:min-h-[820px]">
        <img src="/landing/hero-restaurante-popsystem.webp" alt="Restaurante integrado com PDV, garçom, totem, cozinha e motoboy usando o PopSystem" className="absolute inset-0 h-full w-full object-cover object-[58%_center]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(250,249,245,.99)_0%,rgba(250,249,245,.96)_25%,rgba(250,249,245,.72)_35%,rgba(250,249,245,.08)_52%,transparent_68%)]" />
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/20 to-transparent" />
        {heroCallouts.map((callout) => <HeroCallout key={callout.title} {...callout} />)}

        <div className="container relative z-10 pt-10 lg:pt-16">
          <div className="max-w-[550px] rounded-[28px] bg-white/90 p-5 shadow-2xl shadow-black/10 backdrop-blur-sm sm:p-8 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
            <div className="inline-flex items-center rounded-full bg-[#dff2c9] px-4 py-2 text-[11px] font-black uppercase tracking-wide text-[#164f34]">Sistema completo para restaurantes</div>
            <h1 className="mt-5 text-[2.9rem] font-black leading-[.98] tracking-[-.06em] text-[#073e2e] sm:text-6xl lg:text-[3.75rem]">Tudo funcionando em perfeita <span className="text-[#ef6c20]">sintonia.</span></h1>
            <p className="mt-5 max-w-md text-base font-medium leading-7 text-[#546c63] sm:text-lg">Do pedido ao delivery, um único sistema integrando seu restaurante de ponta a ponta.</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild className="h-14 rounded-xl bg-[#ef6c20] px-7 text-base font-black text-white shadow-xl shadow-orange-950/15 hover:bg-[#dc5c14]"><a href="/login?tab=register" onClick={() => trackMarketing('landing_signup_click', 'hero')}><Play className="mr-2 h-5 w-5 fill-current" />Teste grátis por 14 dias</a></Button>
              <a href="#produto" className="inline-flex h-14 items-center justify-center gap-2 rounded-xl border border-[#aec2b6] bg-white/80 px-6 text-sm font-black text-[#164b39] backdrop-blur hover:bg-white">Ver o sistema em ação <ArrowRight className="h-4 w-4" /></a>
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm font-bold text-[#38594d]"><ShieldCheck className="h-5 w-5 text-[#4f9a3c]" />Seguro, estável e 100% em nuvem</p>
          </div>
        </div>

        <div className="container absolute inset-x-0 bottom-5 z-30 hidden lg:block">
          <div className="grid grid-cols-6 overflow-hidden rounded-[22px] border border-white/70 bg-white/95 px-3 py-5 shadow-[0_20px_60px_-25px_rgba(0,42,30,.45)] backdrop-blur-xl">
            {heroBenefits.map(({ icon: Icon, title, text }, index) => <div key={title} className={`flex min-w-0 gap-3 px-4 ${index > 0 ? 'border-l border-[#dfe6df]' : ''}`}><Icon className="mt-1 h-7 w-7 flex-none text-[#ef6c20]" /><div><strong className="block text-xs font-black leading-4 text-[#073e2e]">{title}</strong><span className="mt-1 block text-[10px] font-medium leading-4 text-[#63766e]">{text}</span></div></div>)}
          </div>
        </div>
      </section>

      <section className="border-b border-[#e5ebe5] bg-white py-6 lg:hidden">
        <div className="container grid grid-cols-2 gap-3 sm:grid-cols-3">{heroBenefits.map(({ icon: Icon, title }) => <div key={title} className="flex items-center gap-2 rounded-xl border border-[#e5ebe5] bg-[#fafbf9] p-3"><Icon className="h-5 w-5 flex-none text-[#ef6c20]" /><span className="text-[11px] font-black leading-4 text-[#073e2e]">{title}</span></div>)}</div>
      </section>

      <section id="recursos" className="scroll-mt-[72px] border-b border-[#e5ebe5] bg-white py-7">
        <div className="container"><p className="mb-5 text-center text-xs font-black uppercase tracking-[.18em] text-[#82928c]">Uma plataforma para toda forma de vender</p><div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">{channels.map(({ icon: Icon, title, subtitle }) => <div key={title} className="flex items-center gap-3 rounded-xl border border-[#e8ede8] bg-[#fafbf9] p-3"><Icon className="h-5 w-5 flex-none text-[#ef6c20]" /><div><div className="text-xs font-black text-[#073e2e]">{title}</div><div className="mt-0.5 text-[10px] font-medium text-[#7c8d86]">{subtitle}</div></div></div>)}</div></div>
      </section>

      <ProductProofSection />

      <section id="funcionalidades" className="bg-[#f5f7f3] py-16 md:py-20">
        <div className="container">
          <div id="vantagens" className="grid gap-6 lg:grid-cols-[.78fr_1.22fr] lg:items-end"><div><Eyebrow>Diferenciais que trabalham por você</Eyebrow><h2 className="text-4xl font-black leading-[1.03] tracking-[-.045em] text-[#073e2e] md:text-5xl">Mais resultado.<br />Menos trabalho manual.</h2></div><p className="max-w-2xl text-base font-medium leading-7 text-[#5e7169] md:text-lg">Automação de vendas, equipe, fiscal e relacionamento dentro da mesma operação — sem montar um quebra-cabeça de ferramentas.</p></div>
          <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <VisualFeatureCard eyebrow="Mais clientes" title="Tráfego pago automatizado" text="Conecte sua conta, crie campanhas com seus produtos e acompanhe anúncios e resultados sem depender de uma operação paralela." image="/landing/marketing-automatizado.webp" className="lg:col-span-7" />
            <VisualFeatureCard eyebrow="Equipe em ordem" title="Controle de ponto inteligente" text="Entrada, intervalo, saída, jornadas e relatórios da equipe organizados no mesmo lugar." image="/landing/controle-ponto-equipe.webp" className="lg:col-span-5" />
            <VisualFeatureCard eyebrow="Fiscal sem correria" title="XML direto para a contabilidade" text="NFC-e, NF-e, IBS/CBS e documentos fiscais organizados para o fechamento com o contador." image="/landing/fiscal-contabilidade.webp" className="lg:col-span-5" />
            <article className="relative min-h-[360px] overflow-hidden rounded-[28px] bg-[#064733] p-7 text-white lg:col-span-7"><div className="absolute -bottom-24 -right-20 h-72 w-72 rounded-full border-[52px] border-white/10" /><Bot className="h-9 w-9 text-[#a8df75]" /><span className="absolute right-7 top-7 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[.15em]">Atendimento contínuo</span><div className="absolute inset-x-7 bottom-7"><h3 className="text-3xl font-black tracking-[-.04em]">WhatsApp Bot integrado</h3><p className="mt-3 max-w-xl text-sm font-medium leading-6 text-white/70">Atenda, organize conversas, envie campanhas e conduza pedidos no canal em que seu cliente já está todos os dias.</p><div className="mt-5 flex flex-wrap gap-2 text-[11px] font-bold"><span className="rounded-full bg-white/10 px-3 py-2">Pedidos</span><span className="rounded-full bg-white/10 px-3 py-2">Respostas automáticas</span><span className="rounded-full bg-white/10 px-3 py-2">Campanhas</span></div></div></article>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">{compactBenefits.map(({ icon: Icon, title, text }) => <article key={title} className="rounded-[22px] border border-[#dfe7e1] bg-white p-5 shadow-sm"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#eef7e8] text-[#4d8b2c]"><Icon className="h-5 w-5" /></div><h3 className="mt-5 text-lg font-black text-[#073e2e]">{title}</h3><p className="mt-2 text-sm font-medium leading-6 text-[#6b7d75]">{text}</p></article>)}</div>
        </div>
      </section>

      <section id="inteligencia" className="relative overflow-hidden bg-[#071f18] py-20 text-white">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'linear-gradient(45deg, transparent 45%, #fff 45%, #fff 46%, transparent 46%)', backgroundSize: '32px 32px' }} />
        <div className="container relative grid gap-12 lg:grid-cols-[.9fr_1.1fr] lg:items-center"><div><Eyebrow light>Inteligência que vira ação</Eyebrow><h2 className="text-4xl font-black leading-[1.03] tracking-[-.045em] md:text-5xl">O sistema não mostra só números. Ele ajuda você a decidir.</h2><p className="mt-6 text-lg font-medium leading-8 text-white/65">Descubra o que vende mais, onde sua margem escapa e qual ação pode melhorar o resultado — sem passar horas montando planilhas.</p><a href="/login?tab=register" onClick={() => trackMarketing('landing_signup_click', 'intelligence')} className="mt-8 inline-flex items-center gap-2 font-black text-[#a8df75] hover:text-white">Quero enxergar meu restaurante <ArrowRight className="h-5 w-5" /></a></div><div className="grid gap-3 sm:grid-cols-2">{[[TrendingUp, 'Venda melhor', 'Produtos campeões, horários fortes e ticket médio.'], [BarChart3, 'Proteja sua margem', 'CMV, despesas e desempenho da operação.'], [Bot, 'Ganhe produtividade', 'IA para análises e tarefas repetitivas.'], [Megaphone, 'Traga o cliente de volta', 'Ofertas, campanhas e fidelização.']].map(([Icon, title, text]) => { const FeatureIcon = Icon as typeof TrendingUp; return <div key={String(title)} className="rounded-[22px] border border-white/10 bg-white/[.055] p-5 backdrop-blur"><FeatureIcon className="h-6 w-6 text-[#ef7b36]" /><h3 className="mt-6 text-lg font-black">{String(title)}</h3><p className="mt-2 text-sm font-medium leading-6 text-white/55">{String(text)}</p></div>; })}</div></div>
      </section>

      <section id="planos" className="bg-white py-20">
        <div className="container">
          <div className="mx-auto max-w-3xl text-center"><Eyebrow>Planos sincronizados com o sistema</Eyebrow><h2 className="text-4xl font-black tracking-[-.04em] text-[#073e2e] md:text-5xl">O plano certo para cada fase.</h2><p className="mt-5 text-lg font-medium text-[#687a73]">As funcionalidades abaixo seguem o mesmo catálogo e as mesmas regras de acesso do painel PopSystem.</p></div>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">{PLAN_CATALOG.map((plan) => { const visibleFeatures = getVisiblePlanFeatures(plan); return <article key={plan.id} className={`relative flex flex-col rounded-[26px] border p-7 ${plan.featured ? 'border-[#ef6c20] bg-[#fffaf6] shadow-[0_24px_70px_-30px_rgba(239,108,32,.55)] lg:-translate-y-3' : 'border-[#dfe7e1] bg-white'}`}>{plan.featured ? <span className="absolute -top-3 left-7 rounded-full bg-[#ef6c20] px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-white">Mais completo para uma loja</span> : null}<h3 className="text-2xl font-black text-[#073e2e]">{plan.name}</h3><p className="mt-2 min-h-[70px] text-sm font-medium leading-6 text-[#6d7e77]">{plan.description}</p><div className="mt-6 flex items-end gap-1 text-[#073e2e]"><span className="mb-2 text-sm font-black">R$</span><strong className="text-5xl font-black tracking-[-.06em]">{plan.monthlyPrice}</strong><span className="mb-2 text-sm font-bold text-[#7d8d87]">/mês</span></div>{plan.extraStorePrice ? <p className="mt-2 text-xs font-bold text-purple-700">+ R$ {plan.extraStorePrice} por loja adicional</p> : <p className="mt-2 text-xs font-bold text-[#6b7d75]">1 loja incluída</p>}<div className="my-6 h-px bg-[#e4eae5]" /><div className="flex-1 space-y-3">{visibleFeatures.map(item => <div key={item} className="flex gap-3 text-sm font-bold leading-5 text-[#315548]"><span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#eaf6e2]"><Check className="h-3 w-3 text-[#57932f]" /></span>{item}</div>)}</div><div className="mt-6 flex flex-wrap gap-1.5">{plan.modules.slice(0, 6).map(module => <span key={module} className="rounded-full bg-[#f1f5f1] px-2.5 py-1 text-[10px] font-black text-[#567066]">{module}</span>)}</div><Button asChild className={`mt-7 h-14 w-full rounded-xl text-sm font-black ${plan.featured ? 'bg-[#ef6c20] text-white hover:bg-[#db5d16]' : 'bg-[#064733] text-white hover:bg-[#08392b]'}`}><a href="/login?tab=register" onClick={() => trackMarketing('landing_plan_click', plan.name)}>Testar {plan.name} por 14 dias<ArrowRight className="ml-2 h-4 w-4" /></a></Button></article>; })}</div>
          <p className="mt-6 text-center text-xs font-semibold text-[#84938d]">Sem comissão do PopSystem sobre pedidos. Tarifas de meios de pagamento são informadas separadamente.</p>
        </div>
      </section>

      <section id="duvidas" className="bg-[#f6f8f4] py-20"><div className="container grid gap-10 lg:grid-cols-[.65fr_1.35fr]"><div><Eyebrow>Suporte humano</Eyebrow><h2 className="text-4xl font-black tracking-[-.04em] text-[#073e2e]">Dúvidas de quem está pronto para mudar.</h2><p className="mt-5 text-base font-medium leading-7 text-[#6b7d75]">Nossa equipe conhece a rotina de restaurante e ajuda você a escolher o melhor caminho.</p><a href={WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => trackMarketing('landing_whatsapp_click', 'faq')} className="mt-7 inline-flex items-center gap-2 font-black text-[#e95f12]"><Headphones className="h-5 w-5" />Falar com a equipe</a></div><div className="grid gap-3 sm:grid-cols-2">{faqs.map(([question, answer]) => <article key={question} className="rounded-[20px] border border-[#e0e7e1] bg-white p-5"><h3 className="text-base font-black text-[#073e2e]">{question}</h3><p className="mt-3 text-sm font-medium leading-6 text-[#6d7e77]">{answer}</p></article>)}</div></div></section>

      <section className="relative overflow-hidden bg-[#ef6c20] py-16 text-white"><div className="absolute -right-20 -top-32 h-96 w-96 rounded-full border-[80px] border-white/10" /><div className="container relative flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center"><div className="max-w-3xl"><div className="text-xs font-black uppercase tracking-[.22em] text-white/70">Seu restaurante em perfeita sintonia</div><h2 className="mt-4 text-4xl font-black leading-[1.03] tracking-[-.045em] md:text-5xl">Veja tudo funcionando junto por 14 dias.</h2></div><div className="flex w-full flex-col gap-3 sm:w-auto"><Button asChild className="h-14 w-full rounded-xl bg-white px-7 text-base font-black text-[#d9560b] hover:bg-[#fff7ef]"><a href="/login?tab=register" onClick={() => trackMarketing('landing_signup_click', 'final')}>Começar teste grátis <ArrowRight className="ml-2 h-5 w-5" /></a></Button><a href={WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => trackMarketing('landing_whatsapp_click', 'final')} className="text-center text-sm font-bold text-white/85 hover:text-white">Prefiro falar pelo WhatsApp</a></div></div></section>

      <ScrollToTop />
    </LandingLayout>
  </>
);

export default LandingPage;
