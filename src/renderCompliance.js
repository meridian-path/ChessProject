'use strict';

/**
 * Compliance pages: privacy policy, about, contact, and an ads.txt stub.
 * Google AdSense review
 * requires a privacy policy, an about page, and a contact page (ads.txt is
 * recommended, not required). A SEPARATE module from render.js for the same
 * reason renderContent.js is (see that file's own header comment): these
 * pages are never bundled into the browser-side player-lookup script, so
 * this file may safely require() render.js/site.js.
 *
 * Static-only, like renderContent.js: every page here is fully pre-rendered
 * HTML built by src/buildStatic.js. The local dev server (src/server.js) has
 * no routes for these pages and none are added here -- they only matter for
 * the GitHub Pages static build, which is what AdSense review (or a human
 * visitor) would actually see.
 *
 * The privacy policy describes GoatCounter analytics and Google AdSense,
 * the two data collectors actually live on this site. AdSense was approved
 * 2026-08-12 (publisher ID ca-pub-9767914878112531) -- the ad script lives in
 * renderDocumentHead (src/render.js) so it loads on every page, and the
 * matching ads.txt line lives in adsTxtContent below.
 */

const { escapeHtml, renderDocumentHead, renderHeader, renderFooter } = require('./render');
const { SITE_NAME, BUILD_DATE, absoluteUrl } = require('./site');

/**
 * @param {{nav: object, legalLinks: {privacy:string, about:string, contact:string}}} opts
 * @returns {string} a full standalone HTML document
 */
function renderPrivacyPage({ nav, legalLinks }) {
  const title = `Privacy Policy | ${SITE_NAME}`;
  const description = `What ${SITE_NAME} collects, why, and what it does not: analytics, third-party links, and advertising (Google AdSense).`;
  const canonical = absoluteUrl('privacy.html');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical })}
<body>
<div class="page">
  ${renderHeader(nav)}
  <main class="prose" id="main-content">
    <h1 class="page-title">Privacy Policy</h1>
    <p class="subtitle">Effective ${escapeHtml(BUILD_DATE)}</p>

    <h2>What this site is</h2>
    <p>${escapeHtml(SITE_NAME)} is a set of static pages showing chess opening and rating
      statistics computed from Lichess&rsquo;s public API and Opening Explorer. There are no user
      accounts, no logins, and no forms that collect personal information anywhere on this
      site (the player-lookup page sends only the Lichess username you type directly to
      Lichess&rsquo;s own public API, from your browser - this site&rsquo;s own servers never see or
      store it).</p>

    <h2>Analytics</h2>
    <p>This site uses <a href="https://www.goatcounter.com/" target="_blank" rel="noopener noreferrer">GoatCounter</a>,
      a privacy-focused analytics tool, to count page views. GoatCounter&rsquo;s default
      configuration does not use tracking cookies and does not collect personally
      identifying information; it records aggregate counts of visits, pages viewed, and
      referring sites. See
      <a href="https://www.goatcounter.com/privacy" target="_blank" rel="noopener noreferrer">GoatCounter&rsquo;s own privacy policy</a>
      for exactly what it collects and retains.</p>

    <h2>Advertising</h2>
    <p>This site runs <a href="https://www.google.com/adsense/" target="_blank" rel="noopener noreferrer">Google AdSense</a>.
      Google and its advertising partners may use cookies or similar identifiers to show ads
      based on your visits to this and other sites. You can see and control what Google knows
      for ad personalization at
      <a href="https://adssettings.google.com/" target="_blank" rel="noopener noreferrer">Google&rsquo;s Ad Settings</a>,
      and read more about how this works at
      <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">how Google uses information from sites that use its services</a>
      and <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer">how Google uses data in advertising</a>.
      This site&rsquo;s own code does not read, set, or have access to any AdSense cookie or
      identifier - that data goes directly between your browser and Google.</p>

    <h2>Third-party links</h2>
    <p>Pages on this site link out to <a href="https://lichess.org" target="_blank" rel="noopener noreferrer">lichess.org</a>
      for game analysis and data, and to a voluntary support link
      (<a href="https://ko-fi.com/flavaa" target="_blank" rel="noopener noreferrer">Ko-fi</a>).
      That is operated by its own company under its own privacy policy - review theirs
      before using it. See the disclosure note in this site&rsquo;s footer for more on that
      link.</p>

    <h2>Cookies</h2>
    <p>This site&rsquo;s own code does not set any cookies. GoatCounter&rsquo;s default configuration
      (described above) is cookieless. Google AdSense (described above under Advertising)
      does use cookies or similar identifiers, set directly by Google, not by this site -
      see the Advertising section above for how to control that.</p>
    <p>The opening drill saves your progress (which level you have reached) in your own
      browser using local storage. That data never leaves your device, is not a cookie, is
      not sent to us or anyone else, and clearing your browser data removes it.</p>

    <h2>Children&rsquo;s privacy</h2>
    <p>This site is not directed at children and does not knowingly collect information from
      anyone under 13.</p>

    <h2>Changes to this policy</h2>
    <p>This policy may be updated as the site changes (for example, if advertising or new
      analytics are added). The effective date above reflects the most recent update.</p>

    <h2>Contact</h2>
    <p>Questions about this policy? See the <a href="${escapeHtml(legalLinks.contact)}">Contact page</a>.</p>
  </main>
  ${renderFooter('This is the privacy policy for the whole site.', legalLinks)}
