'use strict';

const SLUG = 'sicilian-vs-french-vs-caro-kann';

const meta = {
  slug: SLUG,
  title: 'Sicilian vs. French vs. Caro-Kann, Compared',
  description: 'Head-to-head win rates for the three most common replies to 1.e4 c-pawn/e-pawn alternatives, across all four rating bands this site tracks.',
  targetQuery: 'sicilian vs french vs caro-kann',
  related: ['sicilian-defense', 'french-defense', 'caro-kann-defense'],
};

const SLUGS = ['sicilian-defense', 'french-defense', 'caro-kann-defense'];
const BANDS = ['1400-1600', '1600-1800', '1800-2000', '2000+'];

function render(ctx) {
  const { entries, escapeHtml, displayName, formatPct, wrapTable, formatGamesAbbrev } = ctx;
  const picked = SLUGS.map((slug) => entries.find((e) => e.openingConfig.slug === slug)).filter(Boolean);
  if (picked.length < 3) {
    return '<p class="empty-note">Not all three openings were available in this build.</p>';
  }

  const headerCells = picked.map((e) => `<th scope="col">${displayName(e.model.name)}</th>`).join('');
  const rows = BANDS.map((band) => {
    const cells = picked
      .map((e) => {
        const b = e.model.bands.find((x) => x.band === band);
        return `<td>${b && b.enoughData ? `${formatPct(b.scoreForSide)}% <span class="rep-pct">(${formatGamesAbbrev(b.games)} games)</span>` : 'not enough games'}</td>`;
      })
      .join('');
    return `<tr><td>${escapeHtml(band)}</td>${cells}</tr>`;
  }).join('');

  const mainBand = '1600-1800';
  const mainScores = picked
    .map((e) => {
      const b = e.model.bands.find((x) => x.band === mainBand);
      return { name: e.model.name, score: b && b.enoughData ? b.scoreForSide : null, games: b ? b.games : 0 };
    })
    .filter((s) => s.score != null)
    .sort((a, b) => b.score - a.score);

  return `
    <p>1.e4 c5 (Sicilian), 1.e4 e6 (French), and 1.e4 c6 (Caro-Kann) are the three most-argued-about replies to 1.e4 for players who don&rsquo;t want to meet it symmetrically with 1...e5. Beginner forums debate which &ldquo;scores best&rdquo; constantly, usually without looking at any actual data. Here&rsquo;s what this site&rsquo;s own tracked games show.</p>

    <h2>Score for Black, by rating band</h2>
    ${wrapTable(`<table><caption class="sr-only">Sicilian vs French vs Caro-Kann score by rating band</caption><thead><tr><th scope="col">Rating band</th>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`, 'Sicilian vs French vs Caro-Kann score by rating band')}

    ${mainScores.length ? `<h2>At ${escapeHtml(mainBand)}</h2><p>${mainScores.map((s, i) => `${i === 0 ? '' : i === mainScores.length - 1 ? ' and ' : ', '}<strong>${displayName(s.name)}</strong> scores ${formatPct(s.score)}%`).join('')} for Black, from real games in this rating band. The gap between the highest and lowest here is ${formatPct(mainScores[0].score - mainScores[mainScores.length - 1].score)} percentage points - worth knowing, but small enough that it shouldn&rsquo;t be the only reason to pick one over another.</p>` : ''}

    <h2>What the data can&rsquo;t tell you</h2>
    <p>None of these numbers measure how much memorization each opening demands, or how sharp/quiet the resulting positions are - both of which are usually the real deciding factor for a human choosing between them, and neither is something a database can score. The Sicilian is generally considered the most theory-heavy of the three and the Caro-Kann the least; that&rsquo;s established opening-theory consensus, not something measured on this page.</p>

    <h2>Go deeper</h2>
    <p>Each opening has its own page with the full band breakdown, common White mistakes against it, and real recent club games: <a href="sicilian-defense.html">Sicilian Defense &rarr;</a>, <a href="french-defense.html">French Defense &rarr;</a>, <a href="caro-kann-defense.html">Caro-Kann Defense &rarr;</a>.</p>
  `;
}

module.exports = { meta, render };
