import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Menu, MessageCircle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import Logo from '@/components/Logo';
import { trackMarketing } from '@/lib/marketingAnalytics';

const menuItems = [
  { href: '#solucoes', label: 'Soluções', expandable: true },
  { href: '#funcionalidades', label: 'Recursos' },
  { href: '#planos', label: 'Planos' },
  { href: '#vantagens', label: 'Vantagens' },
  { href: '#experiencia', label: 'Integrações' },
  { href: '#duvidas', label: 'Suporte' },
];

const WHATSAPP_URL = `https://wa.me/5585984570267?text=${encodeURIComponent('Olá! Quero falar com um especialista do PopSystem.')}`;

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[#e7ece8] bg-white/95 shadow-[0_5px_20px_rgba(6,71,51,.05)] backdrop-blur-xl">
      <div className="container flex h-[78px] items-center justify-between gap-5 px-5 2xl:px-0">
        <Link to="/" aria-label="Página inicial PopSystem"><Logo size="lg" className="2xl:-ml-5" /></Link>

        <nav className="hidden items-center gap-8 xl:flex" aria-label="Navegação principal">
          {menuItems.map(item => <a key={item.href} href={item.href} className="inline-flex items-center gap-1.5 text-[13px] font-extrabold text-[#132d25] transition hover:text-[#ef6c20]">{item.label}{item.expandable ? <ChevronDown className="h-3.5 w-3.5" /> : null}</a>)}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="outline" className="h-11 rounded-xl border-[#9db9ad] bg-white px-7 text-[13px] font-black text-[#073e2e] hover:border-[#073e2e] hover:bg-[#f4f8f4]"><a href="/login" onClick={() => trackMarketing('landing_login_click', 'header')}>Entrar</a></Button>
          <Button asChild className="h-11 rounded-xl bg-[#f56616] px-6 text-[13px] font-black text-white shadow-[0_12px_25px_-12px_rgba(239,108,32,.8)] hover:bg-[#df5a0d]"><a href={WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => trackMarketing('landing_whatsapp_click', 'header')}><MessageCircle className="mr-2 h-4 w-4" />Fale com um especialista</a></Button>
        </div>

        <button type="button" onClick={() => setIsMenuOpen(value => !value)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f1f5f1] text-[#064733] md:hidden" aria-label={isMenuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={isMenuOpen}>
          {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <AnimatePresence>
        {isMenuOpen && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden border-t border-[#e7ece8] bg-white md:hidden">
          <nav className="container space-y-1 py-4" aria-label="Navegação móvel">
            {menuItems.map(item => <a key={item.href} href={item.href} onClick={() => setIsMenuOpen(false)} className="flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold text-[#315548] hover:bg-[#f1f6f1]">{item.label}{item.expandable ? <ChevronDown className="h-4 w-4" /> : null}</a>)}
            <div className="grid grid-cols-2 gap-2 pt-3"><Button asChild variant="outline" className="w-full rounded-xl font-bold"><a href="/login" onClick={() => trackMarketing('landing_login_click', 'mobile_menu')}>Entrar</a></Button><Button asChild className="w-full rounded-xl bg-[#ef6c20] font-black text-white"><a href={WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => trackMarketing('landing_whatsapp_click', 'mobile_menu')}>Falar agora</a></Button></div>
          </nav>
        </motion.div>}
      </AnimatePresence>
    </header>
  );
};

export default Header;