</div>
</body>
</html>
`;
}

/**
 * @param {{nav: object, legalLinks: {privacy:string, about:string, contact:string}}} opts
 * @returns {string} a full standalone HTML document
 */
function renderAboutPage({ nav, legalLinks }) {
  const title = `About | ${SITE_NAME}`;
  const description = `${SITE_NAME} shows chess opening and rating statistics computed directly from Lichess's public data - what this site is and how it works.`;
  const canonical = absoluteUrl('about.html');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical })}
<body>
<div class="page">
  ${renderHeader(nav)}
  <main class="prose" id="main-content">
    <h1 class="page-title">About ${escapeHtml(SITE_NAME)}</h1>

    <h2>What this is</h2>
    <p>${escapeHtml(SITE_NAME)} shows chess opening win rates, common replies, and rating-band
      repertoire trees, all computed directly from real games via Lichess&rsquo;s public API and
      Opening Explorer. Nothing here is opinion or an engine evaluation dressed up as
      statistics - every percentage, table, and &ldquo;common mistake&rdquo; callout on this site traces
      back to an actual count of games played at that rating.</p>

    <h2>Why it exists</h2>
    <p>Most opening guides describe a line in the abstract, without saying how it actually
      performs for players at your own rating. This site pairs each opening with the data:
      how it scores at 1400-1600 versus 2000+, what opponents actually play in reply (not
      just the &ldquo;book&rdquo; line), and where real games at your rating band tend to go wrong.</p>

    <h2>How it&rsquo;s built</h2>
    <p>Every page is generated from Lichess&rsquo;s public, keyless Opening Explorer API and the
      general Lichess API - no proprietary or private data source is used. Pages are
      pre-rendered as plain static HTML; the player-lookup page is the one exception, calling
      Lichess&rsquo;s API directly from your browser so it can look up any username on demand.</p>

    <h2>Who runs this</h2>
    <p>This site is independently run. No individually-attributed author byline is published
      on these pages at this time - where authorship needs to be named (for example, in
      structured data on article pages), it is attributed to ${escapeHtml(SITE_NAME)} as a
      publisher rather than to an invented person.</p>

    <h2>Support</h2>
    <p>This site is free to use. If you find it useful, a voluntary support link appears in the
      footer of every page (Ko-fi) - see the disclosure note there for what that does and
      doesn&rsquo;t mean.</p>

    <h2>Questions</h2>
    <p>See the <a href="${escapeHtml(legalLinks.contact)}">Contact page</a>.</p>
  </main>
  ${renderFooter('Data source for every page on this site: <a href="https://lichess.org/api" rel="noopener noreferrer">lichess.org/api</a>.', legalLinks)}
</div>
</body>
</html>
`;
}

/**
 * @param {{nav: object, legalLinks: {privacy:string, about:string, contact:string}}} opts
 * @returns {string} a full standalone HTML document
 */
function renderContactPage({ nav, legalLinks }) {
  const title = `Contact | ${SITE_NAME}`;
  const description = `How to reach ${SITE_NAME} with questions, corrections, or privacy requests.`;
  const canonical = absoluteUrl('contact.html');
  const CONTACT_EMAIL = 'meridianpath.media@gmail.com';

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical })}
<body>
<div class="page">
  ${renderHeader(nav)}
  <main class="prose" id="main-content">
    <h1 class="page-title">Contact</h1>

    <p>Questions, corrections (for example, a wrong move order or a stat that looks off), or
      privacy requests? Reach out using the contact method below.</p>

    <p class="callout">
      <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>
    </p>

    <p>See also the <a href="${escapeHtml(legalLinks.privacy)}">Privacy policy</a> and
      <a href="${escapeHtml(legalLinks.about)}">About page</a>.</p>
  </main>
  ${renderFooter('This is the contact page for the whole site.', legalLinks)}
</div>
</body>
</html>
`;
}

