import { Icon } from './ui/icon';

export const ModeratorsOnlyView = () => {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <Icon name="glass-warning" size={48} className="text-orange-500 mb-4" />
      <h2 className="text-lg font-bold text-gray-900 mb-2">Moderators Only</h2>
      <p className="text-sm text-gray-500">
        This tool is restricted to subreddit moderators.
      </p>
    </div>
  );
};
