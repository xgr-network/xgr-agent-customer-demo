import React from 'react';

const LEGAL_LINKS = [
  { label: 'Imprint', href: 'https://xgr.network/imprint.html' },
  { label: 'Terms of Use', href: 'https://xgr.network/terms-of-use.html' },
  { label: 'Privacy Policy', href: 'https://xgr.network/privacy-policy.html' },
  { label: 'OTC Terms', href: 'https://xgr.network/otc-terms.html' },
];

const SOCIAL_LINKS = [
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/xgr-network/' },
  { label: 'X', href: 'https://x.com/XGRNetwork' },
];

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-brand">© {year} XGR Agent Demo</div>
        <nav className="footer-links" aria-label="XGR legal links">
          {LEGAL_LINKS.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>
          ))}
        </nav>
        <nav className="footer-social" aria-label="XGR social links">
          {SOCIAL_LINKS.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
