const LOCAL_DEVELOPMENT_PORT = "8080";

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

export function buildTrustedAuthRedirectUrl(
  appUrl: string | undefined,
  requestedOrigin: unknown,
  pathname: string,
  missingConfigurationMessage: string,
): string {
  if (!appUrl) throw new Error(missingConfigurationMessage);

  const configuredUrl = new URL(appUrl);
  const configuredIsLocalhost = isLoopbackHost(configuredUrl.hostname);
  if (
    configuredUrl.protocol !== "https:" &&
    !(configuredIsLocalhost && configuredUrl.protocol === "http:")
  ) {
    throw new Error("APP_URL deve usar HTTPS, exceto em localhost");
  }

  let redirectOrigin = configuredUrl.origin;

  if (typeof requestedOrigin === "string" && requestedOrigin.trim()) {
    try {
      const requestedUrl = new URL(requestedOrigin);
      const matchesConfiguredOrigin =
        requestedUrl.origin === configuredUrl.origin;
      const isLocalDevelopmentOrigin =
        requestedUrl.protocol === "http:" &&
        isLoopbackHost(requestedUrl.hostname) &&
        requestedUrl.port === LOCAL_DEVELOPMENT_PORT;

      if (matchesConfiguredOrigin || isLocalDevelopmentOrigin) {
        redirectOrigin = requestedUrl.origin;
      }
    } catch {
      // Untrusted or malformed origins fall back to the configured APP_URL.
    }
  }

  const redirectUrl = new URL(redirectOrigin);
  redirectUrl.pathname = pathname;
  redirectUrl.search = "";
  redirectUrl.hash = "";
  return redirectUrl.toString();
}
