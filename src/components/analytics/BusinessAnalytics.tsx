
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, DollarSign, ShoppingBag, Users, Clock, Download, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface AnalyticsData {
  revenue: number;
  orders: number;
  customers: number;
  avgOrderValue: number;
  topProducts: Array<{ name: string; quantity: number; revenue: number }>;
  hourlyDistribution: Array<{ hour: string; orders: number }>;
  dailyRevenue: Array<{ date: string; revenue: number }>;
  paymentMethods: Array<{ method: string; value: number }>;
  trends: {
    revenue: number;
    orders: number;
    customers: number;
  };
}

const BusinessAnalytics: React.FC = () => {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('month');
  const [startDate, setStartDate] = useState(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState(endOfMonth(new Date()));
  
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    updateDateRange(period);
  }, [period]);

  useEffect(() => {
    if (user) {
      fetchAnalytics();
    }
  }, [user, startDate, endDate]);

  const updateDateRange = (selectedPeriod: string) => {
    const now = new Date();
    switch (selectedPeriod) {
      case 'week':
        setStartDate(startOfWeek(now));
        setEndDate(endOfWeek(now));
        break;
      case 'month':
        setStartDate(startOfMonth(now));
        setEndDate(endOfMonth(now));
        break;
      case 'last_month':
        const lastMonth = subMonths(now, 1);
        setStartDate(startOfMonth(lastMonth));
        setEndDate(endOfMonth(lastMonth));
        break;
      case 'quarter':
        const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        setStartDate(quarterStart);
        setEndDate(new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 3, 0));
        break;
    }
  };

  const fetchAnalytics = async () => {
    if (!user) return;

    try {
      setLoading(true);

      // Fetch orders data
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      if (ordersError) throw ordersError;

      // Fetch previous period for trends
      const prevPeriodStart = new Date(startDate);
      prevPeriodStart.setTime(prevPeriodStart.getTime() - (endDate.getTime() - startDate.getTime()));
      const prevPeriodEnd = startDate;

      const { data: prevOrders, error: prevOrdersError } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', prevPeriodStart.toISOString())
        .lte('created_at', prevPeriodEnd.toISOString());

      if (prevOrdersError) throw prevOrdersError;

      // Process analytics data
      const processedAnalytics = processAnalyticsData(orders || [], prevOrders || []);
      setAnalytics(processedAnalytics);

    } catch (error: any) {
      console.error('Error fetching analytics:', error);
      toast({
        title: 'Erro ao carregar analytics',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const processAnalyticsData = (currentOrders: any[], previousOrders: any[]): AnalyticsData => {
    // Current period metrics
    const revenue = currentOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    const orders = currentOrders.length;
    const uniqueCustomers = new Set(currentOrders.map(order => order.customer_phone)).size;
    const avgOrderValue = orders > 0 ? revenue / orders : 0;

    // Previous period metrics for trends
    const prevRevenue = previousOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    const prevOrders = previousOrders.length;
    const prevCustomers = new Set(previousOrders.map(order => order.customer_phone)).size;

    // Calculate trends (percentage change)
    const revenueTrend = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;
    const ordersTrend = prevOrders > 0 ? ((orders - prevOrders) / prevOrders) * 100 : 0;
    const customersTrend = prevCustomers > 0 ? ((uniqueCustomers - prevCustomers) / prevCustomers) * 100 : 0;

    // Top products
    const productSales: { [key: string]: { quantity: number; revenue: number } } = {};
    currentOrders.forEach(order => {
      if (order.items) {
        let items = [];
        try {
          items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
        } catch (e) {
          items = [];
        }
        
        items.forEach((item: any) => {
          const name = item.product_name || 'Produto sem nome';
          if (!productSales[name]) {
            productSales[name] = { quantity: 0, revenue: 0 };
          }
          productSales[name].quantity += item.quantity || 0;
          productSales[name].revenue += item.subtotal || 0;
        });
      }
    });

    const topProducts = Object.entries(productSales)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Hourly distribution
    const hourlyData: { [key: string]: number } = {};
    for (let i = 0; i < 24; i++) {
      hourlyData[i.toString().padStart(2, '0')] = 0;
    }

    currentOrders.forEach(order => {
      const hour = new Date(order.created_at).getHours();
      hourlyData[hour.toString().padStart(2, '0')]++;
    });

    const hourlyDistribution = Object.entries(hourlyData).map(([hour, orders]) => ({
      hour: `${hour}:00`,
      orders,
    }));

    // Daily revenue
    const dailyRevenue: { [key: string]: number } = {};
    currentOrders.forEach(order => {
      const date = format(new Date(order.created_at), 'dd/MM');
      if (!dailyRevenue[date]) {
        dailyRevenue[date] = 0;
      }
      dailyRevenue[date] += order.total || 0;
    });

    const dailyRevenueArray = Object.entries(dailyRevenue).map(([date, revenue]) => ({
      date,
      revenue,
    }));

    // Payment methods
    const paymentMethods: { [key: string]: number } = {};
    currentOrders.forEach(order => {
      const method = order.payment_method || 'Não informado';
      if (!paymentMethods[method]) {
        paymentMethods[method] = 0;
      }
      paymentMethods[method] += order.total || 0;
    });

    const paymentMethodsArray = Object.entries(paymentMethods).map(([method, value]) => ({
      method,
      value,
    }));

    return {
      revenue,
      orders,
      customers: uniqueCustomers,
      avgOrderValue,
      topProducts,
      hourlyDistribution,
      dailyRevenue: dailyRevenueArray,
      paymentMethods: paymentMethodsArray,
      trends: {
        revenue: revenueTrend,
        orders: ordersTrend,
        customers: customersTrend,
      },
    };
  };

  const exportReport = () => {
    if (!analytics) return;

    const reportData = {
      period: `${format(startDate, 'dd/MM/yyyy')} - ${format(endDate, 'dd/MM/yyyy')}`,
      ...analytics,
      generated_at: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-analytics-${format(new Date(), 'dd-MM-yyyy')}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: 'Relatório exportado',
      description: 'O relatório foi baixado com sucesso.',
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const getTrendIcon = (trend: number) => {
    if (trend > 0) return <TrendingUp className="w-4 h-4 text-green-500" />;
    if (trend < 0) return <TrendingDown className="w-4 h-4 text-red-500" />;
    return <TrendingUp className="w-4 h-4 text-gray-500" />;
  };

  const getTrendColor = (trend: number) => {
    if (trend > 0) return 'text-green-500';
    if (trend < 0) return 'text-red-500';
    return 'text-gray-500';
  };

  const COLORS = ['#FF8042', '#0088FE', '#00C49F', '#FFBB28', '#8884D8'];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Analytics do Negócio</h2>
        <div className="flex items-center gap-4">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Esta Semana</SelectItem>
              <SelectItem value="month">Este Mês</SelectItem>
              <SelectItem value="last_month">Mês Passado</SelectItem>
              <SelectItem value="quarter">Este Trimestre</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={exportReport} variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Exportar
          </Button>
        </div>
      </div>

      {/* Period Display */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Calendar className="w-4 h-4" />
            Período: {format(startDate, 'dd/MM/yyyy')} - {format(endDate, 'dd/MM/yyyy')}
          </div>
        </CardContent>
      </Card>

      {analytics && (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Receita Total</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(analytics.revenue)}</div>
                <div className="flex items-center text-xs text-muted-foreground">
                  {getTrendIcon(analytics.trends.revenue)}
                  <span className={getTrendColor(analytics.trends.revenue)}>
                    {analytics.trends.revenue.toFixed(1)}% vs período anterior
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pedidos</CardTitle>
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{analytics.orders}</div>
                <div className="flex items-center text-xs text-muted-foreground">
                  {getTrendIcon(analytics.trends.orders)}
                  <span className={getTrendColor(analytics.trends.orders)}>
                    {analytics.trends.orders.toFixed(1)}% vs período anterior
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Clientes</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{analytics.customers}</div>
                <div className="flex items-center text-xs text-muted-foreground">
                  {getTrendIcon(analytics.trends.customers)}
                  <span className={getTrendColor(analytics.trends.customers)}>
                    {analytics.trends.customers.toFixed(1)}% vs período anterior
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Ticket Médio</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(analytics.avgOrderValue)}</div>
                <p className="text-xs text-muted-foreground">
                  Valor médio por pedido
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Daily Revenue */}
            <Card>
              <CardHeader>
                <CardTitle>Receita Diária</CardTitle>
                <CardDescription>Evolução da receita no período</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={analytics.dailyRevenue}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis tickFormatter={(value) => formatCurrency(Number(value))} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    <Line type="monotone" dataKey="revenue" stroke="#FF8042" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Hourly Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Distribuição por Horário</CardTitle>
                <CardDescription>Pedidos por hora do dia</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analytics.hourlyDistribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="orders" fill="#0088FE" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Top Products */}
            <Card>
              <CardHeader>
                <CardTitle>Produtos Mais Vendidos</CardTitle>
                <CardDescription>Top 5 produtos por receita</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {analytics.topProducts.map((product, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium">{product.name}</p>
                        <p className="text-sm text-gray-600">{product.quantity} vendidos</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{formatCurrency(product.revenue)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Payment Methods */}
            <Card>
              <CardHeader>
                <CardTitle>Métodos de Pagamento</CardTitle>
                <CardDescription>Distribuição por forma de pagamento</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={analytics.paymentMethods}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ method, percent }) => `${method} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {analytics.paymentMethods.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};

export default BusinessAnalytics;
