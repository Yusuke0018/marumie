'use client';

import { type ReactNode } from 'react';

export type TabId = 'summary' | 'analysis' | 'quality';

export type Tab = {
  id: TabId;
  label: string;
  icon: ReactNode;
};

type TabNavigationProps = {
  tabs: Tab[];
  activeTab: TabId;
  onTabChange: (tabId: TabId) => void;
};

export function TabNavigation({ tabs, activeTab, onTabChange }: TabNavigationProps): JSX.Element {
  return (
    <div className="flex w-full overflow-x-auto border-b border-slate-200 bg-white">
      <div className="flex gap-1 px-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`group relative flex items-center gap-2 whitespace-nowrap px-6 py-4 text-sm font-semibold transition-all duration-200 ${
                isActive
                  ? 'text-blue-600'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span
                className={`transition-transform duration-200 ${
                  isActive ? 'scale-110' : 'scale-100 group-hover:scale-105'
                }`}
              >
                {tab.icon}
              </span>
              <span>{tab.label}</span>
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-cyan-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
