import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface PageHeroProps {
  title: string;
  description: string;
  icon: LucideIcon;
  eyebrow?: string;
  actions?: ReactNode;
  compact?: boolean;
}

export function PageHero({ title, description, icon: Icon, eyebrow, actions, compact = false }: PageHeroProps) {
  return (
    <section className={`overflow-hidden border-0 bg-gradient-to-br from-[#003223] via-[#07573d] to-[#087A55] text-white shadow-[0_26px_60px_-34px_rgba(0,50,35,0.55)] ${compact ? 'rounded-2xl' : 'rounded-[28px]'}`}>
      <div className={`flex flex-col lg:flex-row lg:items-center lg:justify-between ${compact ? 'gap-3 p-4' : 'gap-5 p-5 sm:p-6'}`}>
        <div className={`flex min-w-0 items-start ${compact ? 'gap-3' : 'gap-4'}`}>
          <div className={`flex shrink-0 items-center justify-center border border-white/15 bg-white/15 shadow-sm backdrop-blur ${compact ? 'h-10 w-10 rounded-xl' : 'h-12 w-12 rounded-2xl'}`}>
            <Icon className={compact ? 'h-5 w-5' : 'h-6 w-6'} />
          </div>
          <div className="min-w-0">
            {eyebrow ? <p className={`font-semibold uppercase text-white/70 ${compact ? 'mb-0.5 text-[10px] tracking-[0.16em]' : 'mb-1 text-xs tracking-[0.18em]'}`}>{eyebrow}</p> : null}
            <h1 className={`font-bold tracking-tight ${compact ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'}`}>{title}</h1>
            <p className={`max-w-3xl text-white/85 ${compact ? 'mt-0.5 text-sm' : 'mt-1 text-sm sm:text-base'}`}>{description}</p>
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </section>
  );
}
