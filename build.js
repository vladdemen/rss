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
const JOB_RE = /Check out this job|^Applying to |Job Details|Job Title:|start the application process|\b(USI|External) Careers\b|\bJobs? in\b|\bCareers\b[^-]*$|(News|Insights) Hub\b|\b(apply|usijobs|middleeastjobs|jobs-ta|jobsus|careers)\.[a-z]+\.com\b/;
// For firms whose Google News results are mostly vacancies, a bare role title
// (no colon or question, as headlines usually have) is treated as a job ad
const CAREER_SOURCES = new Set(['Deloitte', 'EY', 'PwC', 'BCG', 'Kantar']);
const ROLE_RE = /\b(Specialist|Manager|Analyst|Associate|Consultant|Engineer|Director|Intern|Architect|Developer|Scientist)\b/;
const isJob = (a) => JOB_RE.test(a.title) || /\/(careers|jobs?)\//i.test(a.link) ||
  (CAREER_SOURCES.has(a.source) && ROLE_RE.test(a.title) && !/[:?“"]/.test(a.title));

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
  body { font: 16px/1.55 -apple-system, system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; }
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
  .block { margin: 2.25rem 0; }
  .hero { padding: 1rem 1.25rem; border-radius: 12px; background: color-mix(in srgb, currentColor 6%, transparent); }
  .hero p { margin: .5rem 0; }
  ul.grid { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: .75rem; }
  .card { display: flex; flex-direction: column; justify-content: space-between; gap: .5rem; padding: .85rem 1rem; border-radius: 10px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
  .card-title { font-weight: 600; line-height: 1.35; text-decoration: none; }
  .card-title:hover { text-decoration: underline; }
  ul.chips { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: .5rem; }
  ul.chips li { padding: .25rem .7rem; border-radius: 999px; font-size: .9rem; background: color-mix(in srgb, currentColor 8%, transparent); }
  .faq h3 { font-size: 1rem; margin: 1rem 0 .25rem; }
  @media (max-width: 520px) { ul.links { columns: 1; } }
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

// Home: several themed blocks plus generated text, so the page has its own
// content rather than being a bare list of outbound links
const SECTIONS = [
  { id: 'consulting', name: 'Consulting firms', sources: ['McKinsey', 'BCG', 'Bain', 'Deloitte', 'PwC', 'EY'],
    text: 'Strategy and management consultancies publish surveys, CEO interviews and industry outlooks. These are often the first place new numbers on AI adoption, growth and transformation appear.' },
  { id: 'research', name: 'Research & analyst firms', sources: ['Gartner', 'Forrester', 'Kantar', 'Nielsen', 'Edelman'],
    text: 'Analyst predictions, market guides and consumer research: Gartner and Forrester on technology and marketing strategy, Kantar and Nielsen on media and audiences, Edelman on trust.' },
  { id: 'marketing', name: 'Marketing, SEO & creators', sources: ['HubSpot', 'Semrush', 'Similarweb', 'Influencer Marketing Hub', 'LinkedIn Marketing'],
    text: 'Practical guides on SEO, AI search visibility (AEO), content, influencer and B2B marketing from the teams that build the tools.' },
  { id: 'platforms', name: 'Platforms', sources: ['YouTube Blog', 'Meta Newsroom'],
    text: 'Official product and policy announcements from YouTube and Meta that change how brands and creators reach audiences.' },
  { id: 'business', name: 'Business news', sources: ['Reuters'],
    text: 'Market-moving business headlines on energy, trade, central banks and big tech for context around the research.' }
];

const TOPICS = [
  ['AI', /\bAI\b|artificial intelligence|GenAI|\bLLM/i],
  ['AI agents', /\bagent(s|ic)?\b/i],
  ['Search & SEO', /\b(SEO|AEO|GEO)\b|search/i],
  ['Marketing & advertising', /marketing|marketer|advertis|\bads?\b|brand/i],
  ['Cybersecurity', /security|cyber|CISO|privacy/i],
  ['Workforce & talent', /workforce|talent|employee|jobs?\b|skills|hiring|HR\b/i],
  ['Consumers & retail', /consumer|retail|shopp|commerce/i],
  ['Energy & oil', /\boil\b|energy|crude|diesel|\bgas\b|power/i],
  ['Trade & tariffs', /trade|tariff|export|import|sanction/i],
  ['Finance & banking', /bank|financ|investor|\bFed\b|rates?\b|earnings/i],
  ['Software & SaaS', /software|SaaS|cloud|data center/i]
];

const DAY_MS = 864e5;
const latestTs = new Date(visible[0]?.date || now).getTime();
const week = visible.filter((a) => latestTs - new Date(a.date).getTime() < 7 * DAY_MS);
const weekResearch = week.filter((a) => a.source !== 'Reuters');
const topicCounts = TOPICS.map(([name, re]) => [name, week.filter((a) => re.test(a.title)).length])
  .filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
const weekBySource = Object.entries(week.reduce((m, a) => ((m[a.source] = (m[a.source] || 0) + 1), m), {}))
  .sort((a, b) => b[1] - a[1]);

const card = (a) => `<li class="card">
  <a class="card-title" href="${esc(a.link)}" rel="noopener" target="_blank">${esc(cleanTitle(a.title))}</a>
  <span class="meta"><a class="src" href="${SITE}source/${slug(a.source)}/">${esc(a.source)}</a> · <time datetime="${esc(a.date)}">${day(a)}</time></span>
</li>`;

// One headline per research source keeps the top block varied
const topStories = [];
const seenSrc = new Set();
for (const a of weekResearch) {
  if (seenSrc.has(a.source)) continue;
  seenSrc.add(a.source);
  topStories.push(a);
  if (topStories.length === 6) break;
}

const topicSentence = topicCounts.length
  ? `The most covered themes were ${topicCounts.slice(0, 3).map(([n, c]) => `${n} (${c} articles)`).join(', ')}.`
  : '';
const busiest = weekBySource.filter(([s]) => s !== 'Reuters').slice(0, 3).map(([s, c]) => `${s} (${c})`).join(', ');

const homeBody = `
<section class="block hero">
  <p><strong>${esc(SITE_NAME)}</strong> collects new reports, surveys, predictions and analyst notes from ${sources.length} consulting, research and marketing sources in one place. The feed is refreshed every hour, so marketers, strategists and analysts can see what McKinsey, BCG, Gartner, Forrester, Kantar and others published today without visiting each site.</p>
  <p>Over the last 7 days the site collected <strong>${week.length}</strong> articles, ${weekResearch.length} of them from research and consulting sources. ${topicSentence}${busiest ? ` The most active publishers were ${busiest}.` : ''}</p>
</section>

<section class="block" aria-labelledby="top">
  <h2 id="top">Top stories this week</h2>
  <ul class="grid">${topStories.map(card).join('')}</ul>
</section>

${topicCounts.length ? `<section class="block" aria-labelledby="topics">
  <h2 id="topics">Trending topics</h2>
  <p>Themes mentioned most often in headlines over the past week:</p>
  <ul class="chips">${topicCounts.map(([n, c]) => `<li>${esc(n)} <b>${c}</b></li>`).join('')}</ul>
</section>` : ''}

${SECTIONS.map((s) => {
  const items = visible.filter((a) => s.sources.includes(a.source) && !topStories.includes(a)).slice(0, 6);
  if (!items.length) return '';
  const present = s.sources.filter((n) => bySource[n]);
  return `<section class="block" aria-labelledby="${s.id}">
  <h2 id="${s.id}">${esc(s.name)}</h2>
  <p>${esc(s.text)} Sources: ${present.map((n) => `<a href="${SITE}source/${slug(n)}/">${esc(n)}</a>`).join(', ')}.</p>
  <ul class="grid">${items.map(card).join('')}</ul>
</section>`;
}).join('\n')}

<section class="block" aria-labelledby="latest">
  <h2 id="latest">Latest from all sources</h2>
  ${visible.slice(0, 40).map(articleHtml).join('')}
  <p><a href="${SITE}archive/">Browse the full archive by date →</a></p>
</section>

<section class="block" aria-labelledby="sources">
  <h2 id="sources">All sources</h2>
  <ul class="links">${sources.map((n) => `<li><a href="${SITE}source/${slug(n)}/">${esc(n)}</a> (${bySource[n].length})</li>`).join('')}</ul>
</section>

<section class="block faq" aria-labelledby="about">
  <h2 id="about">About this feed</h2>
  <h3>What is ${esc(SITE_NAME)}?</h3>
  <p>An automatic aggregator of public RSS and news feeds from leading consulting firms, research and analyst companies, marketing platforms and business media. It shows headlines and short excerpts and links to the original publication.</p>
  <h3>How often is it updated?</h3>
  <p>Every hour. The archive goes back to ${esc(months[months.length - 1] ? monthName(months[months.length - 1]) : 'the first build')} and now holds ${visible.length} articles.</p>
  <h3>Can I subscribe?</h3>
  <p>Yes, add the <a href="${SITE}feed.xml">RSS feed</a> to any reader to get the 200 newest articles.</p>
</section>`;

add({
  path: '',
  title: `${SITE_NAME}: McKinsey, BCG, Gartner, Forrester & marketing insights`,
  description: `Hourly digest of new research from McKinsey, BCG, Bain, Deloitte, PwC, EY, Gartner, Forrester, Kantar, Nielsen, HubSpot, Semrush and more. ${week.length} articles this week.`,
  h1: `${SITE_NAME}: consulting, research & marketing insights`,
  body: homeBody
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
