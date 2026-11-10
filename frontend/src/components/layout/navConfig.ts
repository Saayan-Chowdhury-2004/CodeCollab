import React from 'react';
import {
  Activity,
  Code2,
  FileCode,
  LayoutDashboard,
  ShieldAlert,
} from 'lucide-react';
import { UserDTO } from '../../types/domain.ts';

export type ActiveMainView = 'workspace' | 'activity' | 'admin';

export interface NavItemConfig {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  view?: ActiveMainView;
  href?: string;
  disabled?: boolean;
  visible?: (ctx: { user: UserDTO | null; isConnected: boolean }) => boolean;
}

export const NAV_ITEMS: NavItemConfig[] = [
  {
    id: 'dashboard',
    icon: LayoutDashboard,
    label: 'Dashboard',
    disabled: true, // disabled-by-default for future Dashboard home
  },
  {
    id: 'workspace',
    icon: Code2,
    label: 'Workspace',
    view: 'workspace',
  },
  {
    id: 'activity',
    icon: Activity,
    label: 'Activity',
    view: 'activity',
  },
  {
    id: 'admin',
    icon: ShieldAlert,
    label: 'Admin',
    view: 'admin',
    visible: ({ user }) => user?.globalRole === 'admin',
  },
  {
    id: 'api-docs',
    icon: FileCode,
    label: 'API docs',
    href: '/api/docs',
  },
];
