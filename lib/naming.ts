/** Proposals have no name of their own, so their Drive folder is named from brand + date + short id. */
export function proposalFolderName(brandName: string, createdAt: string, proposalId: string): string {
  return `${brandName} - ${createdAt.slice(0, 10)} - ${proposalId.slice(0, 8)}`
}

/** ASCII-safe filename fragment (Content-Disposition must not carry raw unicode). */
export function safeFilePart(s: string): string {
  // Collapse runs of dots and trim separators from the ends, so a name can never start with a dot
  // (a hidden file) or contain '..', whatever was typed into a brand name or document title.
  return s.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.{2,}/g, '.').replace(/^[._-]+|[._-]+$/g, '') || 'proposal'
}
