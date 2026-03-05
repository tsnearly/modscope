

/**
 * Extracts the report HTML for saving/copying.
 * 
 * Flow:
 * 1. Extracts all stylesheets currently loaded in the Devvit webview
 * 2. Extracts the raw HTML of the report container
 * 3. Converts relative asset URLs to absolute URLs
 * 4. Constructs and returns a pristine, standalone HTML document string that is populated within a dialog popup window
 */
export async function generateHtml(
    container: HTMLElement,
    subredditName: string
): Promise<string | null> {
    try {
        const dateStr = new Date().toISOString().split('T')[0];

        // 1. Extract all stylesheets currently loaded in the Devvit webview
        const styleTags = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(el => {
            if (el.tagName.toLowerCase() === 'link') {
                const href = (el as HTMLLinkElement).getAttribute('href');
                if (href && href.startsWith('/')) {
                    // Convert relative Devvit CDN links to absolute URLs
                    const absoluteHref = `${window.location.origin}${href}`;
                    return `<link rel="stylesheet" href="${absoluteHref}">`;
                }
            }
            return el.outerHTML;
        }).join('\n');

        // 2. Extract the raw HTML of JUST the report container (excluding the React UI wrappers)
        let reportHtml = container.outerHTML;

        // Ensure all relative assets (images, icons) resolve correctly when the HTML is saved locally
        reportHtml = reportHtml.replace(/(src|href)="([^"]+)"/g, (match, attr, url) => {
            if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('#')) {
                return match; // Already absolute, data URI, or anchor link
            }
            try {
                const absoluteUrl = new URL(url, window.location.href).href;
                return `${attr}="${absoluteUrl}"`;
            } catch (e) {
                return match;
            }
        });

        // 3. Construct a pristine, standalone HTML document that forces the "print" layout naturally
        const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ModScope Report - ${subredditName}</title>
    ${styleTags}
    <style>
        /* Force styling for the standalone HTML file */
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
        /* Hide any interactive elements that got copied */
        .no-print, .btn-tabs, .navigation-tabs, button { display: none !important; }
    </style>
</head>
<body class="is-printing" style="background: white !important;">
    ${reportHtml}
</body>
</html>`;

        // 4. Return this standalone HTML string
        return fullHtml;
    } catch (error) {
        console.error('[HTML] Generation failed:', error);
        return null;
    }
}
