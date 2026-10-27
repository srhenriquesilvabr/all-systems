import { defineWebModule } from '@all/module-sdk/web';
import { EmployeePage, EmployeesPage } from './employees';
import { PayrollPage, PayrollsPage } from './payroll';

export const hrWeb = defineWebModule({
  key: 'hr',
  routes: [
    { path: 'rh/colaboradores', permission: 'hr.read', Component: EmployeesPage },
    { path: 'rh/colaboradores/:id', permission: 'hr.read', Component: EmployeePage },
    { path: 'rh/folha', permission: 'hr.read', Component: PayrollsPage },
    { path: 'rh/folha/:id', permission: 'hr.read', Component: PayrollPage },
  ],
});
