export const Navigate = () => null;
export const Outlet = () => null;
export const Route = () => null;
export const Routes = ({ children }) => children ?? null;
export const Link = ({ children }) => children ?? null;
export const NavLink = ({ children }) => children ?? null;
export const useNavigate = () => () => {};
export const useLocation = () => ({ pathname: "/v2/dashboard", search: "", hash: "", state: null, key: "test" });
export const useParams = () => ({});
export const useSearchParams = () => [new URLSearchParams(), () => {}];
export const useMatch = () => null;
export const useResolvedPath = (to) => ({ pathname: String(to || "/") });
export const useHref = (to) => String(to || "/");
export const createSearchParams = (init) => new URLSearchParams(init);

export default {
  Navigate,
  Outlet,
  Route,
  Routes,
  Link,
  NavLink,
  useNavigate,
  useLocation,
  useParams,
  useSearchParams,
  useMatch,
  useResolvedPath,
  useHref,
  createSearchParams,
};
