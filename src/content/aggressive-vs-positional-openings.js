'use strict';

/**
 * Editorial guide answering "which opening fits my playing style?" -- the
 * aggressive/tactical vs. solid/positional framing players already use to
 * pick a repertoire. Two kinds of claim are kept strictly separate, same
 * discipline as opening-strategy-by-time-control.js: the STYLE label on
 * each tracked opening is conventional chess reputation (stated as such,
 * cited nowhere on this site as a measurement), while the draw-rate
 * numbers are 100% real, computed from ctx.entries the same as every
 * other guide. Draw rate is used as an honest, imperfect, already-measured
 * proxy for "how forcing/decisive" a line tends to be -- never presented
 * as a definitive verdict on any opening's style.
 */

const SLUG = 'aggressive-vs-positional-openings';

const meta = {
  slug: SLUG,
  title: 'Aggressive vs. Positional Openings',
  description: 'Choosing an opening by playing style: which tracked openings carry a sharp, tactical reputation versus a solid one, checked against real draw rates.',
  targetQuery: 'aggressive chess openings by rating',
  related: ['sicilian-defense', 'caro-kann-defense', 'kings-indian-defense'],
};

// Conventional chess-opening reputation, the same widely-cited
// classification found in any opening reference -- disclosed on the page
// itself as reputation, not a measurement this site makes. 'flexible'
// covers an opening whose own reputation genuinely spans both (e.g. the
// Italian Game supports both the sharp Fried Liver Attack and quiet
// development), rather than forcing a binary that misrepresents it.
const STYLE = {
  'italian-game': { label: 'flexible', blurb: 'an open game that supports both the sharp Fried Liver Attack and quiet, slow development' },
  'ruy-lopez': { label: 'flexible', blurb: 'the most studied classical opening, home to both sharp Marshall-style lines and slow maneuvering' },
  'scotch-game': { label: 'aggressive', blurb: 'opens the center immediately and heads toward direct piece play rather than a slow buildup' },
  'sicilian-defense': { label: 'aggressive', blurb: 'the most combative reply to 1.e4, deliberately unbalancing the position from the first move' },
  'french-defense': { label: 'positional', blurb: 'locks the center early and plays around a long-term pawn structure rather than early tactics' },
  'caro-kann-defense': { label: 'positional', blurb: 'a solid pawn structure that avoids early complications' },
  'scandinavian-defense': { label: 'flexible', blurb: 'straightforward development, though the early queen sortie invites tactics sooner than most solid defenses' },
  'queens-gambit': { label: 'positional', blurb: 'a classical strategic battle for the center with a long-standing positional reputation' },
  'london-system': { label: 'positional', blurb: "a system opening: the same setup regardless of Black's reply, trading flexibility for lower theory requirements" },
  'kings-indian-defense': { label: 'aggressive', blurb: 'a hypermodern setup that concedes the center on purpose, then strikes back with a sharp attack' },
  'nimzo-indian-defense': { label: 'positional', blurb: 'built around piece pressure and structure rather than early tactical complications' },
  'slav-defense': { label: 'positional', blurb: 'a solid pawn-structure defense that avoids early complications' },
};

const STYLE_LABELS = { aggressive: 'Aggressive', positional: 'Positional', flexible: 'Flexible' };

