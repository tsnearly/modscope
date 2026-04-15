/**
 * Extracts the report HTML for saving/copying.
 *
 * Flow:
 * 1. Fetches every stylesheet currently loaded in the document and inlines it
 *    as a <style> block so the saved file is fully offline-capable.
 * 2. Snapshots all resolved CSS custom properties (theme + heatmap vars) into
 *    a :root {} block so CSS variables work without the live theme file.
 * 3. Extracts the raw HTML of the report container and converts relative asset
 *    URLs to absolute URLs.
 * 4. Constructs and returns a pristine, standalone HTML document string.
 */
export async function generateHtml(
  container: HTMLElement,
  subredditName: string
): Promise<string | null> {
  try {
    // ── 1. Collect styles ────────────────────────────────────────────────
    // For <style> tags: take the outerHTML directly.
    // For <link rel="stylesheet"> tags: fetch the CSS text and wrap as <style>.
    // This ensures the saved file never depends on external URLs.
    const stylePromises = Array.from(
      document.querySelectorAll('style, link[rel="stylesheet"]')
    ).map(async (el): Promise<string> => {
      if (el.tagName.toLowerCase() === 'link') {
        const href = (el as HTMLLinkElement).getAttribute('href');
        if (!href) {
          return '';
        }

        const absoluteHref = href.startsWith('/')
          ? `${window.location.origin}${href}`
          : href;

        try {
          const resp = await fetch(absoluteHref);
          if (resp.ok) {
            const css = await resp.text();
            return `<style>\n/* inlined from: ${absoluteHref} */\n${css}\n</style>`;
          }
        } catch (e) {
          console.warn('[HTML] Could not inline stylesheet:', absoluteHref, e);
        }
        // Fallback: keep as a link (better than nothing)
        return `<link rel="stylesheet" href="${absoluteHref}">`;
      }
      return el.outerHTML;
    });

    const styleBlocks = (await Promise.all(stylePromises)).filter(Boolean);

    // ── 2. Snapshot resolved CSS custom properties ───────────────────────
    // Reads computed values from the live document so every CSS variable
    // used in the print template resolves correctly in the offline file.
    const rootComputed = getComputedStyle(document.documentElement);
    const cssVarNames = [
      // Brand / palette
      '--color-primary',
      '--color-secondary',
      '--color-accent',
      '--color-bg',
      '--color-surface',
      '--color-text',
      '--color-text-muted',
      '--color-border',
      '--color-error',
      '--border-strong',
      '--radius-md',
      '--radius-lg',
      '--shadow-sm',
      '--shadow-md',
      // Heatmap gradient
      '--heatmap-0',
      '--heatmap-1',
      '--heatmap-2',
      '--heatmap-3',
      '--heatmap-4',
      '--heatmap-5',
      '--heatmap-6',
      '--heatmap-7',
      '--heatmap-8',
      '--heatmap-9',
      // Chart colours
      '--chart-primary',
      '--chart-secondary',
      '--chart-tertiary',
      '--chart-light',
      '--chart-accent',
      '--chart-highlight',
      // Component tokens
      '--card-bg',
      '--card-border',
      '--card-header-text',
      '--card-body-text',
      '--nav-bg',
      '--nav-border',
      '--nav-item-active-bg',
      '--nav-item-active-text',
      '--btn-primary-bg',
      '--btn-primary-text',
      '--btn-primary-hover',
      '--text-primary',
      '--text-secondary',
      '--text-muted',
      '--bg-surface',
      '--border-default',
      '--border-subtle',
      '--tab-active-bg',
      '--tab-active-border',
      '--tab-active-text',
    ];

    const resolvedVars = cssVarNames
      .map((name) => {
        const value = rootComputed.getPropertyValue(name).trim();
        return value ? `  ${name}: ${value};` : null;
      })
      .filter(Boolean)
      .join('\n');

    // ── 3. Extract report HTML, make asset URLs absolute ─────────────────
    let reportHtml = container.outerHTML;
    reportHtml = reportHtml.replace(
      /(src|href)="([^"]+)"/g,
      (match, attr, url) => {
        if (
          url.startsWith('http') ||
          url.startsWith('data:') ||
          url.startsWith('#')
        ) {
          return match;
        }
        try {
          return `${attr}="${new URL(url, window.location.href).href}"`;
        } catch {
          return match;
        }
      }
    );

    // ── 4. Assemble standalone document ──────────────────────────────────
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ModScope Report – ${subredditName}</title>

    <!-- Resolved theme CSS custom properties -->
    <style>
        :root {
${resolvedVars}
        }
    </style>

    <!-- Inlined application stylesheets -->
    ${styleBlocks.join('\n    ')}

    <!-- Standalone overrides -->
    <style>
        html, body {
            background-color: white !important;
            margin: 0 !important;
            padding: 0 !important;
            height: max-content !important;
            min-height: 100vh !important;
            overflow: visible !important;
        }
        .print-report-container {
            position: relative !important;
            width: 100% !important;
            max-width: 1200px !important;
            margin: 0 auto !important;
            padding: 2rem !important;
            box-shadow: none !important;
        }
        /* Strip interactive elements that were captured */
        .no-print, .btn-tabs, .navigation-tabs, button { display: none !important; }
    </style>
</head>
<body class="is-printing" style="background: white !important;">
    ${reportHtml}
</body>
</html>`;

    return fullHtml;
  } catch (error) {
    console.error('[HTML] Generation failed:', error);
    return null;
  }
}
