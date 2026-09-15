const PREFIX = "boardonline:seat:";

export function getSeatToken(code: string): string | undefined {
  try {
    return localStorage.getItem(PREFIX + code) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setSeatToken(code: string, token: string): void {
  try {
    localStorage.setItem(PREFIX + code, token);
  } catch {
    // ignore (private browsing / storage disabled)
  }
}
