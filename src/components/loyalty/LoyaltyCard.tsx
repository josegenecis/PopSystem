
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Crown, Gift, History, Star } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatBRL } from '@/lib/currency';

interface LoyaltyCustomer {
  id: string;
  customer_name: string;
  customer_phone: string;
  points: number;
  total_spent: number;
  visits_count: number;
  created_at: string;
}

interface LoyaltyHistory {
  id: string;
  points_earned: number;
  points_used: number;
  description: string;
  created_at: string;
}

interface LoyaltyCardProps {
  customer: LoyaltyCustomer;
  onRewardRedeem?: (rewardId: string) => void;
}

const LoyaltyCard: React.FC<LoyaltyCardProps> = ({ customer, onRewardRedeem }) => {
  const [history, setHistory] = useState<LoyaltyHistory[]>([]);
  const [rewards, setRewards] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (showHistory) {
      loadHistory();
    }
    loadRewards();
  }, [showHistory, customer.id]);

  const loadHistory = async () => {
    try {
      // Simular carregamento do histórico
      const mockHistory = [
        {
          id: '1',
          points_earned: 50,
          points_used: 0,
          description: 'Pontos ganhos por compra - Pedido #1234',
          created_at: new Date().toISOString()
        },
        {
          id: '2',
          points_earned: 25,
          points_used: 0,
          description: 'Pontos ganhos por compra - Pedido #1235',
          created_at: new Date(Date.now() - 86400000).toISOString()
        }
      ];
      setHistory(mockHistory);
    } catch (error) {
      console.error('Erro ao carregar histórico:', error);
    }
  };

  const loadRewards = async () => {
    try {
      const { data, error } = await supabase
        .from('loyalty_rewards')
        .select('*')
        .eq('user_id', user?.id)
        .eq('active', true)
        .lte('points_required', customer.points);

      if (error) throw error;
      setRewards(data || []);
    } catch (error) {
      console.error('Erro ao carregar recompensas:', error);
    }
  };

  const getStatusLevel = () => {
    if (customer.points >= 1000) return { level: 'VIP', color: 'bg-purple-500', icon: Crown };
    if (customer.points >= 500) return { level: 'Gold', color: 'bg-yellow-500', icon: Star };
    if (customer.points >= 200) return { level: 'Silver', color: 'bg-gray-400', icon: Star };
    return { level: 'Bronze', color: 'bg-orange-500', icon: Star };
  };

  const status = getStatusLevel();
  const StatusIcon = status.icon;

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-xl">{customer.customer_name}</CardTitle>
              <p className="text-blue-100">{customer.customer_phone}</p>
            </div>
            <Badge className={`${status.color} text-white`}>
              <StatusIcon className="w-4 h-4 mr-1" />
              {status.level}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold">{customer.points}</div>
              <div className="text-sm text-blue-100">Pontos</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{customer.visits_count}</div>
              <div className="text-sm text-blue-100">Visitas</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{formatBRL(customer.total_spent)}</div>
              <div className="text-sm text-blue-100">Total Gasto</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {rewards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5" />
              Recompensas Disponíveis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {rewards.map((reward: any) => (
                <div key={reward.id} className="flex justify-between items-center p-3 border rounded-lg">
                  <div>
                    <div className="font-medium">{reward.name}</div>
                    <div className="text-sm text-gray-600">{reward.description}</div>
                    <div className="text-sm text-green-600">{reward.points_required} pontos</div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => onRewardRedeem?.(reward.id)}
                    disabled={customer.points < reward.points_required}
                  >
                    Resgatar
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              Histórico
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)}>
              {showHistory ? 'Ocultar' : 'Ver Histórico'}
            </Button>
          </div>
        </CardHeader>
        {showHistory && (
          <CardContent>
            <div className="space-y-2">
              {history.length > 0 ? (
                history.map((item) => (
                  <div key={item.id} className="flex justify-between items-center p-2 border-b">
                    <div>
                      <div className="text-sm">{item.description}</div>
                      <div className="text-xs text-gray-500">
                        {format(new Date(item.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                      </div>
                    </div>
                    <div className="text-right">
                      {item.points_earned > 0 && (
                        <div className="text-green-600 text-sm">+{item.points_earned} pts</div>
                      )}
                      {item.points_used > 0 && (
                        <div className="text-red-600 text-sm">-{item.points_used} pts</div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-gray-500">
                  Nenhum histórico encontrado
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
};

export default LoyaltyCard;
