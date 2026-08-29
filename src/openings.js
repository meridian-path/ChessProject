'use strict';

/**
 * The set of opening pages this build produces. Started as a fixed set of
 * 10 (spec section 1.2) -- deliberately fixed at the time, see spec section
 * 3.4 ("why templated per-opening pages are not scaled-content abuse
 * here"): no programmatic expansion, no "one page per ECO code". Since
 * then this list has grown one hand-vetted, demand-checked opening at a
 * time -- each addition still goes through the same manual editorial
 * process spec 3.4 describes, just no longer capped at exactly 10. `line`
 * is the defining move sequence from the start position; `ecoHint`/
 * API-returned `opening.eco` are cross-checked at build time
 * (src/buildContent.js), never assumed equal. `strategy` is a real,
 * hand-written paragraph of opening-specific chess commentary (typical
 * plans, structures, key ideas) rendered on that opening's own page
 * alongside the live Explorer data -- added to raise these pages' prose/
 * data ratio; every entry must carry one.
 *
 * Pure data + pure helpers only -- no I/O, unit-testable in isolation.
 */

const OPENINGS = [
  {
    slug: 'italian-game',
    name: 'Italian Game',
    ecoHint: 'C50',
    side: 'white',
    strategy: "The bishop on c4 aims straight at f7, the weak point closest to Black's king before castling, while White races to finish development and claim the center with d3 or d4. How directly White presses that target splits the opening into two personalities: the quiet Giuoco Piano builds slowly behind c3 and d4, while the Two Knights Defense invites sharp tactics as early as move four if Black's pieces stray too far from defense.",
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'e7e5', san: 'e5' },
      { uci: 'g1f3', san: 'Nf3' },
      { uci: 'b8c6', san: 'Nc6' },
      { uci: 'f1c4', san: 'Bc4' },
    ],
  },
  {
    slug: 'ruy-lopez',
    name: 'Ruy Lopez',
    ecoHint: 'C60',
    side: 'white',
    strategy: "The bishop on b5 targets the knight defending e5, threatening to trade it off and leave the e-pawn hanging outright. Black almost always answers with a6, forcing White to choose between retreating to a4 to keep that pressure alive or trading on c6, giving up the bishop pair to saddle Black with doubled pawns. The middlegames that follow are some of the most studied in chess: slow maneuvering for central and kingside space rather than an early tactical fight.",
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'e7e5', san: 'e5' },
      { uci: 'g1f3', san: 'Nf3' },
      { uci: 'b8c6', san: 'Nc6' },
      { uci: 'f1b5', san: 'Bb5' },
    ],
  },
  {
    slug: 'scotch-game',
    name: 'Scotch Game',
    ecoHint: 'C44',
    side: 'white',
    strategy: "Instead of the Ruy Lopez's slow buildup, White strikes the center immediately with d4, offering a pawn trade to open the position before Black finishes developing. Play tends to get concrete fast: after exd4 Nxd4, White's knight sits actively in the center and both sides usually finish developing within a few more moves, trading the long strategic battles of quieter openings for faster piece activity.",
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'e7e5', san: 'e5' },
      { uci: 'g1f3', san: 'Nf3' },
      { uci: 'b8c6', san: 'Nc6' },
      { uci: 'd2d4', san: 'd4' },
    ],
  },
  {
    slug: 'sicilian-defense',
    name: 'Sicilian Defense',
    ecoHint: 'B20',
    side: 'black',
    strategy: "Black meets e4 with an asymmetrical reply instead of mirroring it with e5, aiming to trade the c-pawn for White's d-pawn and open the c-file for a rook and queenside play later. That imbalance is the whole point: rather than settle into a level, drawish structure, both sides are fighting for different things from the first move, which is why the Sicilian produces some of the sharpest, most heavily analyzed positions in chess, from the Najdorf to the Dragon.",
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'c7c5', san: 'c5' },
    ],
  },
  {
    slug: 'french-defense',
    name: 'French Defense',
    ecoHint: 'C00',
    side: 'black',
    strategy: "Black prepares d5 without committing the light-squared bishop first, accepting that it may stay boxed in behind its own pawns for a while. After the common continuation d4 d5 e5, White typically gets more space and kingside attacking chances, while Black's plan is to attack that pawn chain at both ends - c5 against its base, f6 against its head - rather than contest the center head-on.",
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'e7e6', san: 'e6' },
    ],
  },
  {
    slug: 'caro-kann-defense',
    name: 'Caro-Kann Defense',
    ecoHint: 'B10',
    side: 'black',
    strategy: "Like the French Defense, Black is preparing d5 to challenge the center, but c6 leaves room to develop the light-squared bishop outside the pawn chain before locking it in with e6 later. That one move-order difference is why the Caro-Kann has a reputation as one of Black's soundest replies to e4: fewer structural weaknesses to defend, at the cost of slightly less active piece play than sharper defenses offer.",
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'c7c6', san: 'c6' },
    ],
  },
  {
    slug: 'scandinavian-defense',
    name: 'Scandinavian Defense',
    ecoHint: 'B01',
    side: 'black',
    strategy: "Black challenges the center immediately, and after the common exd5 Qxd5 Nc3, accepts losing a tempo when the queen gets kicked in exchange for simple, low-theory development: get the pieces out, castle, and play a normal middlegame without memorizing long forcing lines. It's a practical, low-maintenance choice rather than a theoretically ambitious one, which is exactly why it appeals to players who don't want to study opening theory for hours.",
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'd7d5', san: 'd5' },
    ],
  },
  {
    slug: 'queens-gambit',
    name: "Queen's Gambit",
    ecoHint: 'D06',
    side: 'white',
    strategy: "The c-pawn isn't a real sacrifice: if Black grabs it with dxc4, White gets it back quickly with a lead in development and active pieces, which is why the Queen's Gambit Accepted is considered fine for White but rarely dangerous for Black. The more common replies, e6 or c6, decline the pawn and lead to rich middlegames fought over the c-file, the minority attack, and whether an eventual isolated queen's pawn favors the side with more piece activity or the side that can blockade it.",
    line: [
      { uci: 'd2d4', san: 'd4' },
      { uci: 'd7d5', san: 'd5' },
      { uci: 'c2c4', san: 'c4' },
    ],
  },
  {
    slug: 'london-system',
    name: 'London System',
    ecoHint: 'D02',
    side: 'white',
    strategy: "White develops the same pieces to nearly the same squares in almost every game, whatever Black plays: bishop to f4 before the knight blocks it in, then e3, Bd3, and castling. That's the appeal, not a weakness - it's a low-theory, low-risk setup that avoids memorizing a different plan for each of Black's replies, in exchange for less fighting chance at a real opening edge than a more theoretically demanding first move would give.",
    line: [
      { uci: 'd2d4', san: 'd4' },
      { uci: 'd7d5', san: 'd5' },
      { uci: 'c1f4', san: 'Bf4' },
    ],
  },
  {
    slug: 'kings-indian-defense',
    name: "King's Indian Defense",
    ecoHint: 'E60',
    side: 'black',
    strategy: "Black lets White build a big classical center on purpose, planning to finish development behind a solid kingside fianchetto and then undermine that center later with e5 or c5. The resulting middlegames are famously opposite-wing battles: White pushes for space and play on the queenside while Black attacks the king with a pawn storm and piece play on the other side of the board.",
    line: [
      { uci: 'd2d4', san: 'd4' },
      { uci: 'g8f6', san: 'Nf6' },
      { uci: 'c2c4', san: 'c4' },
      { uci: 'g7g6', san: 'g6' },
    ],
  },
  {
    slug: 'nimzo-indian-defense',
    name: 'Nimzo-Indian Defense',
    ecoHint: 'E20',
    side: 'black',
    strategy: "Black pins the knight on c3 immediately, before White can play e4 and build an ideal classical center. Trading the bishop for that knight is a common and often willing choice, saddling White with doubled c-pawns as a long-term structural target in exchange for giving up the bishop pair, which is part of why the Nimzo-Indian is considered one of the most principled and respected replies to d4.",
    line: [
      { uci: 'd2d4', san: 'd4' },
      { uci: 'g8f6', san: 'Nf6' },
      { uci: 'c2c4', san: 'c4' },
      { uci: 'e7e6', san: 'e6' },
      { uci: 'b1c3', san: 'Nc3' },
      { uci: 'f8b4', san: 'Bb4' },
    ],
  },
  {
    slug: 'slav-defense',
    name: 'Slav Defense',
    ecoHint: 'D10',
    side: 'black',
    strategy: "Like the Queen's Gambit Declined, Black is defending the center and declining the c-pawn, but c6 keeps the option to develop the light-squared bishop outside the pawn chain before playing e6 - the same structural idea the Caro-Kann uses against e4. That flexibility is why the Slav has a reputation as one of Black's most solid, hardest-to-crack replies to d4.",
    line: [
      { uci: 'd2d4', san: 'd4' },
      { uci: 'd7d5', san: 'd5' },
      { uci: 'c2c4', san: 'c4' },
      { uci: 'c7c6', san: 'c6' },
    ],
  },
];

