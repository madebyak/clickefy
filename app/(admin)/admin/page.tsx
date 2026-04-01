'use client';

import { PageHeader } from '@/components/layout/page-header';

/**
 * Admin Dashboard Overview Page
 * Shows key metrics and quick actions
 * 
 * TODO: [Database Integration] Connect to real analytics data
 */
export default function DashboardPage() {
  const stats = [
    { label: 'Total Templates', value: '24', change: '+3 this week', color: 'text-primary-purple' },
    { label: 'Published', value: '18', change: '75% of total', color: 'text-primary-green' },
    { label: 'Generations Today', value: '156', change: '+12% vs yesterday', color: 'text-primary-purple' },
    { label: 'Success Rate', value: '94%', change: '+2% this week', color: 'text-primary-green' },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Overview of your admin dashboard"
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-surface rounded-lg p-6">
            <p className="text-text-secondary text-sm mb-2">{stat.label}</p>
            <p className={`text-3xl font-bold ${stat.color} mb-1`}>{stat.value}</p>
            <p className="text-text-secondary text-xs">{stat.change}</p>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="bg-surface rounded-lg p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a
            href="/admin/templates/new"
            className="flex items-center gap-3 p-4 bg-surface-elevated rounded-lg hover:bg-[#252532] transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-primary-purple flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-text-primary">Create Template</p>
              <p className="text-sm text-text-secondary">Build a new AI template</p>
            </div>
          </a>

          <a
            href="/admin/categories"
            className="flex items-center gap-3 p-4 bg-surface-elevated rounded-lg hover:bg-[#252532] transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-primary-green flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-text-primary">Manage Categories</p>
              <p className="text-sm text-text-secondary">Organize your templates</p>
            </div>
          </a>

          <a
            href="/admin/jobs"
            className="flex items-center gap-3 p-4 bg-surface-elevated rounded-lg hover:bg-[#252532] transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-primary-purple flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-text-primary">View Jobs</p>
              <p className="text-sm text-text-secondary">Check generation status</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