/**
 * The static-hosting 404 page. GitHub Pages serves /404.html automatically
 * for a custom domain (this site's dist/CNAME), so this needs to exist as a
 * real file in dist/, not a server route. Uses the exact same header/nav/
 * footer shell as every other page (via renderHeader/renderFooter) so a
 * visitor who lands here after a bad/old link never loses the site's
 * navigation. Marked noindex and deliberately excluded from sitemap.xml
 * (src/sitemap.js) -- it is not content, it should never be a search result.
 *
 * @param {{nav: object, legalLinks: {privacy?:string, about?:string, contact?:string},
 *   homeLink: string, openingsLink: string, repertoireLink: string}} opts
 *   `homeLink`/`openingsLink`/`repertoireLink` are passed in by the caller
 *   (src/buildStatic.js), which already knows the real static filenames --
 *   this module never hardcodes or re-derives them, so they can't drift.
 * @returns {string} a full standalone HTML document
 */
function render404Page({ nav, legalLinks, homeLink, openingsLink, repertoireLink }) {
  const title = `Page not found | ${SITE_NAME}`;
  const description = `The page you followed a link to doesn't exist on ${SITE_NAME}. Here's where to pick back up.`;

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, noindex: true })}
<body>
<div class="page">
  ${renderHeader(nav)}
  <main class="prose" id="main-content">
    <h1 class="page-title">That page doesn&rsquo;t exist</h1>
    <p class="subtitle">The link you followed may be out of date, or the page may have moved.
      Here&rsquo;s where to pick back up.</p>
    <ul>
      <li><a href="${escapeHtml(homeLink)}">Home</a></li>
      <li><a href="${escapeHtml(openingsLink)}">Openings index</a></li>
      <li><a href="${escapeHtml(repertoireLink)}">Repertoire explorer</a></li>
    </ul>
  </main>
  ${renderFooter('If you think this is a broken link on our end, the Contact page below can reach us.', legalLinks)}
</div>
</body>
</html>
`;
}

/**
 * ads.txt (IAB/Google spec: https://iabtechlab.com/ads-txt/), declaring
 * Google AdSense as an authorized seller of this site's ad inventory, per
 * the approved account (publisher ID ca-pub-9767914878112531).
 */
function adsTxtContent() {
  return `# ads.txt for ${SITE_NAME}
# Declares authorized sellers of this site's ad inventory.
# See https://iabtechlab.com/ads-txt/ for the spec.
google.com, pub-9767914878112531, DIRECT, f08c47fec0942fa0
`;
}

/**
 * Cloudflare Pages' header-configuration mechanism (a plain dist/_headers
 * file Cloudflare's edge reads at deploy time -- see
 * https://developers.cloudflare.com/pages/configuration/headers/). GitHub
 * Pages cannot set custom response headers at all (no `.htaccess`, no
 * `_headers` -- see docs/SECURITY_REFERENCE.md's Headers section), which is
 * why the site has relied on `<meta http-equiv="Content-Security-Policy">`
 * and `<meta name="referrer">` alone up to now; those meta tags stay in
 * every page as defense-in-depth (some clients only honor the meta form,
 * and it's free), but this file adds the header-only controls a meta tag
 * cannot express: HSTS, X-Content-Type-Options, Permissions-Policy, and a
 * CSP `frame-ancestors` directive (all four are silent no-ops in a meta
 * tag per CSP Level 3 / MDN -- security-standards.md's "No-op meta tags").
 *
 * Directive choices, kept consistent with the existing meta CSP
 * (object-src 'none'; base-uri 'none' -- both appear verbatim in Google's
 * own AdSense-supported CSP, so neither can break ad serving; no script-src
 * is set here for the same reason the meta tag has none -- a static page
 * can't produce the per-response nonce AdSense's real CSP guidance
 * requires, so a fake script-src would be security theatre, not a
 * control). Permissions-Policy disables only browser feature APIs this
 * site never uses (camera, microphone, geolocation, payment, usb, motion
 * sensors, and the deprecated interest-cohort/FLoC signal) -- it does not
 * touch scripts, network requests, or ad serving.
 */
function cloudflareHeadersContent() {
  return `/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()
  Content-Security-Policy: object-src 'none'; base-uri 'none'; frame-ancestors 'none'
`;
}

module.exports = {
  renderPrivacyPage,
  renderAboutPage,
  renderContactPage,
  render404Page,
  adsTxtContent,
  cloudflareHeadersContent,
};
