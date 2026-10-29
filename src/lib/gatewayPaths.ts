/** Resolve Hermes chat artifact hrefs to an absolute gateway workspace path. */
export function gatewayPathFromHref(href: string): string | null {
  const raw = (href || "").trim();
  if (!raw) return null;

  if (/^sandbox:/i.test(raw)) {
    const rest = raw.replace(/^sandbox:/i, "");
    return rest.startsWith("/") ? rest : `/${rest}`;
  }

  if (/^file:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      // file:///opt/data/... → /opt/data/...
      return decodeURIComponent(u.pathname);
    } catch {
      const stripped = raw.replace(/^file:\/\//i, "");
      return stripped.startsWith("/") ? stripped : `/${stripped}`;
    }
  }

  // Absolute unix path pasted as a bare link.
  if (raw.startsWith("/opt/") || raw.startsWith("/home/") || raw.startsWith("/tmp/")) {
    return raw;
  }

  // MEDIA:/path used by some agent prompts
  if (/^MEDIA:/i.test(raw)) {
    const rest = raw.replace(/^MEDIA:/i, "").trim();
    return rest.startsWith("/") ? rest : `/${rest}`;
  }

  return null;
}

export function isGatewayArtifactHref(href: string): boolean {
  return gatewayPathFromHref(href) != null;
}
