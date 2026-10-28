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

/** Para o ramo Consultoria de RH (telas das empresas atendidas). */
export { EmployerHeading, EmployerSelect, employerLabel, useEmployers } from './employers';
export { hrKey } from './hrKey';
export { employeeStatusLabel, payrollTypeLabel, type Employee, type Employer, type EmployerRef, type Payroll } from '../contracts';
