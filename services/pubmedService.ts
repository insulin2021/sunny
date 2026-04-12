// ─────────────────────────────────────────────────────────────────────────────
// pubmedService.ts — NCBI E-utilities evidence retrieval
// ESearch → ESummary → EFetch (XML abstract) pipeline
// Rate-limited to 3 req/sec (NCBI anonymous limit)
// ─────────────────────────────────────────────────────────────────────────────

const NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const NCBI_PARAMS = 'tool=mitos_paper_writer&email=insulin2021%40gmail.com';

/** Minimum ms between NCBI requests (400 ms ≈ 2.5 req/sec) */
const RATE_LIMIT_MS = 400;
let _lastReqTime = 0;

async function ncbiDelay(): Promise<void> {
  const wait = RATE_LIMIT_MS - (Date.now() - _lastReqTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastReqTime = Date.now();
}

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface PubMedArticle {
  pmid: string;
  title: string;
  authors: string[];       // raw: ["Park J", "Kim SW"]
  authorDisplay: string;   // "Park et al." / "Park & Kim"
  journal: string;
  pubYear: string;
  abstract: string;
  doi?: string;
  // Citation strings
  citationDisplay: string; // "Park et al., 2024"
  citationSystem: string;  // "PMID: 12345678"
  citationFull: string;    // "Park et al., 2024 (PMID: 12345678)"
}

// ─────────────────────────────────────────────────────────────────────────────
// ESearch — returns list of PMIDs matching a query
// ─────────────────────────────────────────────────────────────────────────────

export async function pubmedSearch(
  query: string,
  maxResults = 10,
  dateFilter = '2018:2025[pdat]',
): Promise<string[]> {
  await ncbiDelay();
  const term = encodeURIComponent(`(${query}) AND ${dateFilter}`);
  const url = `${NCBI_BASE}/esearch.fcgi?db=pubmed&term=${term}&retmax=${maxResults}&retmode=json&sort=relevance&${NCBI_PARAMS}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESearch HTTP ${res.status}`);
    const data = await res.json();
    return (data.esearchresult?.idlist ?? []) as string[];
  } catch (e) {
    console.warn('[PubMed] ESearch error:', e);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ESummary — returns article metadata (title, authors, journal, year)
// ─────────────────────────────────────────────────────────────────────────────

interface _SummaryRec {
  pmid: string;
  title: string;
  authors: string[];
  journal: string;
  pubYear: string;
}

export async function pubmedSummary(pmids: string[]): Promise<_SummaryRec[]> {
  if (pmids.length === 0) return [];
  await ncbiDelay();
  const url = `${NCBI_BASE}/esummary.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=json&${NCBI_PARAMS}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESummary HTTP ${res.status}`);
    const data = await res.json();
    const result = data.result;
    if (!result) return [];
    return (result.uids as string[]).flatMap((pmid: string) => {
      const art = result[pmid];
      if (!art || art.error) return [];
      const authors: string[] = (art.authors ?? []).map((a: { name: string }) => a.name);
      const yearMatch = (art.pubdate ?? art.epubdate ?? '').match(/\d{4}/);
      return [{
        pmid,
        title: art.title ?? '',
        authors,
        journal: art.source ?? '',
        pubYear: yearMatch ? yearMatch[0] : '',
      }];
    });
  } catch (e) {
    console.warn('[PubMed] ESummary error:', e);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EFetch XML — extracts abstracts from PubMed XML
// ─────────────────────────────────────────────────────────────────────────────

export async function pubmedAbstracts(pmids: string[]): Promise<Record<string, string>> {
  if (pmids.length === 0) return {};
  await ncbiDelay();
  const url = `${NCBI_BASE}/efetch.fcgi?db=pubmed&id=${pmids.join(',')}&rettype=xml&retmode=xml&${NCBI_PARAMS}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`EFetch HTTP ${res.status}`);
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const out: Record<string, string> = {};
    doc.querySelectorAll('PubmedArticle').forEach(artEl => {
      const pmid = artEl.querySelector('MedlineCitation > PMID')?.textContent?.trim();
      if (!pmid) return;
      const parts: string[] = [];
      artEl.querySelectorAll('AbstractText').forEach(el => {
        const label = el.getAttribute('Label');
        const text = el.textContent?.trim() ?? '';
        if (!text) return;
        parts.push(label ? `${label}: ${text}` : text);
      });
      out[pmid] = parts.join(' ');
    });
    return out;
  } catch (e) {
    console.warn('[PubMed] EFetch error:', e);
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Author display formatting
// ─────────────────────────────────────────────────────────────────────────────

function authorDisplay(authors: string[]): string {
  if (authors.length === 0) return 'Anonymous';
  // NCBI format: "Lastname Initials" — last name is first word
  const last = (a: string) => a.split(' ')[0];
  if (authors.length === 1) return last(authors[0]);
  if (authors.length === 2) return `${last(authors[0])} & ${last(authors[1])}`;
  return `${last(authors[0])} et al.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchArticles — search + summary + abstracts in sequence
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchArticles(
  query: string,
  maxResults = 5,
): Promise<PubMedArticle[]> {
  const pmids = await pubmedSearch(query, maxResults);
  if (pmids.length === 0) return [];
  const summaries = await pubmedSummary(pmids);
  const abstracts = await pubmedAbstracts(pmids);
  return summaries.map(s => {
    const ad = authorDisplay(s.authors);
    return {
      ...s,
      authorDisplay: ad,
      abstract: abstracts[s.pmid] ?? '',
      citationDisplay: `${ad}, ${s.pubYear}`,
      citationSystem: `PMID: ${s.pmid}`,
      citationFull: `${ad}, ${s.pubYear} (PMID: ${s.pmid})`,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// searchWithFallback — primary query, then variants, then broad fallback
// ─────────────────────────────────────────────────────────────────────────────

export async function searchWithFallback(
  primary: string,
  variants: string[] = [],
  maxResults = 5,
): Promise<PubMedArticle[]> {
  let arts = await fetchArticles(primary, maxResults);
  if (arts.length > 0) return arts;
  for (const v of variants) {
    if (!v.trim()) continue;
    arts = await fetchArticles(v, maxResults);
    if (arts.length > 0) return arts;
  }
  // Last-resort: 2-3 keyword broad search without date filter
  const broad = primary.split(' ').slice(0, 3).join(' ');
  if (broad !== primary) {
    arts = await fetchArticles(broad, maxResults);
  }
  return arts;
}
