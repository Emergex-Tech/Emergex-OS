/** Proposals have no name of their own, so their Drive folder is named from brand + date + short id. */
export function proposalFolderName(brandName: string, createdAt: string, proposalId: string): string {
  return `${brandName} - ${createdAt.slice(0, 10)} - ${proposalId.slice(0, 8)}`
}

/** ASCII-safe filename fragment (Content-Disposition must not carry raw unicode). */
export function safeFilePart(s: string): string {
  return s.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'proposal'
}
