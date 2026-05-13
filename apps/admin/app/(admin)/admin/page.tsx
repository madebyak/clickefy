'use client';

import Link from 'next/link';
import {
  FileText,
  CheckCircle2,
  Zap,
  TrendingUp,
  Sparkles,
  ClipboardList,
  FolderTree,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

/**
 * @integration MongoDB — Replace hardcoded `stats` with real aggregation queries:
 *   - Total/published templates count from the templates collection.
 *   - Generations today from the jobs collection (createdAt >= today).
 *   - Success rate from jobs where status === 'completed' vs total.
 */
export default function DashboardPage() {
  const stats = [
    { label: 'Total Templates', value: '24', change: '+3 this week', icon: FileText, accent: 'text-primary-purple' },
    { label: 'Published', value: '18', change: '75% of total', icon: CheckCircle2, accent: 'text-primary-green' },
    { label: 'Generations Today', value: '156', change: '+12% vs yesterday', icon: Zap, accent: 'text-primary-purple' },
    { label: 'Success Rate', value: '94%', change: '+2% this week', icon: TrendingUp, accent: 'text-primary-green' },
  ];

  const quickActions = [
    { label: 'Create Template', href: '/admin/templates/new', icon: Sparkles },
    { label: 'View Templates', href: '/admin/templates', icon: ClipboardList },
    { label: 'Manage Categories', href: '/admin/categories', icon: FolderTree },
    { label: 'View Jobs', href: '/admin/jobs', icon: Activity },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Overview of your AI content generation platform
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription className="text-sm font-medium">
                {stat.label}
              </CardDescription>
              <stat.icon className={`h-4 w-4 ${stat.accent}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${stat.accent}`}>{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{stat.change}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickActions.map((action) => (
            <Link key={action.label} href={action.href}>
              <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                <CardContent className="pt-6">
                  <action.icon className="h-8 w-8 text-primary mb-3" />
                  <p className="font-medium">{action.label}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Activity Placeholder */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
        <Card>
          <CardContent className="py-12 text-center">
            <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No recent activity to display</p>
            <p className="text-sm text-muted-foreground mt-1">
              Activity will appear here once generation jobs start running
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
