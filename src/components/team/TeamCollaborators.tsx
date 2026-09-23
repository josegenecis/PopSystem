import { useMemo, useState } from 'react';
import { MoreHorizontal, Pencil, Plus, Search, UserMinus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { EmployeeFormValue, TeamEmployee, TeamTableOption } from '@/lib/team/types';
import { EmployeeDialog } from './EmployeeDialog';
import { ROLE_OPTIONS, STATUS_LABELS } from './teamOptions';

export function TeamCollaborators({ employees, tableOptions, loading, saving, canViewSensitive, onSave, onStatusChange }: { employees: TeamEmployee[]; tableOptions: TeamTableOption[]; loading: boolean; saving: boolean; canViewSensitive: boolean; onSave: (form: EmployeeFormValue) => Promise<boolean>; onStatusChange: (employee: TeamEmployee) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TeamEmployee | null>(null);
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => employees.filter((employee) => `${employee.full_name} ${employee.cpf || ''} ${employee.job_title || ''}`.toLowerCase().includes(query.toLowerCase())), [employees, query]);
  const edit = (employee: TeamEmployee | null) => {
    setSelected(employee);
    setOpen(true);
  };
  const save = async (form: EmployeeFormValue) => {
    const saved = await onSave(form);
    if (saved) setOpen(false);
    return saved;
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome, CPF ou cargo" />
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => edit(null)}>
          <Plus className="mr-2 h-4 w-4" />
          Novo colaborador
        </Button>
      </div>
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Cargo e setor</TableHead>
                  <TableHead>Perfis</TableHead>
                  <TableHead>Acessos</TableHead>
                  <TableHead>Status</TableHead>
                  {canViewSensitive && <TableHead className="text-right">Salário base</TableHead>}
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage src={employee.photo_url || undefined} />
                          <AvatarFallback className="bg-emerald-50 text-emerald-800">
                            {employee.full_name
                              .split(' ')
                              .slice(0, 2)
                              .map((part) => part[0])
                              .join('')}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <button className="font-semibold text-emerald-950 hover:underline" onClick={() => edit(employee)}>
                            {employee.full_name}
                          </button>
                          <p className="text-xs text-slate-500">{employee.email || employee.phone || 'Sem contato'}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="block text-sm">{employee.job_title || 'Não informado'}</span>
                      <small className="text-slate-500">{employee.department || 'Sem setor'}</small>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-52 flex-wrap gap-1">
                        {employee.roles.slice(0, 3).map((role) => (
                          <Badge key={role} variant="secondary">
                            {ROLE_OPTIONS.find((item) => item.value === role)?.label || role}
                          </Badge>
                        ))}
                        {employee.roles.length > 3 && <Badge variant="outline">+{employee.roles.length - 3}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-600">{employee.apps.length ? `${employee.apps.length} liberado(s)` : 'Sem acesso'}</span>
                    </TableCell>
                    <TableCell>
                      <Badge className={employee.employment_status === 'active' ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' : employee.employment_status === 'terminated' ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-800'}>{STATUS_LABELS[employee.employment_status]}</Badge>
                    </TableCell>
                    {canViewSensitive && (
                      <TableCell className="text-right font-semibold">
                        {new Intl.NumberFormat('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        }).format(employee.compensation.salary_base)}
                      </TableCell>
                    )}
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => edit(employee)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar cadastro
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onStatusChange(employee)}>
                            <UserMinus className="mr-2 h-4 w-4" />
                            {employee.employment_status === 'terminated' ? 'Reativar' : 'Desligar sem apagar'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {!filtered.length && (
                  <TableRow>
                    <TableCell colSpan={canViewSensitive ? 7 : 6} className="h-32 text-center text-slate-500">
                      {loading ? 'Carregando equipe...' : 'Nenhum colaborador encontrado.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <EmployeeDialog open={open} employee={selected} tableOptions={tableOptions} saving={saving} canViewSensitive={canViewSensitive} onOpenChange={setOpen} onSave={save} />
    </div>
  );
}
