import React from 'react';
import { Helmet } from 'react-helmet-async';
import {
  ArrowRight,
  BarChart3,
  Bot,
  Camera,
  Check,
  ChefHat,
  Clock3,
  FileCheck2,
  Fingerprint,
  Headphones,
  Megaphone,
  MessageCircle,
  MonitorSmartphone,
  MousePointerClick,
  PackageCheck,
  PlayCircle,
  QrCode,
  ReceiptText,
  Send,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Store,
  Target,
  TrendingUp,
  Users,
  UtensilsCrossed,
  WalletCards,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import LandingLayout from '@/components/landing/LandingLayout';
import ProductProofSection from '@/components/landing/ProductProofSection';
import { ScrollToTop } from '@/components/landing/ScrollToTop';
import { trackMarketing } from '@/lib/marketingAnalytics';

const SUPPORT_PHONE = '5585984570267';
const WHATSAPP_URL = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent('Olá! Quero conhecer o PopSystem e testar por 14 dias.')}`;
const SIGNUP_URL = '/login?tab=register';

const differentiators = [
  {
    icon: Target,
    title: 'Tráfego pago automatizado',
    text: 'Crie campanhas, conecte seus canais e transforme seus produtos em anúncios sem depender de uma operação paralela.',
    label: 'Mais clientes',
    tone: 'orange',
  },
  {
    icon: Clock3,
    title: 'Controle de ponto da equipe',
    text: 'Registre entradas, saídas e jornadas para acompanhar a rotina dos funcionários com mais organização.',
    label: 'Equipe em ordem',
    tone: 'lime',
  },
  {
    icon: FileCheck2,
    title: 'XML direto para a contabilidade',
    text: 'Configure o contador e automatize o envio dos documentos fiscais, reduzindo tarefas e esquecimentos no fechamento.',
    label: 'Fiscal sem correria',
    tone: 'cream',
  },
  {
    icon: Bot,
    title: 'WhatsApp Bot integrado',
    text: 'Atenda, organize conversas e conduza pedidos no canal em que seu cliente já está todos os dias.',
    label: 'Atendimento contínuo',
    tone: 'dark',
  },
  {
    icon: PackageCheck,
    title: 'Estoque, ficha técnica e CMV',
    text: 'Entenda o custo real de cada produto e acompanhe ingredientes antes que a falta vire venda perdida.',
    label: 'Margem protegida',
    tone: 'white',
  },
  {
    icon: Megaphone,
    title: 'Fidelidade que traz o cliente de volta',
    text: 'Cupons, banners, artes e relacionamento para vender novamente sem recomeçar do zero todo dia.',
    label: 'Recorrência',
    tone: 'white',
  },
];

const operationSteps = [
  { icon: MousePointerClick, number: '01', title: 'O pedido entra', text: 'PDV, mesa, totem, cardápio digital, delivery ou WhatsApp.' },
  { icon: ChefHat, number: '02', title: 'A operação executa', text: 'Cozinha, estoque, impressão, garçom e entrega trabalham juntos.' },
  { icon: WalletCards, number: '03', title: 'O caixa entende', text: 'Receitas, despesas, pagamentos e fechamento ficam organizados.' },
  { icon: Send, number: '04', title: 'A gestão avança', text: 'Relatórios, marketing e documentos fiscais seguem sem retrabalho.' },
];

const plans = [
  {
    name: 'Essencial',
    price: '189',
    description: 'Para vender, atender e organizar a rotina do restaurante.',
    items: ['PDV, caixa e financeiro', 'Cardápio digital e delivery', 'WhatsApp Bot e fidelidade', 'Impressão, balança e equipe'],
  },
  {
    name: 'Pro',
    price: '289',
    description: 'Para ganhar automação, inteligência e controle completo.',
    items: ['Tudo do Essencial', 'KDS e app do garçom', 'Estoque, ficha técnica e CMV', 'Marketing, IA e integrações'],
    featured: true,
  },
  {
    name: 'Multi',
    price: '389',
    description: 'Para redes e grupos que precisam enxergar todas as unidades.',
    items: ['Tudo do Pro', 'Gestão de múltiplas lojas', 'Visão consolidada da rede', 'Permissões por unidade'],
  },
];

const faqs = [
  ['O teste é realmente grátis?', 'Sim. Você pode criar sua conta e conhecer o PopSystem por 14 dias antes de escolher o plano ideal para a operação.'],
  ['Preciso instalar alguma coisa?', 'Você começa pelo navegador. Para impressão, balança e recursos locais, o app desktop completa a operação.'],
  ['Serve para salão e delivery?', 'Sim. O mesmo sistema conecta balcão, mesas, comandas, retirada, delivery próprio, cardápio digital e canais integrados.'],
  ['Consigo cadastrar minha equipe?', 'Sim. Você organiza usuários, permissões, garçons, motoboys e o controle de ponto dos funcionários.'],
  ['Como funciona o envio de XML?', 'A configuração fiscal permite informar o destinatário responsável e automatizar o compartilhamento dos documentos com a contabilidade.'],
  ['Tenho ajuda para começar?', 'Sim. Nossa equipe acompanha a implantação e ajuda a configurar o sistema para a rotina do seu restaurante.'],
];

const Eyebrow = ({ children, light = false }: { children: React.ReactNode; light?: boolean }) => (
  <div className={`mb-4 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[.22em] ${light ? 'text-[#bff082]' : 'text-[#e95f12]'}`}>
    <span className="h-2 w-2 rounded-full bg-current" />
    {children}
  </div>
);

const HeroVisual = () => (
  <div className="relative mx-auto min-h-[510px] w-full max-w-[790px] sm:min-h-[590px] lg:min-h-[614px]">
    <div className="absolute right-[7%] top-[7%] h-[75%] w-[70%] rounded-full bg-[radial-gradient(circle,rgba(140,207,90,.14)_0%,rgba(140,207,90,0)_70%)]" />
    <div className="absolute bottom-[5%] left-[8%] h-24 w-[78%] rounded-[50%] bg-[#133f31]/12 blur-2xl" />

    <img
      src="/CRIATIVOS/mascote-popsystem.webp"
      alt="Mascote PopSystem apresentando a plataforma"
      width="680"
      height="1020"
      decoding="async"
      className="absolute left-[28%] top-[6%] z-10 w-[39%] drop-shadow-[0_24px_18px_rgba(0,57,40,.18)]"
    />
    <img
      src="/CRIATIVOS/totem-popsystem-cutout.webp"
      alt="Totem de autoatendimento PopSystem"
      width="941"
      height="1672"
      decoding="async"
      className="absolute -right-[1%] bottom-[1%] z-20 h-[96%] w-auto drop-shadow-[0_28px_24px_rgba(0,50,35,.2)] sm:h-[100%]"
    />
    <img
      src="/CRIATIVOS/dashboard-notebook-cutout.webp"
      alt="Painel de gestão do PopSystem em um notebook"
      width="1536"
      height="1024"
      decoding="async"
      className="absolute bottom-0 left-[-3%] z-30 w-[62%] drop-shadow-[0_30px_22px_rgba(0,47,33,.22)] sm:left-[-5%] sm:w-[62%]"
    />
    <img
      src="/CRIATIVOS/app-garcom.webp"
      alt="Aplicativo do garçom PopSystem em um celular"
      width="720"
      height="1080"
      decoding="async"
      className="absolute bottom-[-1%] left-[47%] z-40 h-[48%] w-auto -rotate-[1deg] drop-shadow-[0_25px_18px_rgba(0,39,27,.28)] sm:h-[52%]"
    />
  </div>
);

const LandingPage = () => (
  <>
    <Helmet>
      <title>PopSystem | O sistema que trabalha junto com o seu restaurante</title>
      <meta name="description" content="PDV, delivery, mesas, estoque, financeiro, equipe, marketing automatizado, WhatsApp e fiscal em um único sistema para restaurantes." />
      <meta name="keywords" content="sistema para restaurante, PDV restaurante, tráfego pago automatizado, controle de ponto, XML contabilidade, cardápio digital, delivery" />
      <meta property="og:title" content="PopSystem | Seu restaurante inteiro trabalhando junto" />
      <meta property="og:description" content="Da venda ao marketing, da equipe à contabilidade. Teste o PopSystem grátis por 14 dias." />
      <meta property="og:image" content="https://popsystem.com.br/og-popsystem.webp" />
      <meta name="twitter:card" content="summary_large_image" />
      <link rel="canonical" href="https://popsystem.com.br/" />
    </Helmet>

    <LandingLayout>
      <section id="solucoes" className="relative scroll-mt-24 overflow-hidden bg-white">
        <div className="absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(circle_at_68%_42%,rgba(129,194,84,.08),transparent_42%)]" />
        <div className="container relative grid min-h-[650px] items-center gap-5 px-5 pb-4 pt-10 2xl:px-0 lg:grid-cols-[.8fr_1.2fr] lg:pt-5">
          <div className="relative z-10 max-w-[610px] pb-8 lg:pb-2">
            <div className="mb-5 inline-flex items-center rounded-lg bg-[#c3ea9d] px-3 py-1.5 text-[11px] font-black uppercase tracking-[.03em] text-[#0a4b35]">
              Sistema completo para restaurantes
            </div>
            <h1 className="text-[2.8rem] font-black leading-[1.04] tracking-[-.055em] text-[#062f24] sm:text-6xl lg:text-[4.2rem]">
              Seu restaurante<br />
              <span className="relative inline-block text-[#48ad5d]">
                integrado na
                <span className="absolute -bottom-1 left-[-1%] h-[5px] w-[102%] -rotate-1 rounded-full bg-[#ff650f]" />
              </span><br />
              palma da mão.
            </h1>
            <p className="mt-5 max-w-[570px] text-base font-medium leading-7 text-[#304b42] sm:text-lg">
              Mais vendas, mais controle e mais lucro.<br className="hidden sm:block" /> Da produção ao financeiro, tudo em um só sistema.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {[
                [TrendingUp, 'Mais vendas', 'Cardápio digital, tráfego pago automático e upsell inteligente.'],
                [ShieldCheck, 'Mais controle', 'Pedidos, estoque, mesas, funcionários e financeiro em tempo real.'],
                [WalletCards, 'Mais lucro', 'Dados estratégicos para tomar decisões e crescer de verdade.'],
              ].map(([Icon, title, text]) => {
                const BenefitIcon = Icon as typeof TrendingUp;
                return (
                  <div key={String(title)} className="flex gap-3 sm:block">
                    <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-[#9fcbb1] bg-white text-[#248648] shadow-sm"><BenefitIcon className="h-5 w-5" /></div>
                    <div className="sm:mt-2"><h2 className="text-[12px] font-black text-[#0a3428]">{String(title)}</h2><p className="mt-1 text-[10px] font-semibold leading-[1.55] text-[#52675f]">{String(text)}</p></div>
                  </div>
                );
              })}
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild className="h-13 w-full rounded-xl bg-[#f56616] px-7 text-sm font-black text-white shadow-[0_14px_28px_-14px_rgba(239,108,32,.78)] hover:bg-[#df5a0d] sm:w-auto">
                <a href="#experiencia" onClick={() => trackMarketing('landing_demo_click', 'hero')}><PlayCircle className="mr-2 h-5 w-5" />Ver o sistema em ação</a>
              </Button>
              <Button asChild variant="outline" className="h-13 w-full rounded-xl border-[#7da891] bg-white px-6 text-sm font-black text-[#0a4936] hover:bg-[#f1f8f2] sm:w-auto">
                <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => trackMarketing('landing_whatsapp_click', 'hero')}><MessageCircle className="mr-2 h-5 w-5" />Fale com um especialista</a>
              </Button>
            </div>
            <div className="mt-6 flex items-center gap-2 text-[11px] font-bold text-[#52675f]">
              <ShieldCheck className="h-5 w-5 text-[#2b9853]" />Sistema seguro, estável e 100% em nuvem
            </div>
          </div>
          <HeroVisual />
        </div>
      </section>

      <section className="relative z-20 bg-white pb-4" aria-label="Principais diferenciais">
        <div className="container px-5 2xl:px-0">
          <div className="grid overflow-hidden rounded-[20px] border border-[#cfe0d5] bg-white shadow-[0_18px_45px_-34px_rgba(0,56,38,.36)] sm:grid-cols-2 lg:grid-cols-7">
            {[
              [Megaphone, 'Tráfego pago automático', 'Mais clientes no piloto automático e no delivery.'],
              [ShieldCheck, 'Pagamento garantido', 'Pedido só é aprovado após o dinheiro entrar na conta.'],
              [Clock3, 'Controle de ponto inteligente', 'Registro com biometria e relatórios automáticos.'],
              [ReceiptText, 'Fiscal nativo', 'NFC-e + Módulo Fiscal (IBS/CBS) integrado ao sistema.'],
              [FileCheck2, 'Notas para contabilidade', 'Envio automático das notas e relatórios para o contador.'],
              [Camera, 'Despesa por foto', 'Lance despesas com foto do comprovante e categorize.'],
              [BarChart3, 'Relatórios e indicadores', 'Dashboards completos para decisões mais inteligentes.'],
            ].map(([Icon, title, text], index) => {
              const FeatureIcon = Icon as typeof Megaphone;
              return (
                <article key={String(title)} className={`flex min-h-[128px] gap-3 px-4 py-5 ${index > 0 ? 'border-t border-[#e1e9e3] sm:border-l sm:border-t-0' : ''} lg:min-h-[134px]`}>
                  <FeatureIcon className={`mt-0.5 h-8 w-8 flex-none ${index === 0 ? 'text-[#ef6c20]' : 'text-[#176445]'}`} strokeWidth={1.65} />
                  <div><h2 className="text-[11px] font-black leading-[1.25] text-[#0a3428]">{String(title)}</h2><p className="mt-2 text-[9px] font-semibold leading-[1.55] text-[#63736d]">{String(text)}</p></div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="vantagens" className="scroll-mt-24 bg-white pb-0 pt-1" aria-label="Resultados e confiança">
        <div className="container px-5 2xl:px-0">
          <div className="grid overflow-hidden rounded-[18px] shadow-[0_20px_45px_-32px_rgba(0,52,36,.5)] lg:grid-cols-[1.25fr_.8fr_.9fr_.85fr_1.25fr_1.45fr]">
            <div className="flex items-center gap-4 bg-[#065039] px-7 py-6 text-white"><ShieldCheck className="h-10 w-10 flex-none text-[#b6e879]" /><div><div className="text-sm font-black">Sistema 100% em nuvem</div><div className="mt-1 text-[10px] font-medium text-white/72">Seguro, rápido e sempre disponível.</div></div></div>
            {[['+800', 'restaurantes', 'confiam'], ['+50 mil', 'pedidos por dia', 'através do sistema'], ['99,9%', 'tempo de atividade', 'garantido']].map(([value, label, helper]) => <div key={value} className="border-t border-white/15 bg-[#065039] px-7 py-6 text-white lg:border-l lg:border-t-0"><div className="text-3xl font-black tracking-[-.05em]">{value}</div><div className="mt-1 text-xs font-black">{label}</div><div className="mt-1 text-[10px] text-white/65">{helper}</div></div>)}
            <div className="flex items-center gap-4 border-t border-white/15 bg-[#065039] px-7 py-6 text-white lg:border-l lg:border-t-0"><MessageCircle className="h-9 w-9 flex-none text-[#b6e879]" /><div><div className="text-sm font-black leading-tight">Suporte humano<br />e especializado</div><div className="mt-1 text-[10px] text-white/68">Sempre que precisar.</div></div></div>
            <div className="bg-[#ff650f] px-7 py-5 text-white"><div className="text-base font-black leading-tight">Pronto para transformar<br />seu restaurante?</div><Button asChild className="mt-3 h-10 w-full rounded-lg bg-[#064d37] text-xs font-black text-white hover:bg-[#043b2b]"><a href={SIGNUP_URL} onClick={() => trackMarketing('landing_signup_click', 'proof_strip')}>Agendar demonstração <ArrowRight className="ml-2 h-4 w-4" /></a></Button></div>
          </div>
        </div>
      </section>

      <section id="funcionalidades" className="overflow-hidden bg-white py-24">
        <div className="container">
          <div className="grid gap-8 lg:grid-cols-[.78fr_1.22fr] lg:items-end">
            <div><Eyebrow>O que torna o PopSystem diferente</Eyebrow><h2 className="text-4xl font-black leading-[1.02] tracking-[-.045em] text-[#073e2e] md:text-5xl">Enquanto você cuida do sabor, o sistema cuida do trabalho invisível.</h2></div>
            <p className="max-w-2xl text-lg font-medium leading-8 text-[#64776f]">Não é só registrar pedidos. O PopSystem conecta as tarefas que roubam tempo do dono e transforma cada área em parte do mesmo fluxo.</p>
          </div>

          <div className="mt-14 grid auto-rows-fr gap-4 md:grid-cols-2 xl:grid-cols-3">
            {differentiators.map(({ icon: Icon, title, text, label, tone }, index) => {
              const styles = tone === 'orange'
                ? 'border-[#ef6c20] bg-[#ef6c20] text-white shadow-[0_24px_55px_-28px_rgba(239,108,32,.8)]'
                : tone === 'lime'
                  ? 'border-[#b8dd8e] bg-[#eaf7df] text-[#073e2e]'
                  : tone === 'dark'
                    ? 'border-[#073e2e] bg-[#073e2e] text-white'
                    : tone === 'cream'
                      ? 'border-[#f0d6c4] bg-[#fff7f0] text-[#073e2e]'
                      : 'border-[#dfe8e1] bg-white text-[#073e2e]';
              const muted = tone === 'orange' || tone === 'dark' ? 'text-white/68' : 'text-[#687b73]';
              return (
                <article key={title} className={`group relative flex min-h-[280px] flex-col overflow-hidden rounded-[30px] border p-7 transition duration-300 hover:-translate-y-1 hover:shadow-xl ${(index === 0 || index === 3) ? 'xl:col-span-2 xl:px-9' : ''} ${styles}`}>
                  {(index === 0 || index === 3) ? <div className="absolute -bottom-20 -right-16 h-56 w-56 rounded-full border-[38px] border-white/10 transition duration-500 group-hover:scale-110" /> : null}
                  <div className="flex items-start justify-between gap-4">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tone === 'orange' || tone === 'dark' ? 'bg-white/12' : 'bg-white shadow-sm'}`}><Icon className={`h-6 w-6 ${tone === 'orange' ? 'text-white' : tone === 'dark' ? 'text-[#bff082]' : 'text-[#e95f12]'}`} /></div>
                    <span className={`rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-[.16em] ${tone === 'orange' || tone === 'dark' ? 'border-white/15 bg-white/10 text-white/75' : 'border-[#dce7df] bg-white/75 text-[#628073]'}`}>{label}</span>
                  </div>
                  <h3 className={`relative mt-10 font-black leading-tight ${(index === 0 || index === 3) ? 'max-w-xl text-3xl' : 'text-2xl'}`}>{title}</h3>
                  <p className={`relative mt-3 max-w-2xl text-sm font-medium leading-6 ${muted}`}>{text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="experiencia" className="relative overflow-hidden bg-[#f3f5ee] py-24">
        <div className="absolute -left-28 top-10 h-96 w-96 rounded-full bg-[#a7dd72]/22 blur-3xl" />
        <div className="absolute -right-28 bottom-0 h-[440px] w-[440px] rounded-full bg-[#ef6c20]/14 blur-3xl" />
        <div className="container relative">
          <div className="mx-auto max-w-3xl text-center"><Eyebrow>Uma plataforma. Todas as telas.</Eyebrow><h2 className="text-4xl font-black leading-[1.03] tracking-[-.045em] text-[#073e2e] md:text-5xl">A tecnologia aparece onde sua operação precisa.</h2><p className="mt-5 text-lg font-medium leading-8 text-[#677a72]">No autoatendimento, no salão e na gestão. Cada tela tem seu papel, mas a informação é uma só.</p></div>

          <div className="relative mx-auto mt-14 min-h-[780px] max-w-6xl overflow-hidden rounded-[42px] border border-[#d9e6db] bg-[linear-gradient(145deg,#ffffff_0%,#edf6e9_55%,#fff4e9_100%)] shadow-[0_40px_100px_-58px_rgba(0,56,39,.55)] sm:min-h-[860px] lg:min-h-[720px]">
            <div className="absolute inset-0 opacity-[.36]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(7,62,46,.18) 1px, transparent 0)', backgroundSize: '25px 25px' }} />
            <div className="absolute -left-24 bottom-[-18%] h-[620px] w-[620px] rounded-full bg-[#073e2e]" />
            <div className="absolute -right-32 top-[-22%] h-[480px] w-[480px] rounded-full border-[68px] border-[#ef6c20]/15" />

            <div className="relative z-20 grid grid-cols-2 gap-2 p-5 sm:grid-cols-4 sm:p-8">
              {[
                [Smartphone, 'Garçom ágil'], [Store, 'Autoatendimento'], [BarChart3, 'Gestão ao vivo'], [ShieldCheck, 'Dados seguros'],
              ].map(([Icon, label]) => { const DeviceIcon = Icon as typeof Smartphone; return <div key={String(label)} className="flex items-center justify-center gap-2 rounded-2xl border border-white/70 bg-white/80 px-3 py-3.5 text-[11px] font-black text-[#315548] shadow-sm backdrop-blur"><DeviceIcon className="h-4 w-4 text-[#ef6c20]" />{String(label)}</div>; })}
            </div>

            <img src="/CRIATIVOS/dashboard-notebook-cutout.webp" alt="PopSystem no notebook" width="1536" height="1024" loading="lazy" decoding="async" className="absolute bottom-[23%] left-[10%] z-10 w-[83%] drop-shadow-[0_34px_28px_rgba(0,45,32,.35)] sm:bottom-[18%] lg:bottom-[2%] lg:left-[19%] lg:w-[68%]" />
            <img src="/CRIATIVOS/totem-popsystem-cutout.webp" alt="Totem de autoatendimento PopSystem" width="941" height="1672" loading="lazy" decoding="async" className="absolute -bottom-[4%] -left-[6%] z-30 w-[40%] max-w-[340px] drop-shadow-[0_30px_22px_rgba(0,30,22,.38)] sm:left-[1%] sm:w-[32%] lg:-bottom-[9%] lg:left-[2%] lg:w-[25%]" />
            <img src="/CRIATIVOS/app-garcom.webp" alt="Aplicativo do garçom PopSystem" width="720" height="1080" loading="lazy" decoding="async" className="absolute -bottom-[5%] -right-[7%] z-30 w-[39%] max-w-[320px] rotate-[5deg] drop-shadow-[0_34px_26px_rgba(0,30,22,.4)] sm:right-[1%] sm:w-[32%] lg:-bottom-[12%] lg:right-[3%] lg:w-[25%]" />

            <div className="absolute bottom-[13%] left-[27%] z-40 hidden max-w-[230px] rounded-[22px] border border-white/15 bg-[#ef6c20] p-4 text-white shadow-2xl sm:block lg:bottom-[7%] lg:left-[24%]">
              <div className="flex items-center gap-2 text-sm font-black"><QrCode className="h-4 w-4" />Pedido sem fila</div><p className="mt-1 text-[10px] font-bold leading-4 text-white/70">Totem, QR Code e cardápio digital conectados ao mesmo fluxo.</p>
            </div>
            <div className="absolute right-[8%] top-[20%] z-40 hidden max-w-[220px] rounded-[22px] border border-[#dbe7dc] bg-white/90 p-4 shadow-xl backdrop-blur sm:block lg:top-[22%]">
              <div className="flex items-center gap-2 text-sm font-black text-[#073e2e]"><BarChart3 className="h-4 w-4 text-[#65a73c]" />Gestão sem adivinhação</div><p className="mt-1 text-[10px] font-bold leading-4 text-[#718078]">Caixa, custos e vendas visíveis enquanto o restaurante acontece.</p>
            </div>
          </div>
        </div>
      </section>

      <ProductProofSection />

      <section id="inteligencia" className="bg-[#f5f6f0] py-24">
        <div className="container">
          <div className="mx-auto max-w-3xl text-center"><Eyebrow>Do clique ao resultado</Eyebrow><h2 className="text-4xl font-black leading-[1.04] tracking-[-.045em] text-[#073e2e] md:text-5xl">Uma venda movimenta o restaurante inteiro. Aqui, tudo acompanha.</h2></div>
          <div className="relative mt-14 grid gap-4 lg:grid-cols-4">
            <div className="absolute left-[12%] right-[12%] top-11 hidden h-px bg-gradient-to-r from-transparent via-[#90bd72] to-transparent lg:block" />
            {operationSteps.map(({ icon: Icon, number, title, text }) => (
              <article key={number} className="relative rounded-[26px] border border-[#dfe8e1] bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between"><div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#073e2e] text-white shadow-lg"><Icon className="h-5 w-5" /></div><span className="text-xs font-black tracking-[.18em] text-[#c7d4ca]">{number}</span></div>
                <h3 className="mt-8 text-xl font-black text-[#073e2e]">{title}</h3><p className="mt-3 text-sm font-medium leading-6 text-[#6a7c75]">{text}</p>
              </article>
            ))}
          </div>

          <div className="mt-10 grid overflow-hidden rounded-[32px] border border-[#dce7df] bg-white lg:grid-cols-[.78fr_1.22fr]">
            <div className="relative overflow-hidden bg-[#073e2e] p-8 text-white sm:p-10">
              <div className="absolute -bottom-24 -right-16 h-64 w-64 rounded-full bg-[#ef6c20]/25 blur-3xl" />
              <Fingerprint className="relative h-9 w-9 text-[#bff082]" /><h3 className="relative mt-8 text-3xl font-black tracking-[-.04em]">O dono deixa de ser o integrador de tudo.</h3><p className="relative mt-4 text-sm font-medium leading-7 text-white/62">Permissões, histórico e automações mantêm a operação andando mesmo quando você não está ao lado de cada tela.</p>
            </div>
            <div className="grid gap-px bg-[#e2e9e3] sm:grid-cols-2">
              {[
                [Users, 'Equipe organizada', 'Acessos e responsabilidades para cada função.'],
                [ReceiptText, 'Fiscal conectado', 'Documentos e informações prontos para seguir.'],
                [TrendingUp, 'Marketing acionável', 'Transforme produtos e clientes em novas vendas.'],
                [Zap, 'Operação em tempo real', 'Menos espera entre pedido, produção e entrega.'],
              ].map(([Icon, title, text]) => { const GridIcon = Icon as typeof Users; return <div key={String(title)} className="bg-white p-7"><GridIcon className="h-5 w-5 text-[#ef6c20]" /><h4 className="mt-6 text-lg font-black text-[#073e2e]">{String(title)}</h4><p className="mt-2 text-sm font-medium leading-6 text-[#6b7c75]">{String(text)}</p></div>; })}
            </div>
          </div>
        </div>
      </section>

      <section id="planos" className="bg-white py-24">
        <div className="container">
          <div className="mx-auto max-w-3xl text-center"><Eyebrow>Comece sem compromisso</Eyebrow><h2 className="text-4xl font-black tracking-[-.045em] text-[#073e2e] md:text-5xl">14 dias para sentir a diferença na rotina.</h2><p className="mt-5 text-lg font-medium text-[#687a73]">Escolha o plano depois de conhecer a plataforma. Sem comissão do sistema sobre seus pedidos.</p></div>
          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {plans.map(plan => (
              <article key={plan.name} className={`relative flex flex-col rounded-[28px] border p-7 ${plan.featured ? 'border-[#ef6c20] bg-[#fff8f2] shadow-[0_26px_70px_-32px_rgba(239,108,32,.65)] lg:-translate-y-3' : 'border-[#dfe7e1] bg-white'}`}>
                {plan.featured ? <span className="absolute -top-3 left-7 rounded-full bg-[#ef6c20] px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-white">Mais completo</span> : null}
                <h3 className="text-2xl font-black text-[#073e2e]">{plan.name}</h3><p className="mt-2 min-h-[52px] text-sm font-medium leading-6 text-[#6d7e77]">{plan.description}</p>
                <div className="mt-7 flex items-end gap-1 text-[#073e2e]"><span className="mb-2 text-sm font-black">R$</span><strong className="text-5xl font-black tracking-[-.06em]">{plan.price}</strong><span className="mb-2 text-sm font-bold text-[#7d8d87]">/mês</span></div>
                <div className="my-7 h-px bg-[#e4eae5]" /><div className="flex-1 space-y-3">{plan.items.map(item => <div key={item} className="flex gap-3 text-sm font-bold text-[#315548]"><span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#eaf6e2]"><Check className="h-3 w-3 text-[#57932f]" /></span>{item}</div>)}</div>
                <Button asChild className={`mt-8 h-13 w-full rounded-xl text-sm font-black ${plan.featured ? 'bg-[#ef6c20] text-white hover:bg-[#db5d16]' : 'bg-[#073e2e] text-white hover:bg-[#0a4434]'}`}><a href={SIGNUP_URL} onClick={() => trackMarketing('landing_plan_click', plan.name)}>Testar grátis por 14 dias<ArrowRight className="ml-2 h-4 w-4" /></a></Button>
              </article>
            ))}
          </div>
          <p className="mt-6 text-center text-xs font-semibold text-[#84938d]">Recursos fiscais e integrações dependem da configuração aplicável à operação. Tarifas de meios de pagamento são informadas separadamente.</p>
        </div>
      </section>

      <section id="duvidas" className="bg-[#f5f6f0] py-24">
        <div className="container grid gap-12 lg:grid-cols-[.68fr_1.32fr]">
          <div><Eyebrow>Antes de começar</Eyebrow><h2 className="text-4xl font-black tracking-[-.04em] text-[#073e2e]">Dúvidas diretas, respostas claras.</h2><p className="mt-5 text-base font-medium leading-7 text-[#6b7d75]">Nossa equipe conhece a rotina de restaurante e ajuda você a colocar a operação para rodar.</p><a href={WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => trackMarketing('landing_whatsapp_click', 'faq')} className="mt-7 inline-flex items-center gap-2 font-black text-[#e95f12]"><Headphones className="h-5 w-5" />Falar com a equipe</a></div>
          <div className="grid gap-3 sm:grid-cols-2">{faqs.map(([question, answer]) => <article key={question} className="rounded-[22px] border border-[#dfe7e1] bg-white p-5"><h3 className="text-base font-black text-[#073e2e]">{question}</h3><p className="mt-3 text-sm font-medium leading-6 text-[#6d7e77]">{answer}</p></article>)}</div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#ef6c20] py-20 text-white">
        <div className="absolute -right-24 -top-40 h-[480px] w-[480px] rounded-full border-[90px] border-white/10" />
        <div className="absolute -bottom-52 left-[20%] h-96 w-96 rounded-full bg-[#073e2e]/20 blur-3xl" />
        <div className="container relative flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
          <div className="max-w-3xl"><div className="text-xs font-black uppercase tracking-[.22em] text-white/70">Seu próximo turno pode ser diferente</div><h2 className="mt-4 text-4xl font-black leading-[1.02] tracking-[-.045em] md:text-5xl">Coloque o PopSystem para trabalhar no seu restaurante.</h2><p className="mt-5 text-lg font-bold text-white/75">Comece agora. Explore tudo por 14 dias.</p></div>
          <div className="flex w-full flex-col gap-3 sm:w-auto"><Button asChild className="h-14 w-full rounded-2xl bg-white px-7 text-base font-black text-[#d9560b] hover:bg-[#fff7ef]"><a href={SIGNUP_URL} onClick={() => trackMarketing('landing_signup_click', 'final_14_days')}>Teste grátis por 14 dias <ArrowRight className="ml-2 h-5 w-5" /></a></Button><a href={WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => trackMarketing('landing_whatsapp_click', 'final')} className="text-center text-sm font-bold text-white/85 hover:text-white">Prefiro falar pelo WhatsApp</a></div>
        </div>
      </section>

      <ScrollToTop />
    </LandingLayout>
  </>
);

export default LandingPage;
