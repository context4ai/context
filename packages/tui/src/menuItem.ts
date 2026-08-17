export interface MenuItem {
  id: string;
  label: string;
  description: string;
  children?: MenuItem[];
}
