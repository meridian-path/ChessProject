'use strict';

/**
 * Editorial guide answering "how many openings do I actually need?" -- a
 * real, distinct query (verified via web search, 2026-08-25) that this
 * site's existing guides touch only in passing: how-to-build-your-opening-
 * repertoire.js's Step 5 has one sentence on it ("Four openings, understood,
 * beat twelve memorized," now linking here) inside a step about
 * post-selection maintenance, not a dedicated treatment;
 * upgrade-your-repertoire-as-you-improve.js covers WHEN to deepen an
 * existing opening as rating rises (not the starting breadth question);
 * should-you-study-openings-under-1500.js covers whether opening study is
 * worth the TIME at all (not how many openings to split that time across).
 * None of the three answers "how many" as its own question -- same "one
 * broad guide touches it lightly, a dedicated guide goes deep" pattern
 * already established by opening-strategy-by-time-control.js vs.
 * rapid-chess-opening-prep.js (see that file's own header comment).
 *
 * Query-demand evidence (per evidence-sourcing.md, cited by real URL, not
 * just "multiple sites"): chess.com/blog/paulchuxin/crafting-your-ultimate-
 * opening-repertoire-a-guide-for-club-players, chess.com/blog/matbobula/
 * how-to-build-an-opening-repertoire-that-works, chessatlas.net/blog/
 * opening-repertoire-building/how-to-build-a-chess-opening-repertoire-that-
 * actually-sticks-2026-guide, exeterchessclub.org.uk/content/choosing-
 * opening-repertoire, cipherchess.com/blog/how-to-build-a-chess-opening-
 * repertoire, mychessplan.com/how-to-build-chess-opening-repertoire-rating-
 * based-blueprint -- all independently converge on the same narrow "2-4
 * openings, depth over breadth" answer paraphrased below.
 *
 * Same two-claims-kept-separate discipline as every other guide in this
 * directory (see rapid-chess-opening-prep.js's own header comment for the
 * fullest statement of it): the breadth-vs-depth advice below is standard,
 * widely-agreed chess pedagogy, stated as such, never as something this
 * site measured. The only site-own claim is a plain count of what this
 * build itself tracks (ctx.entries.length, split by side) -- not a ranking,
 * not a score, just an honest number, and NOT presented as evidence for the
 * 2-4 recommendation above (this site's own 12-opening build is bigger than
 * that number, not a confirmation of it -- see the render() comment below
 * on the sentence a review caught making that exact mistake).
 *
 * `related: []` deliberately, not the two guide slugs this page actually
 * cross-links inline in its own "Go deeper" section -- buildContentPages()
 * (src/buildContent.js) only ever resolves meta.related against OPENING
 * slugs (entries.find on openingConfig.slug), never guide slugs; every
 * sibling guide in this directory that names other GUIDES as `related`
 * would hit the same silent no-op (caught in review on this page, worth
 * checking on other guides' `related` arrays going forward rather than
 * assuming they're wired to something real).
 */

const SLUG = 'how-many-chess-openings-should-you-learn';

const meta = {
  slug: SLUG,
  title: 'How Many Chess Openings Should You Learn?',
  description: "More openings isn't a better repertoire. What breadth-vs-depth advice actually recommends, and why 2-4 openings is normal, not thin.",
  targetQuery: 'how many chess openings should you learn',
  related: [],
};

function render(ctx) {
  const { entries, escapeHtml } = ctx;

  const whiteCount = entries.filter((e) => e.openingConfig.side === 'white').length;
  const blackCount = entries.filter((e) => e.openingConfig.side === 'black').length;

  return `
    <p>A longer opening list can look like progress, but it usually isn&rsquo;t one. &ldquo;How many openings should I know?&rdquo; is a real, common question, and the standard answer across chess-education sources is consistently narrower than most players expect: one first move as White, one reply to 1.e4, one reply to 1.d4, and little else - a repertoire of roughly 2-4 openings total, not ten.</p>

    <h2>Why narrower usually wins</h2>
    <p>This is standard, widely-agreed chess advice, not a measurement this site makes itself. A player who has studied two openings to real depth - the typical middlegame plans, the ideas behind the first several moves, not just the moves themselves - tends to outperform a player who has sampled ten openings only a few moves deep into each. Every additional opening splits the same study time thinner, and the payoff from depth (recognizing a plan before your opponent finishes it) only shows up once you&rsquo;re actually past the point where most games at your level diverge from known theory. A repertoire that fits in your head well enough to play from memory under a clock is doing its job; one so wide you&rsquo;re still recognizing positions by feel rather than plan is working against you, no matter how many openings it covers.</p>

    <h2>What a narrow repertoire actually looks like</h2>
    <p>This build tracks ${entries.length} openings total - ${whiteCount} for White, ${blackCount} for Black. You don&rsquo;t need all of them: picking one per color you actually enjoy playing, and going deep on those, is a complete repertoire by the standard above. See <a href="openings.html">the full comparison &rarr;</a> to browse what this site tracks, or a rating-banded ranking (<a href="best-white-openings-1600-1800.html">best White openings at 1600-1800 &rarr;</a>, <a href="best-black-openings-1600-1800.html">best Black openings at 1600-1800 &rarr;</a>, and the other bands linked from each) if you want a starting point narrowed by how it actually scores at your level.</p>

    <h2>When adding a second opening for the same color makes sense</h2>
    <p>The one common, legitimate reason to carry two responses to the same first move is a specific opponent-dependent split - for example a sharper reply to 1.e4 and a more solid one to 1.d4, since those are different questions your opponent&rsquo;s own first move already answers for you, not two overlapping answers to the same question. Carrying two openings against the exact same first move &ldquo;for variety&rdquo; is the pattern most likely to leave both half-learned.</p>

    <h2>Go deeper</h2>
    <p>See <a href="how-to-build-your-opening-repertoire.html">how to build your opening repertoire &rarr;</a> for the fuller method once you&rsquo;ve picked your openings, or <a href="should-you-study-openings-under-1500.html">should you study openings under 1500? &rarr;</a> if the more basic question - whether opening study is worth the time at all - is the one you actually have.</p>
  `;
}

module.exports = { meta, render };
