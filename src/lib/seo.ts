export const canonicalUrl = (site: URL, pathname: string): URL =>
  new URL(pathname, site);

export const safeJsonLd = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

export const baseStructuredData = (site: URL): unknown[] => {
  const origin = site.href.replace(/\/$/, "");
  const organizationId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": organizationId,
      name: "PerkCommons",
      url: origin,
      logo: `${origin}/brand/mark.svg`,
      description:
        "Open-source opportunity directory operated by Nataniel Bogacki from Poland.",
      areaServed: "Worldwide",
      sameAs: [
        "https://github.com/PerkCommons/site",
        "https://github.com/PerkCommons/data",
      ],
      contactPoint: [
        {
          "@type": "ContactPoint",
          contactType: "general inquiries",
          email: "mailto:hello@perkcommons.com",
          url: `${origin}/trust/`,
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": websiteId,
      name: "PerkCommons",
      url: origin,
      publisher: { "@id": organizationId },
      about: { "@id": organizationId },
      potentialAction: {
        "@type": "SearchAction",
        target: `${origin}/opportunities/?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  ];
};