function render(ctx) {
  const { entries, escapeHtml, displayName, formatPct, formatGamesAbbrev, wrapTable } = ctx;
  const defaultBand = entries[0] ? entries[0].model.defaultBand : '1600-1800';

  const rows = entries
    .map(({ openingConfig, model }) => {
      const style = STYLE[openingConfig.slug];
      if (!style) return null;
      const b = (model.bands || []).find((x) => x.band === defaultBand);
      // Never silently drop a tracked opening for insufficient band data --
      // same "still show a row, honest n/a" convention as
      // bestOpeningsByRatingBand.js's `unranked` handling and
      // renderOpeningsHub's own excluded-row test.
      const enoughData = Boolean(b && b.enoughData);
      return {
        slug: openingConfig.slug,
        name: model.name,
        side: model.side,
        style: style.label,
        blurb: style.blurb,
        games: b ? b.games : 0,
        drawPct: enoughData ? b.drawPct : null,
        scoreForSide: enoughData ? b.scoreForSide : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.drawPct == null ? 1 : b.drawPct == null ? -1 : a.drawPct - b.drawPct));

  const tableRows = rows
    .map(
      (r) => `<tr><td><a href="${escapeHtml(r.slug)}.html">${displayName(r.name)}</a></td><td>${escapeHtml(r.side)}</td><td>${STYLE_LABELS[r.style]}</td><td>${formatGamesAbbrev(r.games)}</td><td>${r.drawPct != null ? `${formatPct(r.drawPct)}%` : 'n/a'}</td><td>${r.scoreForSide != null ? `${formatPct(r.scoreForSide)}%` : 'n/a'}</td></tr>`
    )
    .join('');

  // Real check of the reputational labels against this build's own draw
  // rate: weighted average draw% for the aggressive-labeled group versus
  // the positional-labeled group (flexible excluded, since it isn't a
  // claim either way). Reports whatever the real numbers show, including
  // if it doesn't confirm the reputation -- same honesty discipline as
  // every other guide in this directory.
  const withDraw = rows.filter((r) => r.drawPct != null && r.games > 0);
  const groupAvg = (label) => {
    const g = withDraw.filter((r) => r.style === label);
    if (!g.length) return null;
    const totalGames = g.reduce((s, r) => s + r.games, 0);
    return { avg: Number((g.reduce((s, r) => s + r.drawPct * r.games, 0) / totalGames).toFixed(1)), count: g.length };
  };
  const aggAvg = groupAvg('aggressive');
  const posAvg = groupAvg('positional');

  const aggressiveList = rows.filter((r) => r.style === 'aggressive');
  const positionalList = rows.filter((r) => r.style === 'positional');
  const flexibleList = rows.filter((r) => r.style === 'flexible');

  const listLinks = (list) => list.map((r) => `<a href="${escapeHtml(r.slug)}.html">${displayName(r.name)}</a>`).join(', ');

  return `
    <p>&ldquo;Aggressive&rdquo; and &ldquo;positional&rdquo; are the two words players reach for most when picking an opening by feel: do you want direct piece play and forcing lines, or a slower buildup around structure and long-term plans? This page keeps that reputation-based framing separate from what this site can actually measure, then checks the two against each other.</p>

    <h2>How this page defines each style</h2>
    <p>The style label on each tracked opening below is conventional chess-opening reputation, the kind found in any opening reference, not a measurement this site makes. It is disclosed in full so nothing here is a hidden judgment call:</p>
    <ul>
      ${Object.entries(STYLE).map(([slug, s]) => {
        const entry = entries.find((e) => e.openingConfig.slug === slug);
        const name = entry ? entry.model.name : slug;
        return `<li><strong>${displayName(name)}</strong> (${STYLE_LABELS[s.label]}): ${escapeHtml(s.blurb)}.</li>`;
      }).join('')}
    </ul>

    <h2>Checked against a real number: draw rate</h2>
    <p>Draw rate is not the same thing as &ldquo;style,&rdquo; but it is one honest, already-measured proxy for how forcing a line tends to be: a lower draw rate means more games at ${escapeHtml(defaultBand)} end decisively, one way or the other. Every row below is this site&rsquo;s own real data, sorted from the lowest draw rate (most decisive) to the highest (most drawish):</p>
    ${tableRows ? wrapTable(`<table><caption class="sr-only">Tracked openings by style reputation and real draw rate at ${escapeHtml(defaultBand)}</caption><thead><tr><th scope="col">Opening</th><th scope="col">Side</th><th scope="col">Style</th><th scope="col">Games</th><th scope="col">Draw rate</th><th scope="col">Score</th></tr></thead><tbody>${tableRows}</tbody></table>`, `Tracked openings by style and real draw rate at ${defaultBand}`) : '<p class="empty-note">Band data was not available for this build.</p>'}
    <p>${aggAvg && posAvg
      ? `In this build, the ${aggAvg.count} openings labeled &ldquo;aggressive&rdquo; above average a ${formatPct(aggAvg.avg)}% draw rate at ${escapeHtml(defaultBand)}, versus ${formatPct(posAvg.avg)}% for the ${posAvg.count} labeled &ldquo;positional.&rdquo; ${aggAvg.avg < posAvg.avg ? 'That is consistent with the reputation: the aggressive-labeled group draws less often in this build&rsquo;s own data.' : `That does not cleanly confirm the reputation in this build&rsquo;s own numbers, which is worth stating plainly rather than smoothing over - draw rate is only one imperfect proxy, and a small tracked set (${entries.length} openings) can look noisy even where the underlying reputation is well established.`}`
      : 'This build did not have enough band data across both groups to compute a real comparison.'}
    A sharp tactical game can still end in a draw by repetition or a forced simplification, and a quiet positional game can end decisively from a single late mistake, so treat this as a supporting data point, not a verdict.</p>

    <h2>Picking by style</h2>
    <p>${aggressiveList.length ? `If you want direct piece play and forcing lines: ${listLinks(aggressiveList)}.` : ''} ${positionalList.length ? `If you prefer a slower buildup around structure and long-term plans: ${listLinks(positionalList)}.` : ''} ${flexibleList.length ? `A few tracked openings genuinely support either approach depending on the line you choose within them: ${listLinks(flexibleList)}.` : ''}</p>
    <p>Style preference is a real reason to choose an opening, and it does not need a data justification the way a win-rate claim does - you will study a line you enjoy more than one you don&rsquo;t, whatever its numbers say. Use the table above to see the real sample size and score behind whichever style you lean toward, then read that opening&rsquo;s own page for the full breakdown.</p>

    <h2>Go deeper</h2>
    <p>See <a href="how-to-build-your-opening-repertoire.html">how to build your opening repertoire &rarr;</a> for a fuller method that starts from this same shortlist, or the <a href="openings.html">full openings comparison &rarr;</a> for every tracked opening at every rating band.</p>
  `;
}

module.exports = { meta, render, STYLE };
