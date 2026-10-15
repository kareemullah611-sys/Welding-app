export function isLoginPathname(pathname: string): boolean {
  return pathname === "/" || pathname === "/login" || pathname === "/login/";
}
