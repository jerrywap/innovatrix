import {
  Bell,
  Bookmark,
  Building2,
  ClipboardList,
  CreditCard,
  FileText,
  Inbox,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Package,
  Receipt,
  Settings,
  ShoppingBag,
  Store,
  Tags,
  Timer,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * Nav icons, addressed by name.
 *
 * The navigation config is built on the server and handed to a Client Component
 * (`SidebarNav` needs `usePathname` to mark the current item). **A component
 * function cannot cross that boundary** — React refuses it with "Functions
 * cannot be passed directly to Client Components", and the whole shell 500s.
 *
 * So `NavItem.icon` is a *string*, and the client resolves it here. That keeps
 * the nav config fully serialisable, which is the right shape for data that
 * crosses the boundary anyway.
 *
 * `NavIconName` is derived from this object, so a name that isn't registered is
 * a compile error rather than a missing icon at runtime.
 */
export const NAV_ICONS = {
  bell: Bell,
  bookmark: Bookmark,
  building: Building2,
  clipboard: ClipboardList,
  card: CreditCard,
  file: FileText,
  inbox: Inbox,
  dashboard: LayoutDashboard,
  checklist: ListChecks,
  messages: MessagesSquare,
  package: Package,
  receipt: Receipt,
  settings: Settings,
  bag: ShoppingBag,
  store: Store,
  tags: Tags,
  timer: Timer,
  userCog: UserCog,
  users: Users,
  wrench: Wrench,
} as const satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof NAV_ICONS;

export function navIcon(name: NavIconName): LucideIcon {
  return NAV_ICONS[name];
}
