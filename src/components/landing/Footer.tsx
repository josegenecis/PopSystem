import { Link } from 'react-router-dom';
import { Mail, MapPin, MessageCircle } from 'lucide-react';
import { trackMarketing } from '@/lib/marketingAnalytics';

const SUPPORT_PHONE = '5585984570267';
const WHATSAPP_URL = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent('Olá! Quero conhecer o PopSystem.')}`;

const Footer = () => (
  <footer className="bg-[#061712] text-white">
    <div className="container grid gap-10 py-14 md:grid-cols-2 lg:grid-cols-[1.4fr_.8fr_.8fr_1fr]">
      <div className="max-w-sm">
        <img src="/LOGOMARCA/logo-pop.webp" alt="PopSystem" className="h-9 w-auto brightness-0 invert" />
        <p className="mt-5 text-sm font-medium leading-6 text-white/50">A plataforma que conecta operação, gestão e crescimento para restaurantes que querem trabalhar com mais controle.</p>
      </div>
      <div><h3 className="text-sm font-black">Plataforma</h3><div className="mt-4 space-y-3 text-sm font-medium text-white/50"><a className="block hover:text-white" href="#produto">Ver o produto</a><a className="block hover:text-white" href="#funcionalidades">Funcionalidades</a><a className="block hover:text-white" href="#inteligencia">Inteligência</a><a className="block hover:text-white" href="#planos">Planos</a><a className="block hover:text-white" href="/login" onClick={() => trackMarketing('landing_login_click', 'footer')}>Entrar</a></div></div>
      <div><h3 className="text-sm font-black">Legal</h3><div className="mt-4 space-y-3 text-sm font-medium text-white/50"><Link className="block hover:text-white" to="/termos">Termos de uso</Link><Link className="block hover:text-white" to="/privacidade">Privacidade</Link><Link className="block hover:text-white" to="/lgpd">LGPD</Link></div></div>
      <div><h3 className="text-sm font-black">Fale conosco</h3><div className="mt-4 space-y-3 text-sm font-medium text-white/50"><a href={WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => trackMarketing('landing_whatsapp_click', 'footer')} className="flex items-center gap-2 hover:text-white"><MessageCircle className="h-4 w-4 text-[#83c44a]" />WhatsApp</a><a href="mailto:contato@popsystem.com.br" className="flex items-center gap-2 hover:text-white"><Mail className="h-4 w-4 text-[#83c44a]" />contato@popsystem.com.br</a><span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-[#83c44a]" />Atendimento em todo o Brasil</span></div></div>
    </div>
    <div className="border-t border-white/10"><div className="container flex flex-col gap-2 py-6 text-xs font-medium text-white/35 sm:flex-row sm:items-center sm:justify-between"><span>© {new Date().getFullYear()} PopSystem Tecnologia Ltda.</span><span>Feito para quem vive a rotina do restaurante.</span></div></div>
  </footer>
);

export default Footer;
