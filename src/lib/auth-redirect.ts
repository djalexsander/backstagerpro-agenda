type LocationOrigin = Pick<Location, "origin">;

export function getAuthRedirectOrigin(
  location: LocationOrigin = window.location,
): string {
  return location.origin;
}

export function getAuthRedirectUrl(
  pathname: string,
  location: LocationOrigin = window.location,
): string {
  return new URL(pathname, `${location.origin}/`).toString();
}
