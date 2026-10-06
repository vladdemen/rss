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

// Загружаем архив и мёржим
let archive = [];
try {
  archive = JSON.parse(await fs.readFile('articles.json', 'utf-8'));
} catch {}

const existingLinks = new Set(archive.map(a => a.link));
const newArticles = articles.filter(a => !existingLinks.has(a.link));
const merged = [...newArticles, ...archive]
  .sort((a, b) => new Date(b.date) - new Date(a.date));

await fs.writeFile('articles.json', JSON.stringify(merged, null, 2));
const SITE = 'https://vladdemen.github.io/rss/';
const SITE_NAME = 'Research & Consulting Feed';
const now = new Date();
const updated = now.toISOString().slice(0, 16).replace('T', ' ');
const today = now.toISOString().slice(0, 10);

const SOURCE_INFO = {
  'McKinsey': 'Latest McKinsey & Company insights on strategy, AI, operations and industries.',
  'BCG': 'Boston Consulting Group publications on AI value, strategy and transformation.',
  'Bain': 'Bain & Company insights on technology, private equity, consumer and industry trends.',
  'Deloitte': 'Deloitte Insights research on business, technology and economics.',
  'PwC': 'PwC surveys and insights on workforce, digital trust, tax and strategy.',
  'EY': 'EY insights on geostrategy, trade, AI and business transformation.',
  'Gartner': 'Gartner research, predictions and First Take analyses for IT, marketing and business leaders.',
  'Forrester': 'Forrester analyst blog posts on marketing, CX, B2B, security and AI.',
  'Kantar': 'Kantar research on brands, media, advertising effectiveness and consumers.',
  'Nielsen': 'Nielsen news on audience measurement, media and advertising.',
  'Edelman': 'Edelman insights on trust, communications and brand reputation.',
  'HubSpot': 'HubSpot marketing blog: SEO, AEO, content, GTM and inbound marketing guides.',
  'Semrush': 'Semrush blog on SEO, AI search visibility and digital marketing.',
  'Similarweb': 'Similarweb blog on digital market intelligence and web traffic trends.',
  'Reuters': 'Reuters business headlines relevant to markets, energy, trade and technology.',
  'Influencer Marketing Hub': 'Influencer Marketing Hub articles on creator and influencer marketing.',
  'YouTube Blog': 'Official YouTube blog news for creators, advertisers and viewers.',
  'Meta Newsroom': 'Meta Newsroom announcements on Facebook, Instagram, WhatsApp and AI.',
  'LinkedIn Marketing': 'LinkedIn Marketing Solutions insights on B2B marketing.'
};

const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const day = (a) => new Date(a.date).toISOString().slice(0, 10);
// Google News appends " - Publisher" to titles
const cleanTitle = (t) => String(t).replace(/\s+-\s+[^-]{2,60}$/, '').trim();

// Job postings and career pages leak in through Google News site: searches
const JOB_RE = /Check out this job|^Applying to |Job Details|Job Title:|\bCareers\b[^-]*$|\b(apply|usijobs|middleeastjobs|jobs-ta|careers)\.[a-z]+\.com\b/;
const isJob = (a) => JOB_RE.test(a.title) || /\/(careers|jobs?)\//i.test(a.link);

