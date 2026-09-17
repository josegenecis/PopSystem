import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Boxes,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Headphones,
  Heart,
  Lightbulb,
  MessageCircle,
  Play,
  Search,
  Settings,
  Sparkles,
  Star,
  Store,
  Trophy,
  Truck,
  UsersRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

type CategoryId = 'all' | 'start' | 'sales' | 'delivery' | 'products' | 'finance' | 'customers' | 'reports' | 'settings';
type SortMode = 'recent' | 'popular' | 'az';

type Tutorial = {
  id: string;
  title: string;
  description: string;
  category: Exclude<CategoryId, 'all'>;
  duration: string;
  thumbnail: string;
  popularity: number;
  publishedAt: string;
  videoUrl?: string;
};

const SUPPORT_URL = `https://wa.me/5585984570267?text=${encodeURIComponent('Olá! Preciso de ajuda com o PopSystem.')}`;
const PROGRESS_KEY = 'popsystem:tutorials:completed';
const FAVORITES_KEY = 'popsystem:tutorials:favorites';

const categories: Array<{
  id: CategoryId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'all', label: 'Todos', description: 'Toda a central', icon: BookOpenCheck },
  { id: 'start', label: 'Primeiros passos', description: 'Comece por aqui', icon: Play },
  { id: 'sales', label: 'PDV e vendas', description: 'Venda com agilidade', icon: Store },
  { id: 'delivery', label: 'Delivery', description: 'Pedidos e entregas', icon: Truck },
  { id: 'products', label: 'Produtos e estoque', description: 'Organize seu catálogo', icon: Boxes },
  { id: 'finance', label: 'Financeiro', description: 'Controle seu dinheiro', icon: CircleDollarSign },
  { id: 'customers', label: 'Clientes', description: 'Atenda melhor', icon: UsersRound },
  { id: 'reports', label: 'Relatórios', description: 'Decida com dados', icon: BarChart3 },
  { id: 'settings', label: 'Configurações', description: 'Deixe do seu jeito', icon: Settings },
];

const tutorials: Tutorial[] = [
  {
    id: 'welcome',
    title: 'Conhecendo o PopSystem',
    description: 'Um passeio rápido pelas principais telas e atalhos para começar com segurança.',
    category: 'start',
    duration: '2:18',
    thumbnail: '/CRIATIVOS/dashboard-notebook.webp',
    popularity: 1700,
    publishedAt: '2026-09-17',
  },
  {
    id: 'first-sale',
    title: 'Como realizar uma venda no PDV',
    description: 'Adicione produtos, escolha o pagamento e finalize uma venda completa.',
    category: 'sales',
    duration: '3:45',
    thumbnail: '/CRIATIVOS/mockup notebook.png',
    popularity: 3400,
    publishedAt: '2026-09-16',
  },
  {
    id: 'products',
    title: 'Cadastro de produtos sem complicação',
    description: 'Cadastre produtos, categorias, adicionais, preços e imagens do cardápio.',
    category: 'products',
    duration: '4:12',
    thumbnail: '/CRIATIVOS/imagem capa site.png',
    popularity: 2800,
    publishedAt: '2026-09-15',
  },
  {
    id: 'delivery',
    title: 'Configurando o delivery',
    description: 'Defina regiões, taxas, horários e deixe o recebimento de pedidos pronto.',
    category: 'delivery',
    duration: '5:20',
    thumbnail: '/landing/hero-restaurante-popsystem.webp',
    popularity: 2100,
    publishedAt: '2026-09-14',
  },
  {
    id: 'inventory',
    title: 'Controle de estoque na prática',
    description: 'Entenda entradas, saídas, insumos e alertas para não perder vendas.',
    category: 'products',
    duration: '3:15',
    thumbnail: '/CRIATIVOS/TOTEM.png',
    popularity: 1600,
    publishedAt: '2026-09-13',
  },
  {
    id: 'finance',
    title: 'Financeiro organizado de verdade',
    description: 'Acompanhe caixa, contas a pagar e receber, despesas e resultados.',
    category: 'finance',
    duration: '4:37',
    thumbnail: '/CRIATIVOS/dashboard-notebook.webp',
    popularity: 1900,
    publishedAt: '2026-09-12',
  },
  {
    id: 'reports',
    title: 'Relatórios que ajudam seu negócio',
    description: 'Veja os números certos para vender melhor e proteger sua margem.',
    category: 'reports',
    duration: '3:50',
    thumbnail: '/CRIATIVOS/dashboard-notebook-cutout.webp',
    popularity: 2300,
    publishedAt: '2026-09-11',
  },
  {
    id: 'settings',
    title: 'Configurações essenciais da loja',
    description: 'Ajuste perfil, equipe, impressão, notificações e integrações importantes.',
    category: 'settings',
    duration: '4:05',
    thumbnail: '/CRIATIVOS/app-garcom.webp',
    popularity: 1400,
    publishedAt: '2026-09-10',
  },
  {
    id: 'customers',
    title: 'Cadastro e relacionamento com clientes',
    description: 'Mantenha os dados organizados e use o histórico para atender melhor.',
    category: 'customers',
    duration: '3:28',
    thumbnail: '/CRIATIVOS/mocup garçom 2.png',
    popularity: 1200,
    publishedAt: '2026-09-09',
  },
];

