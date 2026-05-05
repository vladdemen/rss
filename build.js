import Parser from 'rss-parser';
import fs from 'node:fs/promises';

const parser = new Parser({ timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 RSSBot' } });
const feeds = JSON.parse(await fs.readFile('feeds.json', 'utf-8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const results = await Promise.allSettled(
  feeds.map(async (f) => {
    const data = await parser.parseURL(f.url);
    return (data.items || []).map((i) => ({
      source: f.name,
      title: i.title,
      link: i.link,
      date: i.isoDate || i.pubDate || new Date().toISOString(),
      summary: (i.contentSnippet || '').slice(0, 280)
    }));
  })
);

results.forEach((r, i) => {
  if (r.status === 'rejected') console.warn(`[skip] ${feeds[i].name}: ${r.reason.message}`);
});

const articles = results
  .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  .filter((a) => a.title && a.link)
  .sort((a, b) => new Date(b.date) - new Date(a.date))
  .slice(0, 200);

const updated = new Date().toISOString().slice(0, 16).replace('T', ' ');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Research & Consulting Feed</title>
<meta name="description" content="Latest insights from McKinsey, BCG, Bain, Deloitte, Forrester, HubSpot, Semrush, Similarweb, Edelman.">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="alternate" type="application/rss+xml" href="feed.xml">
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.55 -apple-system, system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.6rem; margin-bottom: .25rem; }
  .meta { font-size: .85rem; opacity: .7; }
  article { padding: 1.1rem 0; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
  article h2 { font-size: 1.05rem; margin: 0 0 .25rem; line-height: 1.35; }
  article a { color: inherit; text-decoration: none; }
  article a:hover { text-decoration: underline; }
  .src { font-weight: 600; }
  .summary { margin: .4rem 0 0; opacity: .85; }
</style>
</head>
<body>
<h1>Research & Consulting Feed</h1>
<p class="meta">Updated ${updated} UTC · ${articles.length} articles · <a href="feed.xml">RSS</a></p>
${articles.map((a) => `
<article>
  <h2><a href="${esc(a.link)}" rel="noopener">${esc(a.title)}</a></h2>
  <div class="meta"><span class="src">${esc(a.source)}</span> · ${new Date(a.date).toISOString().slice(0, 10)}</div>
  ${a.summary ? `<p class="summary">${esc(a.summary)}</p>` : ''}
</article>`).join('')}
</body>
</html>`;

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Research &amp; Consulting Aggregated</title>
<link>https://vladdemen.github.io/rss/</link>
<description>Aggregated feed from major consulting and research firms.</description>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${articles.map((a) => `<item>
<title>${esc(a.title)}</title>
<link>${esc(a.link)}</link>
<pubDate>${new Date(a.date).toUTCString()}</pubDate>
<source url="${esc(a.link)}">${esc(a.source)}</source>
<description>${esc(a.summary)}</description>
</item>`).join('\n')}
</channel></rss>`;

await fs.mkdir('dist', { recursive: true });
await fs.writeFile('dist/index.html', html);
await fs.writeFile('dist/feed.xml', rss);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://vladdemen.github.io/rss/</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;

const robots = `User-agent: *
Allow: /
Sitemap: https://vladdemen.github.io/rss/sitemap.xml`;

await fs.writeFile('dist/sitemap.xml', sitemap);
await fs.writeFile('dist/robots.txt', robots);
await fs.writeFile('dist/google0595884392cd1067.html', 'google-site-verification: google0595884392cd1067.html');

console.log(`Built ${articles.length} articles from ${feeds.length} feeds`);

