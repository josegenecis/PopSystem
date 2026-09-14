import React, { useEffect, useState } from 'react';
import { LogIn, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { clearLocalOperatorSession, getLocalOperatorSession, OperatorSession } from '@/services/operatorAuth';

type OperatorSwitcherProps = {
  compact?: boolean;
};

export default function OperatorSwitcher({ compact = false }: OperatorSwitcherProps) {
  const navigate = useNavigate();
  const [operator, setOperator] = useState<OperatorSession | null>(() => getLocalOperatorSession());

  useEffect(() => {
    const sync = () => setOperator(getLocalOperatorSession());
    window.addEventListener('storage', sync);
    window.addEventListener('operator-session-changed', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('operator-session-changed', sync);
    };
  }, []);

  const switchOperator = () => {
    clearLocalOperatorSession();
    window.dispatchEvent(new Event('operator-session-changed'));
    navigate('/operator-login', { replace: true });
  };

  return (
    <div className="flex items-center gap-2">
      {!compact && (
        <Badge variant="outline" className="h-9 rounded-xl border-[#DCE6DF] bg-white px-3 text-xs font-semibold text-[#003223] shadow-sm">
          <UserRound className="mr-1.5 h-3.5 w-3.5" />
          {operator?.name || 'Sem operador'}
        </Badge>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={switchOperator}
        aria-label={compact ? `Trocar operador atual: ${operator?.name || 'nenhum'}` : undefined}
        title={compact ? `Trocar operador — ${operator?.name || 'nenhum selecionado'}` : undefined}
        className={compact
          ? 'h-8 w-8 rounded-[16px] border-[#DCE6DF] bg-white p-0 text-[#003223] shadow-sm hover:bg-[#F5F8F6]'
          : 'h-9 rounded-xl border-[#DCE6DF] bg-white px-3 text-xs font-semibold text-[#003223] shadow-sm hover:bg-[#F5F8F6]'}
      >
        {compact ? <UserRound className="h-4 w-4" /> : <LogIn className="mr-1.5 h-3.5 w-3.5" />}
        {!compact && 'Trocar'}
      </Button>
    </div>
  );
}
