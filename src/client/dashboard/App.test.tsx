import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModeratorsOnlyView } from './components/ModeratorsOnlyView';

describe('ModeratorsOnlyView', () => {
  it('renders the moderators-only halt message', () => {
    const html = renderToStaticMarkup(<ModeratorsOnlyView />);

    expect(html).toContain('Moderators Only');
    expect(html).toContain('This tool is restricted to subreddit moderators.');
  });
});