const seen = new Set();
const visible = merged.filter((a) => {
  if (isNaN(new Date(a.date)) || isJob(a)) return false;
  const key = a.source + '|' + cleanTitle(a.title).toLowerCase();
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const sources = feeds.map((f) => f.name).filter((n) => visible.some((a) => a.source === n));
const bySource = Object.fromEntries(sources.map((n) => [n, visible.filter((a) => a.source === n)]));
const byMonth = {};
const byDay = {};
for (const a of visible) {
  const d = day(a);
  (byMonth[d.slice(0, 7)] ||= []).push(a);
  (byDay[d] ||= []).push(a);
}
const months = Object.keys(byMonth).sort().reverse();
const monthName = (m) => new Date(m + '-01T00:00:00Z').toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const articleHtml = (a) => `
<article>
  <h3><a href="${esc(a.link)}" rel="noopener" target="_blank">${esc(cleanTitle(a.title))}</a></h3>
  <div class="meta"><a class="src" href="${SITE}source/${slug(a.source)}/">${esc(a.source)}</a> · <time datetime="${esc(a.date)}">${day(a)}</time></div>
  ${a.summary && a.summary.trim() !== a.title.trim() ? `<p class="summary">${esc(a.summary)}</p>` : ''}
</article>`;

const nav = `<nav aria-label="Sources">${sources.map((n) => `<a href="${SITE}source/${slug(n)}/">${esc(n)}</a>`).join(' · ')}</nav>`;

const page = ({ path, title, description, h1, intro = '', body, breadcrumbs = [] }) => {
  const url = SITE + path;
  const crumbs = [{ name: 'Home', url: SITE }, ...breadcrumbs];
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', name: title, description, url, dateModified: now.toISOString(), isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE } },
      { '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })) }
    ]
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="index,follow,max-snippet:-1">
<link rel="canonical" href="${url}">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME)}" href="${SITE}feed.xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.55 -apple-system, system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.6rem; margin-bottom: .25rem; }
  h2 { font-size: 1.2rem; margin-top: 2rem; }
  a { color: inherit; }
  nav { font-size: .9rem; margin: 1rem 0; line-height: 1.9; }
  .crumbs { font-size: .85rem; opacity: .7; }
  .meta { font-size: .85rem; opacity: .7; }
  article { padding: 1.1rem 0; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
  article h3 { font-size: 1.05rem; margin: 0 0 .25rem; line-height: 1.35; }
  article h3 a { text-decoration: none; }
  article h3 a:hover { text-decoration: underline; }
  .src { font-weight: 600; text-decoration: none; }
  .summary { margin: .4rem 0 0; opacity: .85; }
  ul.links { columns: 2; padding-left: 1.1rem; }
  footer { margin: 2rem 0; font-size: .85rem; opacity: .7; }
</style>
</head>
<body>
${breadcrumbs.length ? `<div class="crumbs">${crumbs.map((c, i) => i === crumbs.length - 1 ? esc(c.name) : `<a href="${c.url}">${esc(c.name)}</a>`).join(' › ')}</div>` : ''}
<h1>${esc(h1)}</h1>
<p class="meta">Updated ${updated} UTC · <a href="${SITE}feed.xml">RSS</a> · <a href="${SITE}archive/">Archive</a></p>
${intro}
${nav}
${body}
<footer>${esc(SITE_NAME)} aggregates headlines and short excerpts from public feeds. All content belongs to the original publishers; links lead to the source.</footer>
</body>
</html>`;
};

const pages = []; // { path, html, lastmod }
const add = (p, lastmod) => pages.push({ path: p.path, html: page(p), lastmod: lastmod || today });

// Home: latest items only, so the page stays small enough to be fully crawled
add({
  path: '',
  title: `${SITE_NAME}: McKinsey, BCG, Gartner, Forrester & marketing insights`,
  description: `Daily digest of new research and insights from McKinsey, BCG, Bain, Deloitte, PwC, EY, Gartner, Forrester, Kantar, Nielsen, HubSpot, Semrush and more. ${visible.length} articles indexed.`,
  h1: SITE_NAME,
  intro: `<p>A daily digest of new reports, surveys and analyst notes from ${sources.length} consulting, research and marketing sources, updated every hour. Browse the latest below, by <a href="#sources">source</a> or in the <a href="${SITE}archive/">archive by date</a>.</p>`,
  body: `<h2>Latest insights</h2>${visible.slice(0, 150).map(articleHtml).join('')}
<h2 id="sources">Browse by source</h2>
<ul class="links">${sources.map((n) => `<li><a href="${SITE}source/${slug(n)}/">${esc(n)}</a> (${bySource[n].length})</li>`).join('')}</ul>`
});

for (const n of sources) {
  const items = bySource[n];
  add({
    path: `source/${slug(n)}/`,
    title: `${n} insights & latest research — ${SITE_NAME}`,
    description: `${SOURCE_INFO[n] || `Latest articles from ${n}.`} ${items.length} articles, updated hourly.`,
    h1: `${n}: latest insights`,
    intro: `<p>${esc(SOURCE_INFO[n] || `Latest articles from ${n}.`)} Showing the ${Math.min(items.length, 300)} most recent of ${items.length} articles.</p>`,
    body: items.slice(0, 300).map(articleHtml).join(''),
    breadcrumbs: [{ name: n, url: `${SITE}source/${slug(n)}/` }]
  }, day(items[0]));
}

add({
  path: 'archive/',
  title: `Archive by date — ${SITE_NAME}`,
  description: `Browse ${visible.length} consulting, research and marketing articles by month and day.`,
  h1: 'Archive',
  body: months.map((m) => `<h2>${monthName(m)}</h2><ul class="links">${Object.keys(byDay).filter((d) => d.startsWith(m)).sort().reverse()
    .map((d) => `<li><a href="${SITE}archive/${d}/">${d}</a> (${byDay[d].length})</li>`).join('')}</ul>`).join(''),
  breadcrumbs: [{ name: 'Archive', url: `${SITE}archive/` }]
});

for (const d of Object.keys(byDay)) {
  const items = byDay[d];
  const top = [...new Set(items.map((a) => a.source))].slice(0, 6).join(', ');
  add({
    path: `archive/${d}/`,
    title: `Consulting & marketing insights, ${d} — ${SITE_NAME}`,
    description: `${items.length} articles published on ${d} from ${top}.`,
    h1: `Insights published on ${d}`,
    intro: `<p>${items.length} articles from ${esc(top)}.</p>`,
    body: items.map(articleHtml).join(''),
    breadcrumbs: [{ name: 'Archive', url: `${SITE}archive/` }, { name: d, url: `${SITE}archive/${d}/` }]
  }, d < today ? d : today);
}

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Research &amp; Consulting Aggregated</title>
<link>${SITE}</link>
<description>Aggregated feed from major consulting and research firms.</description>
<lastBuildDate>${now.toUTCString()}</lastBuildDate>
${visible.slice(0, 200).map((a) => `<item>
<title>${esc(cleanTitle(a.title))}</title>
<link>${esc(a.link)}</link>
<guid isPermaLink="true">${esc(a.link)}</guid>
<pubDate>${new Date(a.date).toUTCString()}</pubDate>
<source url="${SITE}feed.xml">${esc(a.source)}</source>
<description>${esc(a.summary)}</description>
</item>`).join('\n')}
</channel></rss>`;

await fs.rm('dist', { recursive: true, force: true });
for (const p of pages) {
  await fs.mkdir(`dist/${p.path}`, { recursive: true });
  await fs.writeFile(`dist/${p.path}index.html`, p.html);
}
await fs.writeFile('dist/feed.xml', rss);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${SITE}${p.path}</loc><lastmod>${p.lastmod}</lastmod></url>`).join('\n')}
</urlset>`;

// Note: crawlers only read robots.txt from the domain root (vladdemen.github.io/robots.txt),
// so the sitemap must also be submitted in Search Console.
const robots = `User-agent: *
Allow: /
Sitemap: ${SITE}sitemap.xml`;

await fs.writeFile('dist/sitemap.xml', sitemap);
await fs.writeFile('dist/robots.txt', robots);
await fs.writeFile('dist/google0595884392cd1067.html', 'google-site-verification: google0595884392cd1067.html');

console.log(`Built ${merged.length} total (${newArticles.length} new, ${visible.length} shown) from ${feeds.length} feeds, ${pages.length} pages`);
