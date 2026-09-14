import { UsersRound } from 'lucide-react';
import FiscalRecipientsManager from '@/components/fiscal/FiscalRecipientsManager';

export default function Customers() {
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-[#073d2e] via-[#075e46] to-[#0c7a54] p-6 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <span className="rounded-xl bg-white/10 p-3">
            <UsersRound className="h-7 w-7 text-lime-300" />
          </span>
          <div>
            <h1 className="text-2xl font-bold">Cadastro de clientes</h1>
            <p className="mt-1 text-sm text-emerald-50/85">
              Centralize os dados usados no PDV, delivery, fidelidade e emissão de NF-e.
            </p>
          </div>
        </div>
      </div>

      <FiscalRecipientsManager mode="customers" />
    </div>
  );
}