// Static filenames this build already writes outside of openings.js's own
// slugs (existing tool pages + hub pages), used by the collision check
// below. Guide/article slugs (src/content/*.js) aren't individually listed
// here -- buildStatic.js's own assertFilenamesUnique() checks the full,
// final file list (repertoire + opening + guide + hub + compliance pages)
// after every page is actually written, which is the authoritative check.
const RESERVED_STATIC_FILENAMES = [
  'index.html',
  'player.html',
  'player-lookup.js',
  'openings.html',
  'guides.html',
  'chess-opening-faq.html',
  'italian-game-drill.html',
];

function getOpening(slug) {
  return OPENINGS.find((o) => o.slug === slug) || null;
}

function slugToFilename(slug) {
  return `${slug}.html`;
}

function assertOpeningsWellFormed() {
  const seenSlugs = new Set();
  for (const o of OPENINGS) {
    if (!/^[a-z0-9-]+$/.test(o.slug)) {
      throw new Error(`openings.js: slug "${o.slug}" is not URL-safe`);
    }
    if (seenSlugs.has(o.slug)) {
      throw new Error(`openings.js: duplicate slug "${o.slug}"`);
    }
    seenSlugs.add(o.slug);
    if (RESERVED_STATIC_FILENAMES.includes(slugToFilename(o.slug))) {
      throw new Error(`openings.js: slug "${o.slug}" collides with a reserved static filename`);
    }
    if (o.side !== 'white' && o.side !== 'black') {
      throw new Error(`openings.js: "${o.slug}" has invalid side "${o.side}"`);
    }
    if (!Array.isArray(o.line) || o.line.length === 0) {
      throw new Error(`openings.js: "${o.slug}" has an empty line`);
    }
    // Floor, not a quality check -- catches an empty/placeholder/truncated
    // entry, not "is this actually good commentary" (that's a human/review
    // judgment, not something a length check can validate).
    if (typeof o.strategy !== 'string' || o.strategy.trim().length < 120) {
      throw new Error(`openings.js: "${o.slug}" is missing real strategy commentary (or it's suspiciously short)`);
    }
    for (const ply of o.line) {
      if (!ply.uci || !ply.san) {
        throw new Error(`openings.js: "${o.slug}" has a ply missing uci/san`);
      }
    }
  }
  return true;
}

module.exports = {
  OPENINGS,
  RESERVED_STATIC_FILENAMES,
  getOpening,
  slugToFilename,
  assertOpeningsWellFormed,
};
