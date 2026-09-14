# BoraCumê - Sistema de Gestão de Restaurante

Sistema completo de gestão para restaurantes com funcionalidades de PDV, gestão de pedidos, cardápio digital e muito mais.

## 🚀 Funcionalidades

- **PDV (Ponto de Venda)**: Sistema completo para vendas no balcão
- **Gestão de Pedidos**: Controle total dos pedidos com status em tempo real
- **Cardápio Digital**: Interface moderna para visualização do menu
- **Sistema de Entregadores**: Gestão completa de entregadores e entregas
- **Controle Financeiro**: Relatórios e controle de vendas
- **Gestão de Produtos**: CRUD completo de produtos e categorias
- **Sistema de Notificações**: Toasts e notificações em tempo real
- **Áreas de Entrega**: Configuração de bairros e taxas de entrega

## 🛠️ Tecnologias Utilizadas

- **Frontend**: React + TypeScript + Vite
- **Styling**: Tailwind CSS + Shadcn/ui
- **Backend**: Supabase (PostgreSQL)
- **Autenticação**: Supabase Auth
- **Estado**: React Query + Context API
- **Roteamento**: React Router DOM
- **Notificações**: React Hot Toast + Radix UI Toast
- **Ícones**: Lucide React

## 📦 Instalação

1. Clone o repositório:
```bash
git clone <url-do-repositorio>
cd BORACUME
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:
```bash
cp .env.example .env
```

4. Configure suas credenciais do Supabase no arquivo `.env`:
```env
VITE_SUPABASE_URL=sua_url_do_supabase
VITE_SUPABASE_ANON_KEY=sua_chave_anonima
SUPABASE_SERVICE_KEY=sua_chave_de_servico
```

5. Execute o projeto:
```bash
npm run dev
```

## 🗄️ Estrutura do Banco de Dados

O projeto utiliza Supabase com as seguintes tabelas principais:

- `orders` - Pedidos
- `order_items` - Itens dos pedidos
- `products` - Produtos
- `categories` - Categorias
- `delivery_areas` - Áreas de entrega
- `delivery_drivers` - Entregadores
- `kitchen_orders` - Pedidos na cozinha (KDS)
- `notification_settings` - Configurações de notificação

## 🔧 Scripts Disponíveis

- `npm run dev` - Inicia o servidor de desenvolvimento
- `npm run build` - Gera o build de produção
- `npm run preview` - Visualiza o build de produção
- `npm run lint` - Executa o linter

## 📱 Funcionalidades Principais

### PDV (Ponto de Venda)
- Interface intuitiva para vendas
- Cálculo automático de totais
- Integração com sistema de pagamento

### Gestão de Pedidos
- Visualização em tempo real
- Controle de status (Pendente, Aceito, Em Preparo, Pronto, Entregue)
- Integração com KDS (Kitchen Display System)

### Cardápio Digital
- Interface responsiva
- Categorização de produtos
- Imagens e descrições detalhadas

### Sistema de Entregas
- Gestão de entregadores
- Controle de áreas de entrega
- Cálculo automático de taxas

## 🤝 Contribuição

Contribuições são bem-vindas! Por favor, abra uma issue ou envie um pull request.

## 📄 Licença

Este projeto está sob a licença MIT.

## 📞 Suporte

Para suporte, entre em contato através do email: suporte@boracume.com

---

**BoraCumê** - Desenvolvido com ❤️ para revolucionar a gestão de restaurantes.
