const PATHS = {
  auth: 'M12 2 4 5v6c0 5.2 3.4 9.8 8 11 4.6-1.2 8-5.8 8-11V5l-8-3zm0 3 5 1.9V11c0 3.6-2.1 6.9-5 8-2.9-1.1-5-4.4-5-8V6.9L12 5zm0 3a3 3 0 0 0-3 3v1h-1v4h8v-4h-1v-1a3 3 0 0 0-3-3zm0 2a1 1 0 0 1 1 1v1h-2v-1a1 1 0 0 1 1-1z',
  api: 'M5 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm14 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 6h5a4 4 0 0 1 4 4v2h-2v-2a2 2 0 0 0-2-2H8V6zm1 10H7a4 4 0 0 1-4-4v-1h2v1a2 2 0 0 0 2 2h2v2z',
  worker: 'M13 2v5.1a5 5 0 1 1-4.9 2H3V7h7v5H8.1a3 3 0 1 0 2.9-3V2h2zm4 2h4v4h-2V6h-2V4zm2 12h2v4h-4v-2h2v-2z',
  module: 'M4 3h7v7H4V3zm9 0h7v7h-7V3zM4 12h7v9H4v-9zm9 0h7v9h-7v-9zM6 5v3h3V5H6zm9 0v3h3V5h-3zM6 14v5h3v-5H6zm9 0v5h3v-5h-3z',
  web: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3.1a15 15 0 0 0-1.4-3.2A8.1 8.1 0 0 1 18.9 8zM12 4c.8.9 1.5 2.2 1.9 4h-3.8c.4-1.8 1.1-3.1 1.9-4zM9.6 4.8A15 15 0 0 0 8.2 8H5.1a8.1 8.1 0 0 1 4.5-3.2zM4.3 10H8a16 16 0 0 0 0 4H4.3a8.1 8.1 0 0 1 0-4zm.8 6h3.1a15 15 0 0 0 1.4 3.2A8.1 8.1 0 0 1 5.1 16zm6.9 4c-.8-.9-1.5-2.2-1.9-4h3.8c-.4 1.8-1.1 3.1-1.9 4zm2.3-.8a15 15 0 0 0 1.5-3.2h3.1a8.1 8.1 0 0 1-4.6 3.2zM16 14h-8a14 14 0 0 1 0-4h8a14 14 0 0 1 0 4zm2.9 2h-3.1a16 16 0 0 0 .2-6h2.9a8.1 8.1 0 0 1 0 6z',
} as const;

export function semanticIconSVG(label: string, color: string): string | null {
  const normalized = label.toLowerCase();
  let path: string | undefined;

  if (/kinde|auth|identity|login|oidc|oauth|jwt/.test(normalized)) {
    path = PATHS.auth;
  } else if (/api|gateway|endpoint|webhook/.test(normalized)) {
    path = PATHS.api;
  } else if (/worker|job|task|cron|consumer|scheduler|process/.test(normalized)) {
    path = PATHS.worker;
  } else if (/module|service|component|domain|infrastructure/.test(normalized)) {
    path = PATHS.module;
  } else if (/web|frontend|client|browser/.test(normalized)) {
    path = PATHS.web;
  }

  if (!path) {
    return null;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${path}" fill="${color}"/></svg>`;
}
