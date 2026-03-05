import '../index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { context } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon } from '../dashboard/components/ui/icon';

export const Splash = () => {
  return (
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full mx-4 border border-gray-200">
        <div className="text-center space-y-4">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              <Icon name="app-icon" />
              ModScope
            </h1>
            <p className="text-sm text-gray-500 uppercase tracking-wide">
              Subreddit Analytics Dashboard
            </p>
          </div>

          <div className="py-4 border-t border-b border-gray-200">
            <p className="text-lg text-gray-700">
              Welcome, <span className="font-semibold text-gray-900">{context.username ?? 'Moderator'}</span>!
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Advanced community analytics and insights for Reddit moderators
            </p>
          </div>

          <button
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200 mt-6"
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'dashboard')}
          >
            Open Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
