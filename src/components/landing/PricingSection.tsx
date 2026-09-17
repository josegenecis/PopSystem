import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Star, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { PLAN_CATALOG } from '@/data/planCatalog';

const PricingSection = () => {
  const [isAnnual, setIsAnnual] = useState(false);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0
    }).format(price);
  };

  return (
    <section className="py-24 bg-[linear-gradient(180deg,#fff8f3_0%,#ffffff_35%,#f8fafc_100%)]" id="precos">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-6">
            Planos para <span className="text-boracume-orange">começar, crescer e operar em rede</span>.
          </h2>
          <p className="text-xl text-slate-600 mb-8">
            Essencial para começar, Pro para operação completa e Multi para redes com R$189 por loja adicional.
          </p>

          <div className="flex items-center justify-center gap-4">
            <span className={`text-sm font-semibold ${!isAnnual ? 'text-slate-900' : 'text-slate-500'}`}>Mensal</span>
            <button
              type="button"
              onClick={() => setIsAnnual(!isAnnual)}
              aria-label="Alternar entre preços mensais e anuais"
              aria-pressed={isAnnual}
              className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${isAnnual ? 'bg-boracume-orange' : 'bg-slate-300'}`}
            >
              <div className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow transition-transform duration-300 ${isAnnual ? 'translate-x-8' : ''}`}></div>
            </button>
            <span className={`text-sm font-semibold ${isAnnual ? 'text-slate-900' : 'text-slate-500'}`}>Anual · melhor preço</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {PLAN_CATALOG.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.5 }}
              viewport={{ once: true }}
              className={`relative bg-white rounded-3xl p-8 border ${
                plan.featured 
                  ? 'border-boracume-orange shadow-2xl lg:scale-105 z-10'
                  : 'border-slate-200 shadow-xl hover:shadow-2xl transition-shadow'
              }`}
            >
              {plan.featured && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-boracume-orange text-white px-4 py-1 rounded-full text-sm font-bold flex items-center gap-1 shadow-lg">
                  <Star className="w-4 h-4 fill-white" />
                  {plan.badge?.toUpperCase() || 'DESTAQUE'}
                </div>
              )}

              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-slate-900 mb-2">{plan.name}</h3>
                <p className="text-slate-500 text-sm mb-4">{plan.description}</p>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{plan.audience}</p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-4xl font-extrabold text-slate-900">
                    {formatPrice(isAnnual ? plan.annualPrice / 12 : plan.monthlyPrice)}
                  </span>
                  <span className="text-slate-500">/mês</span>
                </div>
                {isAnnual && (
                  <p className="text-xs text-boracume-green font-semibold mt-2">
                    Cobrado anualmente: {formatPrice(plan.annualPrice)}
                  </p>
                )}
                {plan.extraStorePrice && (
                  <p className="text-xs text-purple-700 font-semibold mt-2">
                    + {formatPrice(isAnnual ? plan.extraStorePrice * 0.9 : plan.extraStorePrice)} por loja adicional/mês
                  </p>
                )}
              </div>

              <div className="space-y-4 mb-8">
                {plan.features.map((feature, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-3 h-3 text-green-600" />
                    </div>
                    <span className="text-slate-700 text-sm font-medium">{feature}</span>
                  </div>
                ))}
                <div className="pt-2 flex flex-wrap gap-2">
                  {plan.modules.map((module) => (
                    <span key={module} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      {module}
                    </span>
                  ))}
                </div>
              </div>

              <Link to="/login?tab=register" className="block">
                <Button 
                  className={`w-full py-6 text-lg font-bold rounded-xl transition-all ${
                    plan.featured 
                      ? 'bg-boracume-orange hover:bg-orange-600 text-white shadow-lg shadow-orange-500/30' 
                      : 'bg-slate-900 hover:bg-slate-800 text-white'
                  }`}
                >
                  Testar 30 Dias Grátis
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <p className="text-center text-xs text-slate-400 mt-4">
                Cancele a renovação quando quiser.
              </p>
            </motion.div>
          ))}
        </div>

      </div>
    </section>
  );
};

export default PricingSection;