const readStoredIds = (key: string) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
};

const categoryMap = new Map(categories.map((category) => [category.id, category]));

const Tutorials = () => {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryId>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [selectedTutorial, setSelectedTutorial] = useState<Tutorial | null>(null);
  const [completedIds, setCompletedIds] = useState<string[]>(() => readStoredIds(PROGRESS_KEY));
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readStoredIds(FAVORITES_KEY));

  useEffect(() => {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(completedIds));
  }, [completedIds]);

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteIds));
  }, [favoriteIds]);

  const filteredTutorials = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
    const filtered = tutorials.filter((tutorial) => {
      const category = categoryMap.get(tutorial.category)?.label || '';
      const matchesCategory = activeCategory === 'all' || tutorial.category === activeCategory;
      const matchesQuery = !normalizedQuery
        || `${tutorial.title} ${tutorial.description} ${category}`.toLocaleLowerCase('pt-BR').includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === 'popular') return b.popularity - a.popularity;
      if (sortMode === 'az') return a.title.localeCompare(b.title, 'pt-BR');
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
  }, [activeCategory, query, sortMode]);

  const completedCount = tutorials.filter((tutorial) => completedIds.includes(tutorial.id)).length;
  const completionPercent = Math.round((completedCount / tutorials.length) * 100);
  const popularTutorials = useMemo(() => [...tutorials].sort((a, b) => b.popularity - a.popularity).slice(0, 5), []);

  const toggleCompleted = (tutorialId: string) => {
    setCompletedIds((current) => current.includes(tutorialId)
      ? current.filter((id) => id !== tutorialId)
      : [...current, tutorialId]);
  };

  const toggleFavorite = (tutorialId: string) => {
    setFavoriteIds((current) => current.includes(tutorialId)
      ? current.filter((id) => id !== tutorialId)
      : [...current, tutorialId]);
  };

  const focusSearch = () => {
    document.getElementById('tutorial-search')?.focus();
  };

  return (
    <>
      <Helmet>
        <title>Tutoriais | PopSystem</title>
        <meta name="description" content="Aprenda a usar todos os recursos do PopSystem com tutoriais rápidos e objetivos." />
      </Helmet>

      <div className="mx-auto w-full max-w-[1600px] space-y-5 pb-8">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-[#ff6b00]">
              <Sparkles className="h-4 w-4" /> Central de aprendizado
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-[-0.035em] text-[#073e2e] sm:text-3xl">Tutoriais PopSystem</h1>
            <p className="mt-1 text-sm font-medium text-slate-500">Aprenda no seu ritmo e deixe a operação cada dia mais simples.</p>
          </div>
          <Button variant="outline" className="w-fit rounded-xl border-[#cfe0d6] text-[#07553d]" onClick={() => window.open(SUPPORT_URL, '_blank', 'noopener,noreferrer')}>
            <Headphones className="mr-2 h-4 w-4" /> Preciso de ajuda
          </Button>
        </div>

        <section className="relative isolate min-h-[330px] overflow-hidden rounded-[28px] bg-[#064733] shadow-[0_30px_80px_-40px_rgba(0,50,35,0.75)] lg:min-h-[360px]">
          <img src="/landing/hero-restaurante-popsystem.webp" alt="Restaurante usando o PopSystem" className="absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-luminosity" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,#043e2e_0%,rgba(4,62,46,0.96)_47%,rgba(4,62,46,0.64)_72%,rgba(4,62,46,0.9)_100%)]" />
          <div className="absolute -left-16 -top-24 h-64 w-64 rounded-full border-[48px] border-white/[0.05]" />
          <div className="absolute -bottom-24 right-[24%] h-60 w-60 rounded-full bg-[#ff6b00]/25 blur-3xl" />

          <div className="relative z-10 grid min-h-[330px] items-center gap-6 px-6 py-8 sm:px-9 lg:min-h-[360px] lg:grid-cols-[1.15fr_.55fr_.7fr] lg:px-12">
            <div className="max-w-2xl">
              <img src="/LOGOMARCA/logo-pop.webp" alt="PopSystem" className="mb-5 h-10 w-auto rounded-xl bg-white px-3 py-2 shadow-lg" />
              <Badge className="border border-[#bde98f]/20 bg-[#bde98f]/15 text-[#d8ffb2] hover:bg-[#bde98f]/15">APRENDA. EVOLUA. VENDA MAIS.</Badge>
              <h2 className="mt-4 text-3xl font-black leading-[1.08] tracking-[-0.045em] text-white sm:text-4xl lg:text-5xl">
                Domine o PopSystem de um jeito <span className="text-[#ff8a32]">leve e prático.</span>
              </h2>
              <p className="mt-4 max-w-xl text-sm font-medium leading-6 text-white/75 sm:text-base">Vídeos rápidos para você e sua equipe aproveitarem cada recurso e ganharem tempo na rotina do restaurante.</p>

              <div className="mt-6 flex max-w-2xl overflow-hidden rounded-2xl border border-white/20 bg-white shadow-xl">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <Input id="tutorial-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="O que você quer aprender hoje?" className="h-14 border-0 bg-white pl-12 text-base shadow-none focus-visible:ring-0" />
                </div>
                <Button className="h-14 rounded-none bg-[#ff6b00] px-6 font-black hover:bg-[#e85d00]" onClick={focusSearch}>Buscar</Button>
              </div>
            </div>

            <div className="pointer-events-none relative hidden h-full items-end justify-center lg:flex">
              <img src="/CRIATIVOS/mascote-popsystem.webp" alt="Mascote PopSystem" className="absolute -bottom-8 h-[340px] max-w-none drop-shadow-[0_24px_30px_rgba(0,0,0,0.32)]" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {[
                { icon: Play, label: 'Vídeos rápidos', color: 'bg-[#10b965]' },
                { icon: Check, label: 'Passo a passo', color: 'bg-[#58bfc9]' },
                { icon: Lightbulb, label: 'Dicas do dia a dia', color: 'bg-[#ff8736]' },
                { icon: Trophy, label: 'Mais resultados', color: 'bg-[#8cc850]' },
              ].map(({ icon: Icon, label, color }) => (
                <div key={label} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm font-black text-white backdrop-blur-sm">
                  <span className={cn('flex h-10 w-10 items-center justify-center rounded-full text-white shadow-lg', color)}><Icon className="h-5 w-5" /></span>
                  {label}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-[#073e2e]">Escolha por categoria</h2>
              <p className="text-sm font-medium text-slate-500">Vá direto ao assunto que você precisa.</p>
            </div>
            {activeCategory !== 'all' && <Button variant="ghost" className="text-[#2f7a2c]" onClick={() => setActiveCategory('all')}>Ver todas <ArrowRight className="ml-2 h-4 w-4" /></Button>}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
            {categories.map(({ id, label, description, icon: Icon }) => {
              const active = activeCategory === id;
              const count = id === 'all' ? tutorials.length : tutorials.filter((tutorial) => tutorial.category === id).length;
              return (
                <Button key={id} variant="outline" onClick={() => setActiveCategory(id)} className={cn('h-auto min-h-[112px] flex-col items-start justify-between rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#8cc850] hover:bg-[#f4faec]', active ? 'border-[#61ad45] bg-[#eef9e8] ring-1 ring-[#61ad45]/25' : 'border-[#dfe8e3] bg-white')}>
                  <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', active ? 'bg-[#13784f] text-white' : 'bg-[#eaf6e2] text-[#397520]')}><Icon className="h-5 w-5" /></span>
                  <span className="mt-3 block w-full whitespace-normal font-black leading-tight text-[#073e2e]">{label}</span>
                  <span className="mt-1 block w-full whitespace-normal text-[10px] font-bold text-slate-400">{count} {count === 1 ? 'tutorial' : 'tutoriais'} · {description}</span>
                </Button>
              );
            })}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
          <section className="min-w-0">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-[#073e2e]">{query ? 'Resultados da busca' : 'Tutoriais em destaque'}</h2>
                <p className="text-sm font-medium text-slate-500">{filteredTutorials.length} {filteredTutorials.length === 1 ? 'conteúdo encontrado' : 'conteúdos encontrados'}.</p>
              </div>
              <div className="flex gap-2 rounded-xl bg-[#eef3ef] p-1">
                {([
                  ['recent', 'Mais recentes'],
                  ['popular', 'Mais assistidos'],
                  ['az', 'A–Z'],
                ] as Array<[SortMode, string]>).map(([mode, label]) => (
                  <Button key={mode} size="sm" variant="ghost" onClick={() => setSortMode(mode)} className={cn('h-8 rounded-lg px-3 text-xs font-black', sortMode === mode ? 'bg-white text-[#07553d] shadow-sm' : 'text-slate-500')}>{label}</Button>
                ))}
              </div>
            </div>

            {filteredTutorials.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {filteredTutorials.map((tutorial, index) => {
                  const category = categoryMap.get(tutorial.category);
                  const completed = completedIds.includes(tutorial.id);
                  const favorite = favoriteIds.includes(tutorial.id);
                  return (
                    <Card key={tutorial.id} className="group overflow-hidden rounded-2xl border-[#dfe8e3] bg-white shadow-[0_15px_40px_-30px_rgba(0,50,35,0.45)] transition hover:-translate-y-1 hover:shadow-[0_24px_50px_-28px_rgba(0,50,35,0.5)]">
                      <div className="relative aspect-[16/9] overflow-hidden bg-[#eaf3ed]">
                        <img src={tutorial.thumbnail} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#032f22]/70 via-transparent to-transparent" />
                        <Button size="icon" aria-label={`Assistir ${tutorial.title}`} className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#ff6b00] text-white shadow-xl hover:scale-105 hover:bg-[#e85d00]" onClick={() => setSelectedTutorial(tutorial)}><Play className="ml-0.5 h-5 w-5 fill-current" /></Button>
                        <span className="absolute bottom-3 right-3 rounded-lg bg-black/75 px-2 py-1 text-[11px] font-black text-white"><Clock3 className="mr-1 inline h-3 w-3" />{tutorial.duration}</span>
                        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-black text-[#07553d] shadow-sm">#{String(index + 1).padStart(2, '0')}</span>
                        <Button size="icon" variant="ghost" aria-label={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} className="absolute right-3 top-3 h-8 w-8 rounded-full bg-white/95 text-[#ff6b00] hover:bg-white" onClick={() => toggleFavorite(tutorial.id)}><Heart className={cn('h-4 w-4', favorite && 'fill-current')} /></Button>
                      </div>
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <Badge className="bg-[#edf8e7] text-[#397520] hover:bg-[#edf8e7]">{category?.label}</Badge>
                          {completed && <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-[#2f8b51]"><CheckCircle2 className="h-4 w-4" /> Concluído</span>}
                        </div>
                        <Button type="button" variant="ghost" className="mt-3 h-auto w-full flex-col items-start whitespace-normal p-0 text-left hover:bg-transparent" onClick={() => setSelectedTutorial(tutorial)}>
                          <h3 className="font-black leading-snug text-[#073e2e] transition group-hover:text-[#e85d00]">{tutorial.title}</h3>
                          <p className="mt-1 line-clamp-2 text-sm font-medium leading-5 text-slate-500">{tutorial.description}</p>
                        </Button>
                        <div className="mt-4 flex items-center justify-between border-t border-[#edf1ee] pt-3">
                          <Button variant="ghost" size="sm" className="h-8 px-0 text-xs font-black text-[#397520] hover:bg-transparent hover:text-[#ff6b00]" onClick={() => setSelectedTutorial(tutorial)}>Assistir agora <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-[10px] font-bold text-slate-500" onClick={() => toggleCompleted(tutorial.id)}>{completed ? 'Desmarcar' : 'Marcar como visto'}</Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card className="flex min-h-[330px] flex-col items-center justify-center rounded-3xl border-dashed border-[#bfd3c5] bg-[#f8fbf8] p-8 text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#eaf6e2] text-[#397520]"><Search className="h-7 w-7" /></span>
                <h3 className="mt-4 text-lg font-black text-[#073e2e]">Nenhum tutorial encontrado</h3>
                <p className="mt-1 max-w-sm text-sm font-medium text-slate-500">Tente buscar com outras palavras ou volte para todos os conteúdos.</p>
                <Button className="mt-5 bg-[#07553d] hover:bg-[#064733]" onClick={() => { setQuery(''); setActiveCategory('all'); }}>Ver todos os tutoriais</Button>
              </Card>
            )}
          </section>

          <aside className="space-y-4">
            <Card className="overflow-hidden rounded-2xl border-[#dce8e0] bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.13em] text-[#ff6b00]">Seu progresso</p>
                  <h3 className="mt-1 text-lg font-black text-[#073e2e]">Continue aprendendo</h3>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-full border-[6px] border-[#eaf6e2] bg-white text-sm font-black text-[#07553d] shadow-inner">{completionPercent}%</div>
              </div>
              <Progress value={completionPercent} className="mt-5 h-2.5 bg-[#e8efea] [&>div]:bg-[#72bd44]" />
              <p className="mt-3 text-sm font-bold text-slate-500"><strong className="text-[#073e2e]">{completedCount} de {tutorials.length}</strong> tutoriais concluídos</p>
              <div className="mt-4 rounded-2xl bg-[#edf8e7] p-4">
                <div className="flex gap-3">
                  <Trophy className="h-6 w-6 flex-none text-[#397520]" />
                  <p className="text-xs font-bold leading-5 text-[#376044]">{completionPercent > 0 ? 'Muito bem! Cada tutorial deixa sua operação mais rápida.' : 'Comece pelo primeiro vídeo e avance no seu ritmo.'}</p>
                </div>
              </div>
            </Card>

            <Card className="relative overflow-hidden rounded-2xl border-0 bg-[#064733] p-5 text-white shadow-lg">
              <div className="absolute -bottom-8 -right-4 h-32 w-24 opacity-35"><img src="/CRIATIVOS/mascote-popsystem.webp" alt="" className="h-full w-full object-contain object-bottom" /></div>
              <Headphones className="h-7 w-7 text-[#bde98f]" />
              <h3 className="mt-3 text-lg font-black">Ficou com alguma dúvida?</h3>
              <p className="mt-1 max-w-[210px] text-xs font-medium leading-5 text-white/70">Nossa equipe está pronta para ajudar você a seguir em frente.</p>
              <Button className="relative z-10 mt-4 bg-[#ff6b00] font-black hover:bg-[#e85d00]" onClick={() => window.open(SUPPORT_URL, '_blank', 'noopener,noreferrer')}><MessageCircle className="mr-2 h-4 w-4" /> Abrir suporte</Button>
            </Card>

            <Card className="rounded-2xl border-[#dce8e0] bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2"><Star className="h-5 w-5 fill-[#ffbd32] text-[#ffbd32]" /><h3 className="font-black text-[#073e2e]">Mais assistidos</h3></div>
              <div className="mt-4 space-y-3">
                {popularTutorials.map((tutorial, index) => (
                  <Button type="button" variant="ghost" key={tutorial.id} onClick={() => setSelectedTutorial(tutorial)} className="group h-auto w-full justify-start gap-3 whitespace-normal p-0 text-left hover:bg-transparent">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#eaf6e2] text-xs font-black text-[#397520]">{index + 1}</span>
                    <span className="min-w-0"><strong className="block truncate text-xs text-[#183d31] group-hover:text-[#ff6b00]">{tutorial.title}</strong><span className="text-[10px] font-bold text-slate-400">{(tutorial.popularity / 1000).toFixed(1)} mil visualizações</span></span>
                  </Button>
                ))}
              </div>
            </Card>
          </aside>
        </div>
      </div>

      <Dialog open={Boolean(selectedTutorial)} onOpenChange={(open) => !open && setSelectedTutorial(null)}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto rounded-[26px] border-0 bg-[#fffdf8] p-0 shadow-2xl">
          {selectedTutorial && (
            <>
              <div className="relative aspect-video overflow-hidden bg-[#032f22]">
                {selectedTutorial.videoUrl ? (
                  <iframe title={selectedTutorial.title} src={selectedTutorial.videoUrl} className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                ) : (
                  <>
                    <img src={selectedTutorial.thumbnail} alt="" className="h-full w-full object-cover opacity-35 blur-[1px]" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#032f22] via-[#032f22]/45 to-transparent" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white">
                      <span className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white/20 bg-[#ff6b00] shadow-2xl"><Play className="ml-1 h-8 w-8 fill-current" /></span>
                      <p className="mt-5 text-xs font-black uppercase tracking-[0.16em] text-[#c9f59f]">Biblioteca PopSystem</p>
                      <p className="mt-2 max-w-lg text-2xl font-black">Este vídeo está sendo preparado com todo cuidado.</p>
                      <p className="mt-2 text-sm font-medium text-white/70">A estrutura da central já está pronta para receber os vídeos oficiais.</p>
                    </div>
                  </>
                )}
              </div>
              <DialogHeader className="px-6 pb-2 pt-6 text-left sm:px-8">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-[#edf8e7] text-[#397520] hover:bg-[#edf8e7]">{categoryMap.get(selectedTutorial.category)?.label}</Badge>
                  <span className="text-xs font-bold text-slate-400"><Clock3 className="mr-1 inline h-3.5 w-3.5" />{selectedTutorial.duration}</span>
                </div>
                <DialogTitle className="mt-3 text-2xl font-black tracking-[-0.03em] text-[#073e2e] sm:text-3xl">{selectedTutorial.title}</DialogTitle>
                <DialogDescription className="text-sm font-medium leading-6 text-slate-500">{selectedTutorial.description}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 border-t border-[#e7ece8] bg-white px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <p className="text-xs font-bold text-slate-500">Seu progresso fica salvo automaticamente neste computador.</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="rounded-xl" onClick={() => toggleFavorite(selectedTutorial.id)}><Heart className={cn('mr-2 h-4 w-4', favoriteIds.includes(selectedTutorial.id) && 'fill-[#ff6b00] text-[#ff6b00]')} />{favoriteIds.includes(selectedTutorial.id) ? 'Favoritado' : 'Favoritar'}</Button>
                  <Button className="rounded-xl bg-[#07553d] hover:bg-[#064733]" onClick={() => toggleCompleted(selectedTutorial.id)}><CheckCircle2 className="mr-2 h-4 w-4" />{completedIds.includes(selectedTutorial.id) ? 'Concluído' : 'Marcar como concluído'}</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Tutorials;
