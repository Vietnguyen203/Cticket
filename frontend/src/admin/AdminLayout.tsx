import { ADMIN_MENU, ORGANIZER_MENU } from './permissions'
import { SideMenuLayout } from './SideMenuLayout'

export const AdminLayout = () => <SideMenuLayout title="Quản trị" menu={ADMIN_MENU} />
export const OrganizerLayout = () => <SideMenuLayout title="Ban tổ chức" menu={ORGANIZER_MENU} />
